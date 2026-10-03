import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, cp, rm, open } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { once } from 'node:events';
import { baseline, exec, installTrail } from './tools.mjs';

export const cli = resolve('node_modules/.bin/supabase');
export function assertLocalUrl(value, allowedOrigins) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || !allowedOrigins.includes(url.origin)) {
    throw new Error('Refusing non-fixture target');
  }
  return url;
}
export function verifyLoopbackBindings(ports) {
  for (const bindings of Object.values(ports ?? {})) for (const binding of bindings ?? []) {
    if (!['127.0.0.1','::1'].includes(binding.HostIp)) throw new Error('Fixture published a non-loopback port');
  }
}
export function verifyImages(containers, expected) {
  if (containers.length !== Object.keys(expected).length) throw new Error('Fixture service count drift');
  for (const container of containers) {
    const pinned = expected[container.service];
    if (!pinned || container.image !== pinned.image || !pinned.repoDigests.some(digest => container.repoDigests.includes(digest))) throw new Error('Fixture image digest drift');
  }
}
export function assertRunDirectory(directory) {
  const tail = relative(resolve('.runtime/runs'), resolve(directory));
  if (!/^\d{13}-[a-f0-9]{12}$/.test(tail) || tail.includes(sep)) throw new Error('Refusing non-fixture directory');
}
export function verifyOwner(id, owner, config) {
  const project = `trailbase-supabase-test-${id.split('-')[1]}`;
  const configured = [...config.matchAll(/^project_id\s*=\s*"([^"]+)"\s*$/gm)];
  if (owner.id !== id || owner.project !== project || !/^\d{13}-[a-f0-9]{12}$/.test(id) || configured.length !== 1 || configured[0][1] !== project) throw new Error('Fixture ownership mismatch');
  return project;
}
export async function freePort() {
  const server = createServer();
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const port = server.address().port;
  await new Promise((yes, no) => server.close(error => error ? no(error) : yes()));
  return port;
}
export async function waitReady(url, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error('Fixture exited before readiness');
    try { const response = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (response.ok) return; }
    catch { /* Bounded startup polling within the harness, not a skipped setup. */ }
    await new Promise(yes => setTimeout(yes, 100));
  }
  throw new Error('Fixture readiness deadline exceeded');
}
export async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await exited; } finally { clearTimeout(timer); }
}
export function replaceTokens(text, values) {
  const result = text.replace(/__([A-Z_]+)__/g, (_, name) => {
    if (!(name in values)) throw new Error(`Missing fixture variable ${name}`);
    return String(values[name]);
  });
  if (/__[A-Z_]+__/.test(result)) throw new Error('Unresolved fixture variable');
  return result;
}

// All paths/ports/project names are generated here; callers cannot target a hosted project.
export async function createHarness({ authMitigation = false } = {}) {
  const id = `${Date.now()}-${randomUUID().replaceAll('-', '').slice(0,12)}`;
  const directory = resolve('.runtime/runs', id);
  assertRunDirectory(directory);
  const project = `trailbase-supabase-test-${id.split('-')[1]}`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const ports = {};
  for (const key of ['API_PORT','DB_PORT','SHADOW_PORT','MAIL_PORT','SMTP_PORT','TRAIL_PORT','ADMIN_PORT']) {
    do { ports[key] = await freePort(); } while (Object.values(ports).filter(value => value === ports[key]).length > 1);
  }
  const origins = ['API_PORT','MAIL_PORT','TRAIL_PORT'].map(key => `http://127.0.0.1:${ports[key]}`);
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) if (key.startsWith('SUPABASE_') || key.startsWith('TRAILBASE_')) delete childEnv[key];
  const context = { id, project, directory, origins, trailUrl: origins[2], supabaseUrl: origins[0], mailUrl: origins[1], authVariant: authMitigation ? 'candidate-email-reservation' : 'stock' };
  const ownerRecord = { id, project, authVariant:context.authVariant, runnerPid: process.pid, trailPid: null };
  await writeFile(resolve(directory, 'owner.json'), JSON.stringify(ownerRecord), { mode: 0o600 });
  let trail, log;
  let startAttempted = false;
  async function command(args, name) {
    try {
      const result = await exec(cli, [...args, '--workdir', directory, '--agent', 'no', '--network-id', `supabase_network_${project}`], { env: childEnv, timeout: baseline.startupTimeoutMs, maxBuffer: 20_000_000 });
      await writeFile(resolve(directory, `${name}.log`), result.stdout + result.stderr, { mode: 0o600 });
      return result.stdout;
    } catch (error) {
      await writeFile(resolve(directory, `${name}.log`), String(error.stdout ?? '') + String(error.stderr ?? ''), { mode: 0o600 });
      throw new Error(`Local Supabase ${name} failed; private diagnostics: ${relative(process.cwd(), directory)}/${name}.log`);
    }
  }
  async function cleanup() {
    assertRunDirectory(directory);
    const owner = JSON.parse(await readFile(resolve(directory, 'owner.json')));
    if (owner.project !== project || owner.id !== id) throw new Error('Fixture ownership mismatch');
    if (startAttempted) verifyOwner(id, owner, await readFile(resolve(directory, 'supabase/config.toml'), 'utf8'));
    const errors = [];
    try { await stopChild(trail); } catch { errors.push('TrailBase stop failed'); }
    try { await log?.close(); } catch { errors.push('TrailBase log close failed'); }
    if (startAttempted) {
      // Private, bounded diagnostics only; auth/WAL logs may contain credentials or record values.
      for (const service of ['realtime','auth']) {
        try {
          const result = await exec('docker',['logs','--tail','200',`supabase_${service}_${project}`],{timeout:10000});
          await writeFile(resolve(directory,`${service}-private.log`),result.stdout+result.stderr,{mode:0o600});
        } catch { /* An absent container must not prevent cleanup. */ }
      }
      try { await command(['stop', '--no-backup'], 'stop'); } catch { errors.push('Supabase stop failed'); }
      const networks = await exec('docker',['network','ls','-q','--filter',`name=^supabase_network_${project}$`]);
      if (networks.stdout.trim()) await exec('docker',['network','rm',`supabase_network_${project}`]);
      const { stdout } = await exec('docker', ['ps', '-aq', '--filter', `name=_${project}$`]);
      if (stdout.trim()) errors.push('Owned Docker containers still exist after cleanup');
      for (const resource of ['volume','network']) {
        const remaining = await exec('docker', [resource,'ls','-q','--filter',`name=_${project}$`]);
        if (remaining.stdout.trim()) errors.push(`Owned Docker ${resource} still exists after cleanup`);
      }
    }
    if (errors.length) throw new Error(errors.join('; '));
    // Diagnostics stay private and gitignored. Delete only the owned depot (including keys/data).
    await rm(resolve(directory, 'traildepot'), { recursive: true, force: true });
    await rm(resolve(directory, 'context.json'), { force: true });
  }
  async function start() {
    const { stdout: dockerHost } = await exec('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
    if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix://') || !dockerHost.trim().startsWith('unix://')) {
      throw new Error('Fixture requires a local Unix-socket Docker daemon');
    }
    const { stdout: version } = await exec(cli, ['--version']);
    if (version.trim() !== baseline.supabaseCli) throw new Error('Supabase CLI version drift');
    await cp(resolve('tests/fixtures/supabase'), resolve(directory, 'supabase'), { recursive: true });
    const values = { ...ports, PROJECT_ID: project };
    await writeFile(resolve(directory, 'supabase/config.toml'), replaceTokens(await readFile('tests/fixtures/supabase/config.toml', 'utf8'), values));
    const binary = await installTrail();
    const { stdout: trailVersion } = await exec(binary, ['--version']);
    if (!trailVersion.includes(baseline.trailbase.version)) throw new Error('TrailBase version drift');
    console.log('Starting disposable Supabase (first run may download images)...');
    startAttempted = true;
    await exec('docker',['network','create','--driver','bridge','--opt','com.docker.network.bridge.host_binding_ipv4=127.0.0.1','--label',`trailbase-supabase.run=${id}`,`supabase_network_${project}`]);
    await command(['start', '--exclude', 'studio,postgres-meta,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor'], 'start');
    const status = JSON.parse(await command(['status', '-o', 'json'], 'status'));
    context.anonKey = status.ANON_KEY ?? status.api?.anon_key ?? status.api?.publishable_key;
    if (typeof context.anonKey !== 'string') throw new Error('Missing ordinary local Supabase client key');
    if (status.API_URL && assertLocalUrl(status.API_URL, origins).origin !== context.supabaseUrl) throw new Error('Fixture origin mismatch');
    await waitReady(`${context.mailUrl}/api/v1/messages`, 10000);
    const depot = resolve(directory, 'traildepot');
    await cp(resolve('tests/fixtures/trailbase'), depot, { recursive: true });
    if (authMitigation) await cp(resolve('tests/fixtures/auth-mitigation/U1790991000__reserve_auth_email.sql'),resolve(depot,'migrations/main/U1790991000__reserve_auth_email.sql'));
    await writeFile(resolve(depot, 'config.textproto'), replaceTokens(await readFile('tests/fixtures/trailbase/config.textproto', 'utf8'), values));
    const publicDirectory = resolve(directory, 'public');
    await mkdir(publicDirectory);
    await writeFile(resolve(publicDirectory, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>Phase A verification complete</title><main><h1>Verification complete</h1><p>Sign in explicitly.</p></main></html>');
    await writeFile(resolve(publicDirectory, 'phase-a-owner.txt'), id);
    log = await open(resolve(directory, 'trail.log'), 'w', 0o600);
    trail = spawn(binary, ['--depot', depot, 'run', '--address', `127.0.0.1:${ports.TRAIL_PORT}`, '--admin-address', `127.0.0.1:${ports.ADMIN_PORT}`, '--public-dir', publicDirectory, '--runtime-threads', '2'], {
      env: childEnv, stdio: ['ignore', log.fd, log.fd]
    });
    trail.on('error', () => {}); // Attach before awaiting I/O; waitReady reports failure without dumping private logs.
    ownerRecord.trailPid = trail.pid ?? null;
    await writeFile(resolve(directory, 'owner.json'), JSON.stringify(ownerRecord), { mode: 0o600 });
    await waitReady(`${context.trailUrl}/api/healthcheck`, 30000, trail);
    const marker = await fetch(`${context.trailUrl}/phase-a-owner.txt`,{signal:AbortSignal.timeout(5000)});
    if (!marker.ok || await marker.text() !== id) throw new Error('Native fixture origin ownership mismatch');
    await writeFile(resolve(directory, 'context.json'), JSON.stringify(context), { mode: 0o600 });
    const { stdout: names } = await exec('docker', ['ps', '--format', '{{.Names}}', '--filter', `name=_${project}$`]);
    const containers = [];
    for (const name of names.trim().split('\n').filter(Boolean)) {
      const { stdout } = await exec('docker', ['inspect', '--format', '{{.Config.Image}}|{{.Image}}', name]);
      const [image, imageId] = stdout.trim().split('|');
      const { stdout: digests } = await exec('docker', ['image', 'inspect', '--format', '{{json .RepoDigests}}', imageId]);
      const { stdout: ports } = await exec('docker',['inspect','--format','{{json .NetworkSettings.Ports}}',name]);
      const publishedPorts = JSON.parse(ports);
      verifyLoopbackBindings(publishedPorts);
      containers.push({ service: name.replace(`_${project}`, ''), image, imageId, repoDigests: JSON.parse(digests), publishedPorts });
    }
    verifyImages(containers, JSON.parse(await readFile('tests/fixtures/service-images.json','utf8')));
    return { ...context, containers, trailVersion: trailVersion.trim(), cliVersion: version.trim() };
  }
  return { context, start, cleanup };
}
