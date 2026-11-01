import { test, expect } from '@playwright/test';
import { context } from '../phase-a/helpers.js';
import { taskFlow } from '../sdk-browser/task-flow.js';

test('L1-14–20/L1-24/L1-26/E01 private HTTPS usable tasks, account-state errors, real mail and two-owner isolation', async ({ browser }) => {
  test.setTimeout(120000);
  const env = await context(), origin = 'https://aspire.tailb03e.ts.net:18443', inbox = 'https://aspire.tailb03e.ts.net:18444';
  if (env.publicOrigin !== origin) throw new Error('Use only the approved owned tailnet todos launcher context');
  const marker = await fetch(`${origin}/phase-a-owner.txt`, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!marker.ok || await marker.text() !== env.id) throw new Error('HTTPS proxy is not the expected owned fixture');
  async function confirm(email: string) {
    let link: string | undefined;
    await expect.poll(async () => {
      const search = await fetch(`${inbox}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`, { redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!search.ok) throw new Error('Private HTTPS inbox search failed');
      const result = await search.json();
      if (!result.messages?.length) return false;
      const response = await fetch(`${inbox}/api/v1/message/${encodeURIComponent(result.messages[0].ID)}`, { redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Private HTTPS message read failed');
      const mail = await response.json();
      const body = `${mail.HTML ?? ''}\n${mail.Text ?? ''}`.replaceAll('&amp;', '&');
      link = (body.match(/https?:\/\/[^\s<>"']+/g) ?? []).find(value => new URL(value).pathname.includes('verify'));
      return !!link;
    }, { timeout: 30000 }).toBe(true);
    let target = link!;
    for (let i = 0; i < 5; i++) {
      if (new URL(target).origin !== origin) throw new Error('Confirmation URL/redirect escaped approved HTTPS origin');
      const response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get('location');
        if (!next) throw new Error('Confirmation redirect missing');
        target = new URL(next, target).href;
      } else {
        if (!response.ok) throw new Error('Real remote email confirmation failed');
        return;
      }
    }
    throw new Error('Confirmation redirect limit exceeded');
  }
  await taskFlow(browser, origin, confirm);
});
