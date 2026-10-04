import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { initClient as createTrailClient } from 'trailbase';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { assertRunDirectory, assertLocalUrl } from '../../scripts/harness.mjs';

export async function deadline<T>(promise: Promise<T>, milliseconds = 10000, label = 'Async operation'): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_,no) => { timer = setTimeout(() => no(new Error(`${label} deadline exceeded`)), milliseconds); })]);
  } finally { clearTimeout(timer!); }
}

export type Context = { id: string; project: string; directory: string; origins: string[]; trailUrl: string; supabaseUrl: string; mailUrl: string; anonKey: string; authVariant: 'stock' | 'candidate-email-reservation' | 'private-native-prototype'; prototypePatchSha256?: string; nativeAuthProfile: 'default'|'short-native-auth' };
export async function context(): Promise<Context> {
  const path = process.env.PHASE_A_CONTEXT;
  if (!path || !path.endsWith('/context.json')) throw new Error('Run this suite via npm run test:phase-a (not a hosted backend)');
  const data: Context = JSON.parse(await readFile(path, 'utf8'));
  assertRunDirectory(data.directory);
  if (resolve(path) !== resolve(data.directory, 'context.json')) throw new Error('Fixture context mismatch');
  const owner = JSON.parse(await readFile(resolve(data.directory, 'owner.json'), 'utf8'));
  const variantsMatch = data.authVariant === 'private-native-prototype'
    ? data.prototypePatchSha256 === 'c76f14a0bff3f391435a10073c2fb741d0c27528bdd29dfad464022d1d0f86c9'
    : data.prototypePatchSha256 === undefined;
  if (owner.id !== data.id || owner.project !== data.project || owner.authVariant !== data.authVariant || owner.nativeAuthProfile !== data.nativeAuthProfile || owner.prototypePatchSha256 !== data.prototypePatchSha256 || !['default','short-native-auth'].includes(data.nativeAuthProfile) || !['stock','candidate-email-reservation','private-native-prototype'].includes(data.authVariant) || !variantsMatch) throw new Error('Fixture ownership/variant mismatch');
  for (const url of [data.trailUrl, data.supabaseUrl, data.mailUrl]) assertLocalUrl(url, data.origins);
  return data;
}
// Native BLOB inputs use padded URL-safe base64 (not Node's unpadded base64url encoding).
export const nativeUuid = (uuid: string) => Buffer.from(uuid.replaceAll('-', ''), 'hex').toString('base64').replaceAll('+', '-').replaceAll('/', '_');
export const canonicalUuid = (value: string) => {
  const hex = Buffer.from(value, 'base64url').toString('hex');
  if (hex.length !== 32) throw new Error('Unexpected native UUID length');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
export const supabase = (env: Context) => createSupabaseClient(env.supabaseUrl, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
export const trailbase = (env: Context) => createTrailClient(env.trailUrl);
export async function verificationLink(env: Context, email: string): Promise<string> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const response = await fetch(`${env.mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    if (!response.ok) throw new Error('Local inbox query failed');
    const inbox = await response.json();
    if (inbox.messages?.length) {
      const message = await fetch(`${env.mailUrl}/api/v1/message/${inbox.messages[0].ID}`).then(response => response.json());
      const body: string = `${message.HTML ?? ''}\n${message.Text ?? ''}`.replaceAll('&amp;', '&');
      const matches = body.match(/https?:\/\/[^\s<>"']+/g) ?? [];
      const link = matches.find(url => new URL(url).pathname.includes('verify'));
      if (!link) throw new Error('Real verification mail contains no verification link');
      assertLocalUrl(link, env.origins);
      return link;
    }
    await new Promise(yes => setTimeout(yes, 100));
  }
  throw new Error('Local verification mail deadline exceeded');
}
export async function confirmEmail(env: Context, email: string) {
      const link = await verificationLink(env, email);
      // Validate every redirect before following it; auth fragments/tokens never enter reports.
      let target = link;
      for (let i = 0; i < 5; i++) {
        assertLocalUrl(target, env.origins);
        const result = await fetch(target, { redirect: 'manual' });
        if (result.status >= 300 && result.status < 400) {
          const location = result.headers.get('location');
          if (!location) throw new Error('Verification redirect missing');
          target = new URL(location, target).href;
        } else {
          if (!result.ok) throw new Error(`Real verification request failed (HTTP ${result.status})`);
          return;
        }
      }
      throw new Error('Verification redirect limit exceeded');
}
export async function confirmedTrailUser(env: Context, label: string) {
  const email = `${label}-${randomUUID()}@example.test`;
  const password = `Fixture-${randomUUID()}-Aa1!`;
  const client = trailbase(env);
  await client.register({ email, password });
  await confirmEmail(env, email);
  await client.login(email, password);
  const user = client.user();
  if (!user) throw new Error('Confirmed native login failed');
  return { client, user, email, password };
}
export async function confirmedSupabaseUser(env: Context, label: string) {
  const email = `${label}-${randomUUID()}@example.test`;
  const password = `Fixture-${randomUUID()}-Aa1!`;
  const client = supabase(env);
  const signup = await client.auth.signUp({ email, password });
  if (signup.error || signup.data.session) throw new Error('Confirmation fixture signup failed');
  await confirmEmail(env, email);
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error || !login.data.user) throw new Error('Confirmed reference login failed');
  return { client, user: login.data.user, email, password };
}
