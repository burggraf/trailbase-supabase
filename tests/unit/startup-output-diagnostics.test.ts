import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { supabaseStartupEvidence } from '../../scripts/startup-diagnostics.mjs';
const diagnostic = (error: unknown): any => Reflect.get(supabaseStartupEvidence(error), 'command');
const imagePins = JSON.parse(await readFile('tests/fixtures/service-images.json', 'utf8'));

it('L1-27/D03 retains only fixed CLI signatures and progress, not private output', () => {
  const secret = 'PLANTED_CLI_OUTPUT_PRIVATE_CANARY';
  const result = supabaseStartupEvidence({ code: 1, signal: null, killed: false,
    stdout: `Starting containers...\n${secret}\n`,
    stderr: `Waiting for health checks...\nfailed to start docker container: Bind failed: port is already allocated\n${secret}` });
  expect(Reflect.get(result, 'command')).toEqual({ kind: 'nonzero-exit', stdout: 'bounded', stderr: 'bounded', progress: ['containers-start', 'health-wait'], signatures: ['docker-port-bind'] });
  expect(result.cause).toBe('not-established'); expect(JSON.stringify(result)).not.toContain(secret);
});

it('L1-27/D03 known output signatures classify observations without claiming root cause', () => {
  for (const [text, signature] of [
    ['Cannot connect to the Docker daemon at unix:///private.sock', 'docker-daemon'],
    ['failed to pull docker image: private registry diagnostics', 'image-pull'],
    ['failed to parse config: private malformed field', 'config-parse'],
    ['supabase_auth_fixture is not healthy', 'container-health'],
    ['supabase_db_fixture container is not ready: unhealthy', 'container-health'],
    ['listen tcp 127.0.0.1:12345: bind: address already in use', 'docker-port-bind'],
    ['failed to bind host port for 127.0.0.1:12345:172.18.0.2:8000/tcp: address already in use', 'docker-port-bind']
  ]) expect(diagnostic({ code: 1, stderr: text })?.signatures).toEqual([signature]);
  expect(diagnostic({ code: 1, stderr: 'Unknown private failure' })?.signatures).toEqual([]);
});

it('L1-27/D03 launch and output-limit errors stay distinct from exit or inferred timeout', () => {
  for (const [code, kind] of [['ENOENT', 'launch-not-found'], ['EACCES', 'launch-denied'], ['ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'output-limit'], [1, 'nonzero-exit'], ['PRIVATE_CODE', 'unknown']]) expect(diagnostic({ code })?.kind).toBe(kind);
  expect(diagnostic({ code: null, killed: true, signal: 'SIGTERM' })?.kind).toBe('termination-observed');
});

it('L1-27/D03 rejects oversized, inherited, accessor and non-string output without coercion', () => {
  const trip = () => { throw Error('must not run'); };
  const tooLong = 'port is already allocated' + 'x'.repeat(1_048_576);
  const multibyte = 'port is already allocated' + 'é'.repeat(600_000);
  for (const stderr of [tooLong, multibyte]) {
    expect(diagnostic({ stderr })?.stderr).toBe('over-budget');
    expect(diagnostic({ stderr })?.signatures).toEqual([]);
  }
  for (const error of [Object.create({ stderr: 'port is already allocated' }), Object.defineProperty({}, 'stderr', { get: trip }), { stderr: { toString: trip } }, { stderr: Buffer.from('port is already allocated') }]) {
    expect(diagnostic(error)?.stderr).toBe('unavailable'); expect(diagnostic(error)?.signatures).toEqual([]);
  }
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  expect(diagnostic(revoked.proxy)?.signatures).toEqual([]);
});

it('L1-27/D03 reads changing output descriptors once and cannot export replacement text', () => {
  let reads = 0; const secret = 'PLANTED_SWAPPED_OUTPUT_PRIVATE_CANARY';
  const error = new Proxy({}, { getOwnPropertyDescriptor(_target, field) { return field === 'stderr' ? { configurable: true, value: reads++ === 0 ? 'port is already allocated' : secret } : undefined; } });
  const result = supabaseStartupEvidence(error);
  expect(Reflect.get(result, 'command')?.signatures).toEqual(['docker-port-bind']);
  expect(reads).toBe(1); expect(JSON.stringify(result)).not.toContain(secret);
});

it('L1-27/D03 image-pull detail retains only reported pinned failures, HTTP enums and fixed signals', () => {
  const secret = 'PLANTED_REGISTRY_DETAIL_PRIVATE_CANARY', image = imagePins.supabase_rest.image;
  const result = diagnostic({ code: 1, stdout: `Pulling ${imagePins.supabase_auth.image}\n`, stderr: `Retrying after 8s: ${image}\nfailed to pull docker image from all registries: ${image} attempt 3: unexpected status from HEAD request to https://private.invalid/?token=${secret}: 429 Too Many Requests\n${secret}` });
  expect(result?.pull).toEqual({ reportedFailedServices: ['supabase_rest'], httpStatuses: [429], signals: ['rate-limit'], upstreamRetryBanner: true });
  expect(JSON.stringify(result)).not.toContain(secret); expect(JSON.stringify(result)).not.toContain('private.invalid');
  expect(JSON.stringify(result)).not.toContain(image);
});

it('L1-27/D03 image-pull fixed transport and registry signals never become a root-cause assertion', () => {
  const cases = [
    ['lookup registry.invalid: no such host', ['dns']],
    ['TLS handshake timeout', ['tls', 'timeout']],
    ['x509: certificate signed by unknown authority', ['tls']],
    ['dial tcp: i/o timeout', ['timeout']],
    ['read: connection reset by peer', ['connection']],
    ['unexpected EOF', ['unexpected-eof']],
    ['manifest unknown', ['manifest']],
    ['pull access denied', ['authorization']],
    ['no space left on device', ['disk-space']]
  ];
  for (const [text, signals] of cases) expect(diagnostic({ stderr: `failed to pull docker image from all registries: ${text}` })?.pull?.signals).toEqual(signals);
  for (const [status, phrase] of [[401, 'Unauthorized'], [403, 'Forbidden'], [404, 'Not Found'], [408, 'Request Timeout'], [429, 'Too Many Requests'], [500, 'Internal Server Error'], [502, 'Bad Gateway'], [503, 'Service Unavailable'], [504, 'Gateway Timeout']]) {
    for (const text of [`${status} ${phrase}`, `unexpected status code: ${status}`]) expect(diagnostic({ stderr: `failed to pull docker image: ${text}` })?.pull?.httpStatuses).toEqual([status]);
  }
  expect(supabaseStartupEvidence({ stderr: 'failed to pull docker image: 403 Forbidden' }).cause).toBe('not-established');
});

it('L1-27/D03 pull detail is gated, bounded and never guesses an image or status', () => {
  expect(diagnostic({ stderr: `health failure: 403 Forbidden ${imagePins.supabase_rest.image}` })?.pull).toBeUndefined();
  expect(diagnostic({ stderr: 'failed to pull docker image: unknown private failure 418' })?.pull).toEqual({ reportedFailedServices: [], httpStatuses: [], signals: [], upstreamRetryBanner: false });
  expect(diagnostic({ stderr: `failed to pull docker image: ${imagePins.supabase_rest.image}` })?.pull?.reportedFailedServices).toEqual([]);
  expect(diagnostic({ stderr: 'failed to pull docker image: 429 Too Many Requests' + 'x'.repeat(1_048_576) })?.pull).toBeUndefined();
});

it('L1-27/D03 report wiring captures launch boundary and cache before the first CLI start', async () => {
  const harness = await readFile('scripts/harness.mjs', 'utf8'), runner = await readFile('scripts/run-phase-a.mjs', 'utf8');
  expect(harness).toContain("await exec(cli, ['--version'], { env: childEnv })");
  expect(harness).toContain('context.supabaseStartContext');
  expect(harness.indexOf('await collectSupabaseStartupCache(project)')).toBeLessThan(harness.indexOf("await command(['start'"));
  expect(harness).toContain("operation = 'cli-start'");
  expect(runner).toContain('report.supabaseStartContext=harness?.context.supabaseStartContext');
});
