import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { verifyOwner, waitReady } from '../../scripts/harness.mjs';
import { exec } from '../../scripts/tools.mjs';
import { context, type Context } from '../phase-a/helpers.js';

const authTables = ['users', 'identities', 'sessions', 'refresh_tokens', 'one_time_tokens', 'flow_state', 'audit_log_entries'];
export const identity = (label: string) => ({ email: `reference-${label}-${randomUUID()}@example.test`, password: `Fixture-${randomUUID()}-Aa1!` });
export const replacementPassword = () => `Fixture-${randomUUID()}-Aa1!`;
export const fixtureEmail = (email: string) => {
  if (!/^[a-z0-9-]+@example\.test$/.test(email)) throw new Error('Only generated fixture email literals are permitted');
  return email;
};
export async function referenceContext() {
  const env = await context();
  if (env.authVariant !== 'stock' || env.nativeAuthProfile !== 'default' || env.nativeServerProfile !== 'default') throw new Error('Reference contracts require a fresh stock/default owned fixture');
  await ownedProject(env);
  return env;
}
async function ownedProject(env: Context) {
  const owner = JSON.parse(await readFile(resolve(env.directory, 'owner.json'), 'utf8'));
  const project = verifyOwner(env.id, owner, await readFile(resolve(env.directory, 'supabase/config.toml'), 'utf8'));
  if (project !== env.project) throw new Error('Reference project mismatch');
  const host = (await exec('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])).stdout.trim();
  if (!host.startsWith('unix://') || process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix://')) throw new Error('Reference database/fault checks require local Docker');
  return project;
}
async function sql<T>(env: Context, query: string): Promise<T> {
  const project = await ownedProject(env);
  const result = await exec('docker', ['exec', `supabase_db_${project}`, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], { timeout: 15000 });
  return JSON.parse(result.stdout.trim());
}
const digest = (value: string) => `encode(sha256(convert_to(${value},'UTF8')),'hex')`;
export async function authSnapshot(env: Context): Promise<Array<{ name: string; count: number; sha256: string }>> {
  // Hash complete sorted rows inside PostgreSQL: password hashes/refresh/confirmation tokens never enter diagnostic output.
  const rows = authTables.map(name => `SELECT '${name}' AS name,count(*) AS count,${digest("coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')")} AS sha256 FROM auth.${name} t`);
  return sql(env, `SELECT json_agg(to_jsonb(s) ORDER BY name) FROM (${rows.join(' UNION ALL ')}) s`);
}
export type Account = { id: string; email: string; confirmed: boolean; coreSha256: string; passwordSha256: string };
export async function account(env: Context, email: string): Promise<Account | null> {
  fixtureEmail(email);
  // Only the confirmation token/time and generic update timestamp may change during pending resend/signup retry.
  const core = "(to_jsonb(u)-ARRAY['confirmation_token','confirmation_sent_at','updated_at'])::text";
  return sql(env, `SELECT coalesce((SELECT json_build_object('id',id,'email',email,'confirmed',email_confirmed_at IS NOT NULL,'coreSha256',${digest(core)},'passwordSha256',${digest('encrypted_password')}) FROM auth.users u WHERE email='${email}'),'null'::json)`);
}
export async function sessionState(env: Context, email: string): Promise<{ sessions: number; activeRefreshTokens: number; sha256: string }> {
  fixtureEmail(email);
  // Fingerprint complete rows for this generated account, not merely response status or global counts.
  const sessions = `SELECT to_jsonb(s)::text AS row FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id WHERE u.email='${email}'`;
  const tokens = `SELECT to_jsonb(t)::text AS row FROM auth.refresh_tokens t JOIN auth.users u ON u.id::text=t.user_id::text WHERE u.email='${email}'`;
  return sql(env, `SELECT json_build_object('sessions',(SELECT count(*) FROM (${sessions}) s),'activeRefreshTokens',(SELECT count(*) FROM auth.refresh_tokens t JOIN auth.users u ON u.id::text=t.user_id::text WHERE u.email='${email}' AND NOT t.revoked),'sha256',${digest(`coalesce((SELECT string_agg(row,E'\\n' ORDER BY row) FROM (${sessions} UNION ALL ${tokens}) r),'')`)})`);
}
export async function mailCount(env: Context, email: string) {
  fixtureEmail(email);
  const response = await fetch(`${env.mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Owned inbox search failed');
  return (await response.json()).messages.length as number;
}
export async function withSmtpStopped(env: Context, test: () => Promise<void>) {
  const project = await ownedProject(env), container = `supabase_inbucket_${project}`;
  if ((await exec('docker', ['inspect', '--format', '{{.State.Running}}', container])).stdout.trim() !== 'true') throw new Error('Owned SMTP container is not initially running');
  try {
    await exec('docker', ['stop', '--time', '1', container], { timeout: 15000 });
    if ((await exec('docker', ['inspect', '--format', '{{.State.Running}}', container])).stdout.trim() !== 'false') throw new Error('SMTP outage was not established');
    await test();
  } finally {
    await exec('docker', ['start', container], { timeout: 15000 });
    await waitReady(`${env.mailUrl}/api/v1/messages`, 10000);
  }
}
export function observedResendClient(env: Context) {
  const observed = { status: 0, emptyObject: false };
  const client = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (new URL(input instanceof Request ? input.url : String(input)).pathname.endsWith('/auth/v1/resend')) {
        const body = await response.clone().json();
        observed.status = response.status;
        observed.emptyObject = body !== null && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0;
      }
      return response; // Observe real HTTP; never replace or stub auth responses.
    } },
  });
  return { client, observed };
}
export async function confirmationCooldown(env: Context) {
  const config = await readFile(resolve(env.directory, 'supabase/config.toml'), 'utf8');
  const frequency = config.match(/max_frequency\s*=\s*"(\d+)s"/);
  if (!frequency || Number(frequency[1]) < 1 || Number(frequency[1]) > 5) throw new Error('Reference cooldown is not the known bounded owned fixture setting');
  // Wait once for the configured server policy; never backdate rows, change policy or busy-retry a request.
  await new Promise(resolve => setTimeout(resolve, Number(frequency[1]) * 1000 + 150));
}
