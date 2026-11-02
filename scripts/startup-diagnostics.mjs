import { exec } from './tools.mjs';

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

// Reconstruct from literals/validated scalars only. Error text and health output may
// contain credentials; never serialize, coerce or forward those source objects.
export function supabaseStartupEvidence(error, observations = {}) {
  const signal = own(error, 'signal');
  return {
    stage: 'supabase-start', cause: 'not-established',
    exitCode: number(own(error, 'code')),
    signal: signals.has(signal) ? signal : null,
    killed: boolean(own(error, 'killed')),
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
  if (typeof project !== 'string' || !/^trailbase-supabase-test-[a-f0-9]{12}$/.test(project)) throw new Error('Invalid owned startup diagnostic project');
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
