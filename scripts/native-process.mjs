import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { snapshotCommandInput } from './command-input.mjs';

// Only the original creating supervisor's pipes control this object. PID snapshots cannot restore it.
export function createNativeProcess(file, args, options) { return createOwnedProcess(file, args, options, false); }
// Role-only inherited pipes; ordinary native fixtures still inherit no nonstdio descriptors.
export function createRoleProcess(file, args, options) { return createOwnedProcess(file, args, options, true); }
// Command-only separate original stdout/stderr files; never inherit them into the target.
export function createCommandProcess(file, args, options) {
  if (!Number.isSafeInteger(options.stderrFd) || options.stderrFd < 3 || options.stderrFd === options.logFd) throw new Error('Distinct original command output descriptors required');
  if (options.memoryOutput !== undefined && typeof options.memoryOutput !== 'boolean') throw new Error('Invalid original command memory output mode');
  const input = options.input === undefined ? undefined : snapshotCommandInput(options.input);
  return createOwnedProcess(file, args, options, false, options.stderrFd, options.memoryOutput === true, input);
}
function createOwnedProcess(file, args, { env, logFd }, roleIPC, stderrFd, memoryOutput = false, input) {
  if (process.platform !== 'linux' || typeof file !== 'string' || !file.startsWith('/') || !Array.isArray(args) || args.some(x => typeof x !== 'string') || !Number.isSafeInteger(logFd) || logFd < 3) throw new Error('Invalid native creating-owner launch');
  const configuration = JSON.stringify({ file, args, env, ...(roleIPC ? { roleIPC: true } : {}), ...(stderrFd !== undefined ? { splitOutput: true } : {}), ...(memoryOutput ? { memoryOutput: true } : {}), ...(input !== undefined ? { inputBytes: input.length } : {}) });
  if (Buffer.byteLength(configuration) > 65536) throw new Error('Native launch configuration bound');
  let child, pid = null, attempted = false, stopping = false, terminal = false, result, failure, closed = false, helperCode;
  let stdoutEOF = false, stderrEOF = false, pending = '', bytes = 0, startTimer, stopTimer, stopPromise;
  const output = { out: [], err: [] }; let outputBytes = 0, inputReceipt, inputFinished = input === undefined, inputEOF = input === undefined;
  let bornYes, bornNo, joinedYes, joinedNo;
  const born = new Promise((yes, no) => { bornYes = yes; bornNo = no; }); born.catch(() => {});
  const joined = new Promise((yes, no) => { joinedYes = yes; joinedNo = no; }); joined.catch(() => {});
  function fail(error) { failure ??= error; bornNo(failure); }
  function finish() {
    if (!closed || !stdoutEOF || !stderrEOF || !inputFinished || !inputEOF) return;
    clearTimeout(startTimer); clearTimeout(stopTimer);
    if (failure || helperCode !== 0 || !result || !terminal || input !== undefined && !inputReceipt) {
      fail(failure ?? new Error('Original native join unconfirmed'));
      joinedNo(failure);
    } else joinedYes();
  }
  function receive(chunk) {
    if (memoryOutput && failure) return; // Drain the original pipe without retaining unbounded failed frames.
    if (!memoryOutput) bytes += chunk.length;
    if (!memoryOutput && bytes > 65536) { fail(new Error('Native owner protocol bound')); return; }
    pending += chunk.toString('utf8');
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      try {
        if (memoryOutput && line.length > 131072) throw new Error('Original command frame bound');
        const value = JSON.parse(line);
        const keys = Object.keys(value).sort().join(',');
        if (memoryOutput && value.type !== 'output') {
          bytes += line.length + 1;
          if (bytes > 65536) throw new Error('Native owner control bound');
        }
        if (memoryOutput && value.type === 'output' && keys === 'data,stream,type' && pid !== null && !result && (value.stream === 'out' || value.stream === 'err') && typeof value.data === 'string') {
          const raw = Buffer.from(value.data, 'base64');
          if (!raw.length || raw.toString('base64') !== value.data || (outputBytes += raw.length) > 20000000) throw new Error('Original command output bound/encoding');
          if (!failure) output[value.stream].push(raw);
        } else if (value.type === 'input' && keys === 'bytesWritten,complete,type' && input !== undefined && pid !== null && !result && !inputReceipt && Number.isSafeInteger(value.bytesWritten) && value.bytesWritten >= 0 && value.bytesWritten <= input.length && typeof value.complete === 'boolean' && (!value.complete || value.bytesWritten === input.length)) {
          inputReceipt = Object.freeze({ bytesWritten: value.bytesWritten, complete: value.complete });
        } else if (value.type === 'created' && keys === 'pid,type' && pid === null && Number.isSafeInteger(value.pid) && value.pid > 1 && !terminal) {
          pid = value.pid; bornYes(pid);
        } else if (value.type === 'terminal' && keys === 'type' && pid !== null && !terminal && !result) terminal = true;
        else if (value.type === 'joined' && keys === 'code,signal,type' && terminal && !result &&
          (Number.isInteger(value.code) && value.code >= 0 && value.code <= 255 && value.signal === null || value.code === null && typeof value.signal === 'string' && /^SIG[A-Z0-9]+$/.test(value.signal))) result = value;
        else throw new Error('Unexpected native owner frame');
      } catch { fail(new Error('Invalid original native owner protocol')); }
    }
    if (memoryOutput && pending.length > 131072) fail(new Error('Original command frame bound'));
  }
  async function start(recordOwner = async () => {}) {
    if (attempted || stopping) throw new Error('Native launch is once-only');
    attempted = true;
    try {
      child = spawn('/usr/bin/python3', ['-I', '-B', '-S', fileURLToPath(new URL('./native-process.py', import.meta.url))], { env, stdio: ['pipe', 'pipe', 'pipe', logFd, ...(roleIPC ? ['pipe', 'pipe'] : stderrFd !== undefined ? [stderrFd, ...(input !== undefined ? ['pipe'] : [])] : [])] });
      child.on('error', error => fail(error));
      child.stdin.on('error', error => { if (!result) fail(error); });
      if (input !== undefined) {
        const pipe = child.stdio[5];
        pipe.on('error', error => fail(error));
        pipe.on('finish', () => { inputFinished = true; finish(); });
        pipe.on('end', () => { inputEOF = true; finish(); });
        pipe.on('close', () => { if (!inputFinished || !inputEOF) { fail(new Error('Original command input closure unconfirmed')); inputFinished = inputEOF = true; finish(); } });
        pipe.resume();
        // Separate original pipe, not configuration/control text. Backpressure stays bounded by the snapshot.
        pipe.end(input);
      }
      child.stdout.on('data', receive);
      child.stdout.on('error', error => fail(error));
      child.stderr.on('data', () => fail(new Error('Native supervisor stderr; join unconfirmed')));
      child.stderr.on('error', error => fail(error));
      for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
        stream.on('end', () => { if (name === 'stdout') { stdoutEOF = true; if (pending) fail(new Error('Partial native owner frame')); } else stderrEOF = true; finish(); });
        stream.on('close', () => {
          if (name === 'stdout' && !stdoutEOF || name === 'stderr' && !stderrEOF) {
            fail(new Error('Native owner output EOF unconfirmed'));
            if (name === 'stdout') stdoutEOF = true; else stderrEOF = true;
            finish();
          }
        });
      }
      child.on('close', (code, signal) => { closed = true; helperCode = signal === null ? code : null; finish(); });
      child.stdin.write(configuration + '\n');
      startTimer = setTimeout(() => { fail(new Error('Native creation acknowledgement unknown')); }, 30000);
      const originalPid = await born;
      await recordOwner(originalPid);
      if (failure) throw failure;
      if (stopping || closed) throw new Error('Native launch stopped before GO');
      child.stdin.write('GO\n');
    } finally { clearTimeout(startTimer); }
  }
  function stop() {
    if (stopPromise) return stopPromise;
    stopping = true;
    stopPromise = new Promise((yes, no) => {
      if (!attempted || !child) { no(new Error('Native owner unavailable')); return; }
      joined.then(yes, no);
      if (!result && !closed) {
        try { child.stdin.write('STOP\n'); } catch (error) { fail(error); }
      }
      // A deadline refuses release; it never destroys pipes, reopens a PID, retries, or proves settlement.
      if (!closed) stopTimer = setTimeout(() => { fail(new Error('Original native stop/join unknown')); no(failure); }, 10000);
    });
    return stopPromise;
  }
  const owner = { start, stop, join: () => joined,
    get pid() { return pid; }, get exited() { return terminal; },
    get exitCode() { return result?.code ?? null; }, get signalCode() { return result?.signal ?? null; },
    inventory() { return Object.freeze({ complete: false, pid, terminal, joined: Boolean(closed && stdoutEOF && stderrEOF && inputFinished && inputEOF && (input === undefined || inputReceipt) && result && !failure && helperCode === 0), unknown: Boolean(failure) }); }
  };
  if (input !== undefined) Object.defineProperty(owner, 'inputResult', { value() {
    if (!closed || !stdoutEOF || !stderrEOF || !inputFinished || !inputEOF || !result || failure || helperCode !== 0 || !inputReceipt) throw new Error('Original command input unconfirmed');
    return inputReceipt; // Bytes written to stdin are not a claim that the child consumed them.
  } });
  if (memoryOutput) Object.defineProperty(owner, 'output', { value() {
    if (!closed || !stdoutEOF || !stderrEOF || !inputFinished || !inputEOF || input !== undefined && !inputReceipt || !result || failure || helperCode !== 0) throw new Error('Original command memory output unconfirmed');
    return { stdout: Buffer.concat(output.out), stderr: Buffer.concat(output.err) };
  } });
  if (roleIPC) for (const [name, fd] of [['rpc', 4], ['lifetime', 5]]) Object.defineProperty(owner, name, { get() { if (!child) throw new Error('Original role not created'); return child.stdio[fd]; } });
  return Object.freeze(owner);
}
