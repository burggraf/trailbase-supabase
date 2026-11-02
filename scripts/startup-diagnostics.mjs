import { readFile } from 'node:fs/promises';
import { exec } from './tools.mjs';

const imagePins = JSON.parse(await readFile(new URL('../tests/fixtures/service-images.json', import.meta.url), 'utf8'));

const services = ['supabase_auth', 'supabase_db', 'supabase_inbucket', 'supabase_kong', 'supabase_realtime', 'supabase_rest'];
const statuses = new Set(['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead']);
const health = new Set(['healthy', 'unhealthy', 'starting']);
const signals = new Set(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP', 'SIGABRT', 'SIGSEGV']);
function own(object, field) {
  try {
    if (object === null || typeof object !== 'object') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(object, field);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch { return undefined; }
}
const number = value => Number.isSafeInteger(value) && value >= 0 && value <= 65535 ? value : null;
const boolean = value => typeof value === 'boolean' ? value : null;

function boundedOutput(value) {
  if (typeof value !== 'string') return { status: 'unavailable', text: '' };
  if (value.length > 1_048_576 || Buffer.byteLength(value, 'utf8') > 1_048_576) return { status: 'over-budget', text: '' };
  return { status: 'bounded', text: value };
}
function pullDiagnostic(text) {
  const http = [[401, 'Unauthorized'], [403, 'Forbidden'], [404, 'Not Found'], [408, 'Request Timeout'], [429, 'Too Many Requests'], [500, 'Internal Server Error'], [502, 'Bad Gateway'], [503, 'Service Unavailable'], [504, 'Gateway Timeout']];
  return {
    // Pinned CLI aggregates candidate-attempt failures; normal pull progress is not failure evidence.
    reportedFailedServices: services.filter(service => text.includes(`${imagePins[service].image} attempt `)),
    httpStatuses: http.filter(([code, phrase]) => new RegExp(`\\b(?:${code}\\s+${phrase}|status(?: code)?\\s*[:=]?\\s*${code})\\b`, 'i').test(text)).map(([code]) => code),
    signals: [
      ['rate-limit', /toomanyrequests|too many requests|rate limit/i],
      ['dns', /no such host|temporary failure in name resolution/i],
      ['tls', /TLS handshake timeout|x509:|tls: handshake failure/i],
      ['timeout', /i\/o timeout|context deadline exceeded|TLS handshake timeout|connection timed out/i],
      ['connection', /connection reset by peer|connection refused/i],
      ['unexpected-eof', /unexpected EOF/i],
      ['manifest', /manifest unknown|manifest not found|no matching manifest/i],
      ['authorization', /pull access denied|requested access to the resource is denied|unauthorized:|denied:/i],
      ['disk-space', /no space left on device|insufficient disk space/i]
    ].filter(([, pattern]) => pattern.test(text)).map(([name]) => name),
    upstreamRetryBanner: text.includes('Retrying after ')
  };
}
function commandDiagnostic(error, code, signal, killed) {
  const stdout = boundedOutput(own(error, 'stdout')), stderr = boundedOutput(own(error, 'stderr'));
  const text = `${stdout.text}\n${stderr.text}`;
  // These are observed text signatures, NOT verified causes or service state. No excerpts escape.
  const signatures = [
    ['docker-port-bind', /port is already allocated|address already in use/i],
    ['docker-daemon', /cannot connect to the docker daemon|is the docker daemon running/i],
    ['image-pull', /failed to pull (?:docker )?image|error pulling image/i],
    ['config-parse', /failed to parse config/i],
    ['container-health', /is not healthy|container is not ready|health check timed out/i]
  ].filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  const progress = [
    ['containers-start', 'Starting containers...'],
    ['health-wait', 'Waiting for health checks...'],
    ['containers-stop', 'Stopping containers...']
  ].filter(([, marker]) => text.includes(marker)).map(([name]) => name);
  const kind = code === 'ENOENT' ? 'launch-not-found' : code === 'EACCES' ? 'launch-denied' :
    code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'output-limit' :
    killed === true || signals.has(signal) ? 'termination-observed' : number(code) > 0 ? 'nonzero-exit' : 'unknown';
  return { kind, stdout: stdout.status, stderr: stderr.status, progress, signatures,
    ...(signatures.includes('image-pull') ? { pull: pullDiagnostic(text) } : {}) };
}
function verifyProject(project) {
  if (typeof project !== 'string' || !/^trailbase-supabase-test-[a-f0-9]{12}$/.test(project)) throw new Error('Invalid owned startup diagnostic project');
}

export async function collectSupabaseStartupCache(project) {
  verifyProject(project);
  return Promise.all(services.map(async service => {
    let cache = 'unavailable';
    try {
      const { stdout } = await exec('docker', ['image', 'inspect', '--format', '{{json .RepoDigests}}', imagePins[service].image], { timeout: 5000, maxBuffer: 4096 });
      const digests = JSON.parse(stdout);
      if (Array.isArray(digests)) cache = imagePins[service].repoDigests.some(digest => digests.includes(digest)) ? 'pinned' : 'not-pinned';
    } catch (error) {
      const stderr = boundedOutput(own(error, 'stderr'));
      if (stderr.text.startsWith('Error response from daemon: No such image:')) cache = 'not-present';
    }
    return { service, cache };
  }));
}

// Reconstruct from literals/validated scalars only. Error text and health output may
// contain credentials; never serialize, coerce or forward those source objects.
export function supabaseStartupEvidence(error, observations = {}) {
  const code = own(error, 'code'), signal = own(error, 'signal'), killed = own(error, 'killed');
  return {
    stage: 'supabase-start', cause: 'not-established',
    exitCode: number(code),
    signal: signals.has(signal) ? signal : null,
    killed: boolean(killed),
    command: commandDiagnostic(error, code, signal, killed),
    services: services.map(service => {
      const state = own(observations, service);
      if (state === null || typeof state !== 'object') return { service, inspection: 'not-available' };
      const status = own(state, 'status'), stateHealth = own(state, 'health');
      return { service, inspection: 'available', status: statuses.has(status) ? status : 'unknown',
        health: stateHealth === null ? 'none' : health.has(stateHealth) ? stateHealth : 'unknown',
        exitCode: number(own(state, 'exitCode')), oomKilled: boolean(own(state, 'oomKilled')),
        restartCount: number(own(state, 'restartCount')) };
    })
  };
}

export async function collectSupabaseStartupEvidence(project, error) {
  verifyProject(project);
  const observations = {};
  const format = '{"status":{{json .State.Status}},"exitCode":{{json .State.ExitCode}},"oomKilled":{{json .State.OOMKilled}},"restartCount":{{json .RestartCount}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}}}';
  await Promise.all(services.map(async service => {
    try {
      const { stdout } = await exec('docker', ['inspect', '--format', format, `${service}_${project}`], { timeout: 5000, maxBuffer: 4096 });
      observations[service] = JSON.parse(stdout);
    } catch { /* Missing resources/daemon/inspection failure remain unknown, not guessed. */ }
  }));
  return supabaseStartupEvidence(error, observations);
}
