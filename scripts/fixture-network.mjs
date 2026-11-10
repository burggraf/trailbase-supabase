import assert from 'node:assert/strict';
import { resolve } from 'node:path';

// The returned methods retain the creating operation. Snapshots/owner.json cannot adopt an ID.
// Endpoint/store probes are observations, not original daemon-process identity or attestation.
export function fixtureNetwork(runId, host, env, commands) {
  assert(typeof runId === 'string' && /^\d{13}-[a-f0-9]{12}$/.test(runId), 'Invalid fixture network run');
  assert(typeof host === 'string' && host.startsWith('unix:///') && !/[\0\r\n?#]/.test(host) && resolve(host.slice(7)) === host.slice(7), 'Invalid local Docker endpoint');
  const name = `supabase_network_trailbase-supabase-test-${runId.split('-')[1]}`;
  assert(typeof commands?.run === 'function' && typeof commands?.fence === 'function', 'Original Docker command owner required');
  let phase = 'new', id, engine, busy = false;
  const command = async args => (await commands.run(args, { timeout: 10000, maxBuffer: 1048576 })).stdout.trim();
  const ids = async filter => {
    const out = await command(['network', 'ls', '--no-trunc', '--format', '{{.ID}}', '--filter', filter]);
    const values = out ? out.split('\n') : [];
    assert(values.every(x => /^[a-f0-9]{64}$/.test(x)), 'Invalid Docker network inventory'); return values;
  };
  async function daemon() {
    const current = await command(['info', '--format', '{{.ID}}']);
    assert(/^[a-zA-Z0-9:_-]{1,128}$/.test(current), 'Invalid Docker daemon observation');
    if (engine !== undefined) assert.equal(current, engine, 'Fixture Docker daemon changed');
    return current;
  }
  async function inspect() {
    await daemon(); const found = await ids('id=' + id);
    assert(found.length === 0 || found.length === 1 && found[0] === id, 'Unexpected network ID');
    if (!found.length) return Object.freeze({ id, exists: false, containers: Object.freeze([]) });
    const value = JSON.parse(await command(['network', 'inspect', '--format', '{{json .}}', id]));
    assert.equal(value.Id, id, 'Network ID drift'); assert.equal(value.Name, name, 'Network name drift');
    assert.equal(value.Driver, 'bridge', 'Network driver drift'); assert.equal(value.Scope, 'local', 'Network scope drift');
    assert.equal(value.Labels?.['trailbase-supabase.run'], runId, 'Network owner label drift');
    assert.equal(value.Options?.['com.docker.network.bridge.host_binding_ipv4'], '127.0.0.1', 'Network binding drift');
    assert(value.Containers && typeof value.Containers === 'object' && !Array.isArray(value.Containers), 'Network endpoint inventory unavailable');
    const containers = Object.keys(value.Containers); assert(containers.every(x => /^[a-f0-9]{64}$/.test(x)), 'Invalid endpoint ID');
    return Object.freeze({ id, exists: true, containers: Object.freeze(containers) });
  }
  function enter(readOnly = false) { assert((phase === 'owned' || readOnly && phase === 'removed') && !busy, 'Fixture network creation ownership unavailable'); busy = true; }
  return Object.freeze({
    get id() { assert(phase === 'owned' && id, 'Fixture network creation ownership unavailable'); return id; },
    async create() {
      assert.equal(phase, 'new', 'Fixture network creation is once-only'); phase = 'creating';
      try {
        engine = await daemon(); assert.deepEqual(await ids('name=^' + name + '$'), [], 'Existing fixture network refused');
        const created = await command(['network', 'create', '--driver', 'bridge', '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', '--label', 'trailbase-supabase.run=' + runId, name]);
        assert(/^[a-f0-9]{64}$/.test(created), 'Network creation ID unavailable'); id = created; phase = 'owned';
      } catch (error) { phase = 'unknown'; throw error; }
    },
    async inventory() {
      enter(true); try {
        const removed = phase === 'removed', value = await inspect();
        if (removed) assert.equal(value.exists, false, 'Removed original network reappeared');
        return value; // Observation after removal never restores create/delete authority.
      } catch (error) { phase = 'unknown'; throw error; } finally { busy = false; }
    },
    async remove() {
      enter(); try {
        const before = await inspect(); assert.equal(before.containers.length, 0, 'Network still has attached endpoints');
        if (before.exists) await command(['network', 'rm', id]);
        await daemon(); assert.deepEqual(await ids('id=' + id), [], 'Network removal unconfirmed'); phase = 'removed';
      } catch (error) { phase = 'unknown'; throw error; } finally { busy = false; }
    },
  });
}
