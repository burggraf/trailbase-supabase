import { it, expect } from 'vitest';
import { httpStreamFixture } from '../proofs/http-stream-fixture.js';
for (const route of ['/api/auth/v1/logout/global', '/auth/v1/logout?scope=global'] as const) it(`L1-19/GL06 wire fixture binds only exact POST ${route} without inventing upstream success`, async () => {
  let calls = 0;
  const fixture = await httpStreamFixture(async () => { calls++; return new Response('transport-unit-bytes', { status: 201 }); }, 'fragment', route);
  try {
    expect(fixture.url.endsWith(route)).toBe(true);
    expect((await fetch(fixture.url)).status).toBe(404);
    expect(calls).toBe(0);
    const response = await fetch(fixture.url, { method: 'POST' });
    expect(response.status).toBe(201); expect(await response.text()).toBe('transport-unit-bytes');
    await fixture.idle(); expect(calls).toBe(1); expect(fixture.stats().active).toBe(0);
  } finally { await fixture.close(); expect(fixture.stats().listening).toBe(false); }
});
it('L1-19/GL06 wire fixture refuses arbitrary paths before allocating a server', async () => {
  let fixture: Awaited<ReturnType<typeof httpStreamFixture>> | undefined;
  try {
    fixture = await httpStreamFixture(async () => new Response(), 'drop', '/foreign' as never);
    expect.fail('Arbitrary route was accepted');
  } catch (error) { expect(error).toBeInstanceOf(TypeError); }
  finally { await fixture?.close(); }
});
