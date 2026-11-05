import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function boot(page: Page, capabilities = 'none', signedIn = true) {
  // WebKit routes blob: too; abort actual HTTP(S) network, not owned local Blob URLs.
  await page.route(/^https?:/, route => route.abort());
  const [source, fixture, css] = await Promise.all(['examples/todos/app.js', 'tests/todos-mock/fixture.js', 'examples/todos/styles.css'].map(path => readFile(path, 'utf8')));
  await page.setContent(`<style>${css}</style><main id="todos"></main>`);
  await page.evaluate(async ({ source, fixture, capabilities, signedIn }) => {
    const app = await import(`data:text/javascript;base64,${btoa(unescape(encodeURIComponent(source)))}`);
    const mock = await import(`data:text/javascript;base64,${btoa(unescape(encodeURIComponent(fixture)))}`);
    Reflect.set(window, '__daylist', mock.initializeMock(app, document.querySelector('#todos'), { capabilities, signedIn }));
  }, { source, fixture, capabilities, signedIn });
  if (signedIn) await expect(page.getByRole('list', { name: 'Tasks', exact: true }).locator('li')).toHaveCount(20);
}
const model = <T = unknown>(page: Page, expression: string) => page.evaluate<T>(`(() => { const s = window.__daylist; return (${expression}); })()`);
async function upload(page: Page, bytes = 'selected bytes') {
  await page.getByRole('button', { name: 'New unique path' }).click();
  await page.getByLabel('Attachment file', { exact: true }).setInputFiles({ name: 'not-the-object-key.html', mimeType: 'text/html', buffer: Buffer.from(bytes) });
  await page.getByRole('button', { name: 'Upload and check read-back' }).click();
}

test('DL-ST01/RT01 missing APIs visibly unavailable, auth/task refresh remains authoritative', async ({ page }) => {
  await boot(page);
  await expect(page.getByLabel('Realtime status')).toContainText('UNAVAILABLE');
  await expect(page.getByLabel('Attachments status')).toContainText('UNAVAILABLE');
  await expect(page.getByRole('button', { name: 'Connect live updates' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Upload and check read-back' })).toBeDisabled();
  await page.getByRole('button', { name: 'Refresh tasks', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Upload and check read-back' })).toBeDisabled();
  expect(await model(page, 's.reads.length')).toBe(2);
  expect(await model(page, '[s.channels.length,s.uploads.length,s.downloads.length]')).toEqual([0, 0, 0]);
});

test('DL-ST01/RT01 partial methods are unfinished, never shimmed', async ({ page }) => {
  await boot(page, 'storage-partial');
  await expect(page.getByLabel('Attachments status')).toContainText('UNAVAILABLE');
  await expect(page.getByRole('button', { name: 'Upload and check read-back' })).toBeDisabled();
  await page.evaluate('window.__daylist.ui.dispose()');
  await boot(page, 'realtime-partial');
  await page.getByRole('button', { name: 'Connect live updates' }).click();
  await expect(page.getByLabel('Realtime status')).toContainText('UNAVAILABLE');
  expect(await model(page, 's.channels.length')).toBe(1);
});

test('DL-RT01 throwing unfinished capability getter does not break existing tasks', async ({ page }) => {
  await boot(page, 'realtime-getter');
  await expect(page.getByLabel('Realtime status')).toContainText('UNAVAILABLE');
  await page.getByRole('button', { name: 'Refresh tasks', exact: true }).click();
  expect(await model(page, 's.reads.length')).toBe(2);
});

test('DL-ST02 mocked acknowledgement waits for fresh complete matching read-back; Blob download is local-save only', async ({ page }) => {
  await boot(page, 'storage'); await model(page, '(s.holdDownload=true)'); await upload(page);
  await expect(page.getByLabel('Attachments status')).toContainText('MOCK · Upload acknowledged; read-back UNVERIFIED');
  await expect.poll(() => model(page, 's.downloads.length')).toBe(1);
  await expect(page.getByLabel('Attachments status')).not.toContainText('Read-back bytes match');
  expect(await model(page, 's.uploads')).toEqual([{ path: 'daylist/00000000-0000-4000-8000-000000000001.bin', arguments: 2, blob: true }]);
  expect(await model(page, 's.downloads[0]')).toEqual({ path: 'daylist/00000000-0000-4000-8000-000000000001.bin', arguments: 1 });
  await model(page, 's.releaseDownload()');
  await expect(page.getByLabel('Attachments status')).toContainText('MOCK · Read-back bytes match selected file');
  await expect(page.getByLabel('Attachments status')).toContainText('not durability');
  await expect(page.getByRole('button', { name: 'Upload and check read-back' })).toBeDisabled();
  await page.getByRole('button', { name: 'Download attachment' }).click();
  const link = page.getByRole('link', { name: 'Save downloaded attachment' });
  await expect(link).toHaveAttribute('href', /^blob:/); await expect(link).toHaveAttribute('download', 'attachment.bin');
  const url = await link.getAttribute('href'); expect(url).toBeTruthy();
  expect(await page.evaluate(async url => (await fetch(url!)).text(), url)).toBe('selected bytes');
  await page.getByLabel('Attachment path', { exact: true }).fill('daylist/00000000-0000-4000-8000-000000000002.bin');
  await expect(link).toBeHidden();
  expect(await page.evaluate(async url => { try { await fetch(url!); return false; } catch { return true; } }, url)).toBe(true);
});

for (const mode of ['lost', 'download-error', 'wrong', 'bad-ack']) test(`DL-ST03 ${mode}: no false success, raw errors, retry or overwrite`, async ({ page }) => {
  await boot(page, 'storage'); await model(page, `(s.mode=${JSON.stringify(mode)})`); await upload(page);
  await expect(page.getByLabel('Attachments status')).toContainText('UNVERIFIED');
  await expect(page.getByLabel('Attachments status')).not.toContainText('PRIVATE_CANARY');
  await expect(page.getByLabel('Attachments status')).not.toContainText('Read-back bytes match');
  await expect(page.getByRole('button', { name: 'Upload and check read-back' })).toBeDisabled();
  expect(await model(page, 's.uploads.length')).toBe(1);
  expect(await model(page, 's.downloads.length')).toBe(['lost', 'bad-ack'].includes(mode) ? 0 : 1);
});

test('DL-ST03 sample path/size guard dispatches nothing, not an SDK limit claim', async ({ page }) => {
  await boot(page, 'storage');
  await page.getByLabel('Attachment file', { exact: true }).setInputFiles({ name: 'x', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  for (const path of ['../bad', ' daylist/00000000-0000-4000-8000-000000000001.bin']) {
    await page.getByLabel('Attachment path', { exact: true }).fill(path);
    await page.getByRole('button', { name: 'Upload and check read-back' }).click();
    await expect(page.getByLabel('Attachments status')).toContainText('sample path');
  }
  await page.getByRole('button', { name: 'New unique path' }).click();
  await page.getByLabel('Attachment file', { exact: true }).setInputFiles({ name: 'large', mimeType: 'application/octet-stream', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await page.getByRole('button', { name: 'Upload and check read-back' }).click();
  await expect(page.getByLabel('Attachments status')).toContainText('5 MiB sample limit');
  expect(await model(page, '[s.uploads.length,s.downloads.length]')).toEqual([0, 0]);
});

test('DL-ST04 late upload after auth replacement cannot download or publish to new view', async ({ page }) => {
  await boot(page, 'storage'); await model(page, '(s.holdUpload=true)'); await upload(page);
  await expect.poll(() => model(page, 's.uploads.length')).toBe(1);
  await model(page, "s.emit('SIGNED_IN','owner-b')");
  await expect(page.getByLabel('Auth status')).toContainText('owner-b');
  await model(page, 's.releaseUpload()');
  await expect(page.getByLabel('Attachments status')).not.toContainText('Read-back bytes match');
  expect(await model(page, 's.downloads.length')).toBe(0);
  expect(await page.getByLabel('Attachment path', { exact: true }).inputValue()).toBe('');
});

test('DL-RT01/02 exact opt-in subscription; bursts bounded, filter/page/focus preserved', async ({ page }) => {
  await boot(page, 'realtime'); expect(await model(page, 's.channels.length')).toBe(0);
  await page.getByRole('tab', { name: 'Active', exact: true }).click();
  await page.getByRole('button', { name: 'Next tasks' }).click();
  await expect(page.locator('.pagination span')).toHaveText('Page 2');
  await page.getByRole('button', { name: 'Connect live updates' }).click();
  await expect(page.getByLabel('Realtime status')).toContainText('MOCK · Live updates connected');
  expect(await model(page, '({event:s.channels[0].event,filter:s.channels[0].filter})')).toEqual({ event: 'postgres_changes', filter: { event: '*', schema: 'public', table: 'todos' } });
  const checkbox = page.locator('.task-list input[type=checkbox]').first(); await checkbox.focus();
  const before = await model<number>(page, 's.reads.length'); await model(page, '(s.holdRead=true, Array.from({length:40},()=>s.notify()))');
  await expect.poll(() => model(page, 's.reads.length')).toBe(before + 1);
  await model(page, 'Array.from({length:40},()=>s.notify())');
  expect(await model(page, 's.reads.length')).toBe(before + 1);
  await model(page, 's.releaseRead()');
  await expect.poll(() => model(page, 's.reads.length')).toBe(before + 2);
  await expect(page.getByRole('tab', { name: 'Active', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.pagination span')).toHaveText('Page 2'); await expect(checkbox).toBeFocused();
  expect(await model(page, 's.reads.at(-1).first')).toBe(20);
});

test('DL-RT02 does not steal moved focus or overwrite an editing draft', async ({ page }) => {
  await boot(page, 'realtime'); await page.getByRole('button', { name: 'Connect live updates' }).click();
  await page.locator('.task-list [data-task-action=edit]').first().click();
  const draft = page.getByRole('textbox', { name: 'Task title', exact: true }); await draft.fill('unsaved draft');
  const before = await model<number>(page, 's.reads.length'); await model(page, 's.notify()');
  await expect(page.getByLabel('Realtime status')).toContainText('waiting');
  expect(await model(page, 's.reads.length')).toBe(before); await expect(draft).toHaveValue('unsaved draft');
  await draft.press('Escape'); await expect.poll(() => model(page, 's.reads.length')).toBe(before + 1);
  await model(page, '(s.holdRead=true)'); await page.locator('.task-list input[type=checkbox]').first().focus(); await model(page, 's.notify()');
  await expect.poll(() => model(page, 's.reads.length')).toBe(before + 2);
  // Outside task disabled controls, so genuine focus can move while refresh is held.
  await page.getByRole('button', { name: 'Sign out', exact: true }).focus(); await model(page, 's.releaseRead()');
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeFocused();
});

for (const mode of ['error', 'reject']) test(`DL-RT01/03 unsubscribe ${mode} stays unconfirmed, no reconnect`, async ({ page }) => {
  await boot(page, 'realtime'); await page.getByRole('button', { name: 'Connect live updates' }).click();
  await model(page, `(s.unsubscribeMode=${JSON.stringify(mode)})`); await page.getByRole('button', { name: 'Stop live updates' }).click();
  await expect(page.getByLabel('Realtime status')).toContainText('cleanup UNCONFIRMED');
  await expect(page.getByLabel('Realtime status')).not.toContainText('PRIVATE_CANARY');
  await expect(page.getByRole('button', { name: 'Connect live updates' })).toBeDisabled();
  const before = await model<number>(page, 's.reads.length'); await model(page, 's.notify()');
  await page.getByRole('button', { name: 'Refresh tasks', exact: true }).click();
  expect(await model(page, 's.channels.length')).toBe(1); expect(await model(page, 's.reads.length')).toBe(before + 1);
  expect(await model(page, 's.ui.dispose()')).toBe('error');
});

test('DL-RT03 dispose seals events synchronously and joins held refresh/unsubscribe, with stable receipt', async ({ page }) => {
  await boot(page, 'realtime'); await page.getByRole('button', { name: 'Connect live updates' }).click();
  const before = await model<number>(page, 's.reads.length'); await model(page, '(s.holdRead=true,s.holdUnsubscribe=true,s.notify())');
  await expect.poll(() => model(page, 's.reads.length')).toBe(before + 1);
  expect(await model(page, '(s.first=s.ui.dispose(),s.second=s.ui.dispose(),s.first===s.second)')).toBe(true);
  await model(page, '(s.done=false,s.first.then(value=>{s.done=true;s.disposition=value}),s.notify())');
  expect(await model(page, 's.done')).toBe(false); expect(await model(page, 's.listenerCount()')).toBe(0);
  await model(page, 's.releaseRead()'); expect(await model(page, 's.done')).toBe(false);
  await model(page, 's.releaseUnsubscribe()'); await expect.poll(() => model(page, 's.done')).toBe(true);
  expect(await model(page, 's.disposition')).toBe('ok'); expect(await model(page, 's.channels[0].stops')).toBe(1);
  expect(await model(page, 's.reads.length')).toBe(before + 1);
});

test('DL-RT01 accepted subscription invalidates once, without claiming a snapshot barrier', async ({ page }) => {
  await boot(page, 'realtime'); await page.getByRole('button', { name: 'Connect live updates' }).click();
  await expect.poll(() => model(page, 's.reads.length')).toBe(2);
  expect(await model(page, 's.channels.length')).toBe(1);
});

test('DL-RT02 removal of focused row moves focus to task entry, not the document body', async ({ page }) => {
  await boot(page, 'realtime'); await page.getByRole('button', { name: 'Connect live updates' }).click();
  await page.locator('.task-list input[type=checkbox]').first().focus();
  const before = await model<number>(page, 's.reads.length'); await model(page, '(s.rows.shift(),s.notify())');
  await expect.poll(() => model(page, 's.reads.length')).toBe(before + 1);
  await expect(page.getByRole('textbox', { name: 'New task', exact: true })).toBeFocused();
});

test('DL-REG01 live invalidation must not erase an unconfirmed write diagnostic before manual reconciliation', async ({ page }) => {
  await boot(page, 'realtime'); await page.getByRole('button', { name: 'Connect live updates' }).click();
  await expect.poll(() => model(page, 's.reads.length')).toBe(2);
  await model(page, "(s.mode='write-unknown')");
  await page.getByRole('textbox', { name: 'New task', exact: true }).fill('Possibly saved task');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.getByLabel('Task error')).toContainText('TASK_OUTCOME_UNKNOWN');
  const before = await model<number>(page, 's.reads.length'); await model(page, 's.notify()');
  await expect(page.getByLabel('Realtime status')).toContainText('waiting');
  await expect(page.getByLabel('Task error')).toContainText('TASK_OUTCOME_UNKNOWN');
  expect(await model(page, 's.reads.length')).toBe(before);
  await page.getByRole('button', { name: 'Refresh tasks', exact: true }).click();
  await expect(page.getByText('Possibly saved task', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Task error')).toBeEmpty();
  expect(await model(page, 's.writes.length')).toBe(1);
});

test('DL-ST04 pending attachment disposal waits without follow-up read or late verification', async ({ page }) => {
  await boot(page, 'storage'); await model(page, '(s.holdUpload=true)'); await upload(page);
  await expect.poll(() => model(page, 's.uploads.length')).toBe(1);
  await model(page, '(s.done=false,s.first=s.ui.dispose(),s.first.then(()=>{s.done=true}),undefined)');
  expect(await model(page, 's.done')).toBe(false); await model(page, 's.releaseUpload()');
  await expect.poll(() => model(page, 's.done')).toBe(true);
  expect(await model(page, 's.downloads.length')).toBe(0);
  await expect(page.getByLabel('Attachments status')).not.toContainText('Read-back bytes match');
});

test('DL-RT03 same-user sign-in retires feature callbacks without token comparisons or losing task view', async ({ page }) => {
  await boot(page, 'realtime'); await page.getByRole('tab', { name: 'Active', exact: true }).click();
  await page.getByRole('button', { name: 'Next tasks' }).click(); await page.getByRole('button', { name: 'Connect live updates' }).click();
  await model(page, "s.emit('SIGNED_IN','owner-a')");
  await expect(page.getByLabel('Realtime status')).toContainText('Feature view retired');
  await expect(page.locator('.pagination span')).toHaveText('Page 2');
  await expect(page.getByRole('tab', { name: 'Active', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => model(page, 's.channels[0].stops')).toBe(1);
  const before = await model<number>(page, 's.reads.length'); await model(page, 's.notify()');
  await page.getByRole('button', { name: 'Refresh tasks', exact: true }).click();
  expect(await model(page, 's.reads.length')).toBe(before + 1);
});

test('DL-REG01 mocked original signup/login/CRUD/filter/manual refresh/logout with APIs absent', async ({ page }) => {
  await boot(page, 'none', false); await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('mock-only@example.test');
  await page.getByLabel('Password', { exact: true }).fill('mock-only-not-a-credential');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText('Confirm your email, then sign in.', { exact: true })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('mock-only-not-a-credential'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('textbox', { name: 'New task', exact: true }).fill('Fresh task'); await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await page.getByRole('button', { name: 'Edit task: Fresh task', exact: true }).click();
  await page.getByRole('textbox', { name: 'Task title', exact: true }).fill('Renamed task'); await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Complete Renamed task', exact: true }).check();
  await page.getByRole('tab', { name: 'Completed', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Tasks', exact: true }).locator('li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Refresh tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Delete task: Renamed task', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Tasks', exact: true }).locator('li')).toHaveCount(0);
  expect(await model(page, 's.writes.map(write=>write.operation)')).toEqual(['insert', 'update', 'update', 'delete']);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page.getByLabel('Auth status')).toHaveText('Signed out');
});
