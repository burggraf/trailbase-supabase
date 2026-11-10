"""Original creating parent for one Linux native fixture; no PID-based recovery API."""
import base64
import errno
import json
import os
import resource
import selectors
import signal
import stat
import time


def emit(value):
    raw = json.dumps(value, separators=(",", ":")).encode() + b"\n"
    try:
        while raw:
            raw = raw[os.write(1, raw):]
    except (BrokenPipeError, OSError):
        # Losing the observer cannot transfer custody or authorize a signal/removal.
        pass


def configuration():
    raw = bytearray()
    while True:
        part = os.read(0, 1)
        if not part:
            raise ValueError("Missing native launch configuration")
        if part == b"\n":
            break
        raw.extend(part)
        if len(raw) > 65536:
            raise ValueError("Native launch configuration bound")
    value = json.loads(raw)
    keys = set(value)
    if "inputBytes" in value:
        if value.get("splitOutput") is not True or type(value["inputBytes"]) is not int or not 0 <= value["inputBytes"] <= 1048576 or not stat.S_ISSOCK(os.fstat(5).st_mode):
            raise ValueError("Invalid original command input")
        keys.remove("inputBytes")
    if keys not in ({"file", "args", "env"}, {"file", "args", "env", "roleIPC"}, {"file", "args", "env", "splitOutput"}, {"file", "args", "env", "splitOutput", "memoryOutput"}) or not isinstance(value["file"], str) or not value["file"].startswith("/"):
        raise ValueError("Invalid native executable")
    if not isinstance(value["args"], list) or any(not isinstance(arg, str) or "\0" in arg for arg in value["args"]):
        raise ValueError("Invalid native arguments")
    if not isinstance(value["env"], dict) or any(not isinstance(k, str) or not isinstance(v, str) or not k or "=" in k or "\0" in k + v for k, v in value["env"].items()):
        raise ValueError("Invalid native environment")
    if "roleIPC" in value:
        if value["roleIPC"] is not True or any(not stat.S_ISSOCK(os.fstat(fd).st_mode) for fd in (4, 5)):
            raise ValueError("Original role IPC descriptors required")
    if "splitOutput" in value:
        if value["splitOutput"] is not True or not stat.S_ISREG(os.fstat(4).st_mode):
            raise ValueError("Original command stderr descriptor required")
    if "memoryOutput" in value and value["memoryOutput"] is not True:
        raise ValueError("Invalid original command memory output mode")
    if not stat.S_ISREG(os.fstat(3).st_mode):
        raise ValueError("Native log must be an original regular-file descriptor")
    for obj, name in [(os, "fork"), (os, "pidfd_open"), (os, "P_PIDFD"), (signal, "pidfd_send_signal")]:
        if not hasattr(obj, name):
            raise ValueError("Native creating-owner platform unsupported")
    return value


def main():
    config = configuration()
    gate_r, gate_w = os.pipe()
    out_r, out_w = os.pipe()
    err_r, err_w = os.pipe()
    input_r, input_w = os.pipe() if "inputBytes" in config else (None, None)
    signal.signal(signal.SIGCHLD, signal.SIG_DFL)  # This creating parent must retain its owning wait.
    pid = os.fork()
    if pid == 0:
        os.close(gate_w)
        os.close(out_r)
        os.close(err_r)
        if input_w is not None:
            os.close(input_w)
        try:
            if os.read(gate_r, 1) != b"G":
                os._exit(125)
            source = input_r if input_r is not None else os.open(os.devnull, os.O_RDONLY)
            os.dup2(source, 0)
            os.dup2(out_w, 1)
            os.dup2(err_w, 2)
            maximum = resource.getrlimit(resource.RLIMIT_NOFILE)[0]
            if config.get("roleIPC") is True:
                os.dup2(4, 3, inheritable=True)
                os.dup2(5, 4, inheritable=True)
            os.closerange(5 if config.get("roleIPC") is True else 3, 2147483647 if maximum == resource.RLIM_INFINITY else min(maximum, 2147483647))
            os.execve(config["file"], [config["file"], *config["args"]], config["env"])
        except BaseException:
            os.write(2, b"Native fixture exec failed\n")
            os._exit(127)
    try:
        os.close(gate_r)
        os.close(out_w)
        os.close(err_w)
        if config.get("roleIPC") is True:
            os.close(4)
            os.close(5)  # Only the original role, not its waiting helper, keeps these peer endpoints.
        if input_r is not None:
            os.close(input_r)
        return supervise(pid, gate_w, out_r, err_r, config.get("roleIPC") is True, config.get("splitOutput") is True, config.get("memoryOutput") is True, input_w, config.get("inputBytes"))
    except BaseException:
        emit({"type": "failure"})
        # Retain all original handles on uncertainty; never reopen a PID or repeat a wait.
        while True:
            time.sleep(3600)


def supervise(pid, gate_w, out_r, err_r, role_ipc=False, split_output=False, memory_output=False, input_w=None, input_size=None):
    # This is our unreaped, gated direct child from fork; its PID cannot be recycled.
    pidfd = os.pidfd_open(pid, 0)
    selector = selectors.DefaultSelector()
    for fd, kind in [(0, "control"), (out_r, "out"), (err_r, "err"), (pidfd, "terminal")]:
        os.set_blocking(fd, False)
        selector.register(fd, selectors.EVENT_READ, kind)
    terminal = False
    eof = set()
    commands = bytearray()
    launched = False
    stopping = None
    killed = False
    failed = False
    terminal_at = None
    output_bytes = 0
    input_buffer = bytearray()
    input_read = input_written = 0
    input_eof = input_done = input_size is None
    input_broken = False
    if input_size is not None:
        os.set_blocking(5, False)
        os.set_blocking(input_w, False)
        selector.register(5, selectors.EVENT_READ, "input-source")

    def failure():
        nonlocal failed
        if not failed:
            failed = True
            emit({"type": "failure"})

    def send(sig):
        try:
            signal.pidfd_send_signal(pidfd, sig, None, 0)
        except ProcessLookupError:
            pass  # Original terminal pidfd readiness, not this error, proves target exit.
        except BaseException:
            failure()

    def input_registration():
        nonlocal input_w, input_done
        if input_size is None or input_done:
            return
        def unregister(fd):
            try:
                selector.unregister(fd)
            except KeyError:
                pass
        if not input_eof:
            unregister(5)
            if input_broken or len(input_buffer) < 65536:
                selector.register(5, selectors.EVENT_READ, "input-source")
        if input_w is not None:
            unregister(input_w)
            if input_broken or input_eof and not input_buffer:
                os.close(input_w)
                input_w = None
            elif input_buffer:
                selector.register(input_w, selectors.EVENT_WRITE, "input-write")
        if input_eof and input_w is None:
            input_done = True
            emit({"type": "input", "bytesWritten": input_written, "complete": not input_broken and input_read == input_written == input_size})

    # External supervisor interruption must not become implicit permission to signal a target.
    signal.signal(signal.SIGTERM, lambda *_: failure())
    signal.signal(signal.SIGINT, lambda *_: failure())
    emit({"type": "created", "pid": pid})
    while True:
        if terminal and len(eof) == 2 and input_done:
            try:
                # Exactly one consuming owning wait; no WNOWAIT, PID reopen, waitpid or poll.
                result = os.waitid(os.P_PIDFD, pidfd, os.WEXITED)
                if result is None or result.si_pid != pid:
                    raise RuntimeError("Original owning wait mismatch")
                if result.si_code == os.CLD_EXITED:
                    code, name = result.si_status, None
                elif result.si_code in (os.CLD_KILLED, os.CLD_DUMPED):
                    code, name = None, signal.Signals(result.si_status).name
                else:
                    raise RuntimeError("Original owning wait status unsupported")
            except BaseException:
                failure()
                while True:
                    time.sleep(3600)  # Never repeat a potentially consumed owning wait.
            os.close(pidfd)
            selector.close()
            emit({"type": "joined", "code": code, "signal": name})
            return 1 if failed else 0
        now = time.monotonic()
        if stopping is not None and not terminal and not killed and now - stopping >= 5:
            killed = True
            send(signal.SIGKILL)  # Same explicit STOP policy; still only the original pidfd.
        if terminal_at is not None and now - terminal_at >= 2 and (len(eof) != 2 or not input_done):
            failure()  # Retain original pipes/pidfd; deadline is not EOF or settlement.
        for key, _ in selector.select(0.1):
            kind, fd = key.data, key.fd
            if kind == "input-write":
                try:
                    count = os.write(fd, input_buffer)
                    if count <= 0:
                        raise OSError("Original input write unknown")
                    input_written += count
                    del input_buffer[:count]
                except BlockingIOError:
                    continue
                except OSError as error:
                    if error.errno != errno.EPIPE:
                        failure()
                    input_broken = True
                    input_buffer.clear()
                input_registration()
                continue
            if kind == "input-source":
                try:
                    raw = os.read(5, 65536 if input_broken else 65536 - len(input_buffer))
                except BlockingIOError:
                    continue
                except OSError:
                    failure()
                    # Ambiguous source closure cannot be converted to a complete receipt.
                    selector.unregister(5)
                    continue
                if not raw:
                    input_eof = True
                    selector.unregister(5)
                    os.close(5)
                    if input_read != input_size:
                        failure()
                        input_broken = True
                        input_buffer.clear()
                else:
                    input_read += len(raw)
                    if input_read > input_size:
                        failure()
                        input_broken = True
                        input_buffer.clear()
                    elif not input_broken:
                        input_buffer.extend(raw)
                input_registration()
                continue
            if kind == "terminal":
                terminal = True
                terminal_at = time.monotonic()
                selector.unregister(pidfd)
                emit({"type": "terminal"})
                continue
            try:
                raw = os.read(fd, 65536)
            except BlockingIOError:
                continue
            except OSError:
                failure()
                selector.unregister(fd)
                continue
            if not raw:
                selector.unregister(fd)
                if kind in ("out", "err"):
                    eof.add(kind)
                    os.close(fd)
                else:
                    # A lost creating controller is quarantine, not a stop or adoption capability.
                    failure()
                continue
            if kind in ("out", "err"):
                output_bytes += len(raw)
                if (role_ipc or split_output) and output_bytes > 20000000:
                    failure()
                    continue  # Bound violation is sticky unknown, never successful truncated evidence.
                if memory_output:
                    # Privileged start/status bytes travel only through the original controller pipe.
                    emit({"type": "output", "stream": kind, "data": base64.b64encode(raw).decode("ascii")})
                    continue
                try:
                    while raw:
                        raw = raw[os.write(4 if split_output and kind == "err" else 3, raw):]
                except OSError:
                    failure()
                continue
            commands.extend(raw)
            if len(commands) > 65536:
                failure()
                selector.unregister(0)
                continue
            while b"\n" in commands:
                command, _, rest = commands.partition(b"\n")
                commands[:] = rest
                if command == b"GO" and not launched and stopping is None and not terminal:
                    launched = True
                    os.write(gate_w, b"G")
                    os.close(gate_w)
                    gate_w = None
                elif command == b"STOP" and stopping is None:
                    stopping = time.monotonic()
                    if gate_w is not None:
                        os.close(gate_w)
                        gate_w = None
                    if not terminal:
                        send(signal.SIGTERM)
                else:
                    failure()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        emit({"type": "failure"})
        raise SystemExit(1)
