import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { context, verificationLink, nativeUuid } from '../phase-a/helpers.js';

// Phase A exercises actual browser HTTP/CORS/mail/database infrastructure.
// It is NOT the later application's SDK/UI E01-E15 conformance suite.
for (const backend of ['trailbase','supabase'] as const) {
  test(`L1-27/E01/E03 infrastructure: ${backend} confirmation, explicit password login, protected write/read`, async ({ page }) => {
    const env = await context();
    await page.context().route('**/*', route => {
      const url = new URL(route.request().url());
      return env.origins.includes(url.origin) ? route.continue() : route.abort();
    });
    const email = `browser-${backend}-${randomUUID()}@example.test`;
    const password = `Fixture-${randomUUID()}-Aa1!`;
    const config = { backend, base: backend === 'trailbase' ? env.trailUrl : env.supabaseUrl, key: env.anonKey, email, password };
    await page.goto(env.trailUrl);
    const signup = await page.evaluate(async config => {
      const native = config.backend === 'trailbase';
      const response = await fetch(`${config.base}${native ? '/api/auth/v1/register' : '/auth/v1/signup'}`, {
        method:'POST', credentials:'omit', headers:{ 'content-type':'application/json', ...(native ? {} : { apikey:config.key }) },
        body:JSON.stringify(native ? { email:config.email,password:config.password,password_repeat:config.password } : { email:config.email,password:config.password })
      });
      const body = native ? undefined : await response.json();
      return { ok:response.ok, hasSession: Boolean(body?.access_token) };
    },config);
    expect(signup.ok).toBe(true); expect(signup.hasSession).toBe(false);
    const unconfirmed = await page.evaluate(async config => {
      const native = config.backend === 'trailbase';
      const response = await fetch(`${config.base}${native ? '/api/auth/v1/login' : '/auth/v1/token?grant_type=password'}`, {
        method:'POST', credentials:'omit', headers:{ 'content-type':'application/json', ...(native ? {} : { apikey:config.key }) },
        body:JSON.stringify(native ? { email_or_username:config.email,password:config.password } : { email:config.email,password:config.password })
      });
      return response.ok;
    },config);
    expect(unconfirmed).toBe(false);
    const link = await verificationLink(env,email);
    await page.goto(link); // Real inbox link, followed in the actual browser; no admin confirmation.
    await page.goto(env.trailUrl); // Discard URL grant; require explicit supported password login.
    const result = await page.evaluate(async ({ config, id, title }) => {
      const native = config.backend === 'trailbase';
      const headers: Record<string,string> = { 'content-type':'application/json', ...(native ? {} : { apikey:config.key }) };
      const login = await fetch(`${config.base}${native ? '/api/auth/v1/login' : '/auth/v1/token?grant_type=password'}`, {
        method:'POST', credentials:'omit', headers,
        body:JSON.stringify(native ? { email_or_username:config.email,password:config.password } : { email:config.email,password:config.password })
      });
      if (!login.ok) return { login:false, inserted:false, read:false };
      const session = await login.json();
      const token = native ? session.auth_token : session.access_token;
      const owner = native ? JSON.parse(atob(token.split('.')[1].replaceAll('-','+').replaceAll('_','/'))).sub : session.user.id;
      headers.authorization = `Bearer ${token}`;
      if (native) headers['csrf-token'] = session.csrf_token;
      const endpoint = `${config.base}${native ? '/api/records/v1/todos' : '/rest/v1/todos'}`;
      const inserted = await fetch(endpoint,{ method:'POST',credentials:'omit',headers,body:JSON.stringify({ id,user_id:owner,title }) });
      const response = await fetch(`${endpoint}${native ? '' : '?select=*'}`,{ credentials:'omit',headers });
      if (!response.ok) return { login:true, inserted:inserted.ok, read:false };
      const body = await response.json();
      const rows = native ? body.records : body;
      return { login:true, inserted:inserted.ok, read:rows.length===1 && rows[0].title===title && rows[0].user_id===owner };
    },{ config, id:backend==='trailbase' ? nativeUuid(randomUUID()) : randomUUID(), title:`browser-row-${randomUUID()}` });
    expect(result.login).toBe(true); expect(result.inserted).toBe(true); expect(result.read).toBe(true);
    expect(new URL(page.url()).origin).toBe(env.trailUrl);
  });
}
