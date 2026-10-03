import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exec } from './tools.mjs';
import { assertRunDirectory, verifyOwner, cli } from './harness.mjs';

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error('Invalid recorded PID');
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function main() {
  const id = process.argv[2];
  if (!id) throw new Error('Usage: npm run fixtures:cleanup -- <run-id> (from progress/evidence)');
  const directory = resolve('.runtime/runs', id);
  assertRunDirectory(directory);
  const owner = JSON.parse(await readFile(resolve(directory,'owner.json'),'utf8'));
  const config = await readFile(resolve(directory,'supabase/config.toml'),'utf8');
  const project = verifyOwner(id,owner,config);
  if (isAlive(owner.runnerPid)) throw new Error('Run is still active; interrupt its runner and let finally-cleanup finish');
  const host = (await exec('docker',['context','inspect','--format','{{.Endpoints.docker.Host}}'])).stdout.trim();
  if ((process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix://')) || !host.startsWith('unix://')) throw new Error('Recovery requires local Docker');
  if (owner.trailPid && isAlive(owner.trailPid)) {
    const command = (await exec('ps',['-p',String(owner.trailPid),'-o','command='])).stdout;
    if (!command.includes(`--depot ${directory}/traildepot run `)) throw new Error('PID was reused; refusing to terminate unrelated process');
    process.kill(owner.trailPid,'SIGTERM');
    const deadline = Date.now()+5000;
    while (isAlive(owner.trailPid) && Date.now()<deadline) await new Promise(yes=>setTimeout(yes,100));
    if (isAlive(owner.trailPid)) throw new Error('Native fixture did not stop; inspect before retrying recovery');
  }
  await exec(cli,['stop','--no-backup','--workdir',directory,'--agent','no','--network-id',`supabase_network_${project}`],{ timeout:60000 });
  const networks=(await exec('docker',['network','ls','-q','--filter',`name=^supabase_network_${project}$`])).stdout.trim();
  if (networks) await exec('docker',['network','rm',`supabase_network_${project}`]);
  const remaining = (await exec('docker',['ps','-aq','--filter',`name=_${project}$`])).stdout.trim();
  if (remaining) throw new Error('Owned containers remain; recovery not complete');
  for (const resource of ['volume','network']) {
    const remaining = (await exec('docker',[resource,'ls','-q','--filter',`name=_${project}$`])).stdout.trim();
    if (remaining) throw new Error(`Owned ${resource} remains; recovery not complete`);
  }
  await rm(resolve(directory,'traildepot'),{recursive:true,force:true});
  await rm(resolve(directory,'context.json'),{force:true});
  let lock;
  try { lock=JSON.parse(await readFile('.runtime/phase-a.lock/owner.json','utf8')); }
  catch(error) { if(error.code!=='ENOENT') throw error; }
  if (lock?.runId === id) await rm('.runtime/phase-a.lock',{recursive:true});
  console.log(`Recovered owned fixture ${id}; private diagnostics retained, credentials/depot removed.`);
}
if (resolve(process.argv[1] ?? '') === resolve('scripts/cleanup.mjs')) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode=1; }
}
