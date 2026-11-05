import { expect, it } from 'vitest';
import * as app from '../../examples/todos/app.js';

it('DL-ST02 sample path convention is exact UUIDv4, not File.name or a general SDK validator', () => {
  const valid = Reflect.get(app, 'daylistAttachmentPath'); expect(valid).toBeTypeOf('function');
  const path = 'daylist/7ec6bd30-e022-4900-8050-427e3a121344.bin'; expect(valid(path)).toBe(true);
  for (const bad of ['', path + ' ', ' ' + path, path.toUpperCase(), '/' + path, path.replace('/','//'), path.replace('4900','1900'), path.replace('8050','7050'), '../a', 'daylist/a%2Fz', 'daylist/file.txt', path + '/']) expect(valid(bad)).toBe(false);
});

for (const [name, original, returned, expected] of [
  ['empty bytes', [], [], true], ['binary bytes', [0, 255, 128, 10], [0, 255, 128, 10], true],
  ['same-size mismatch', [0, 1], [0, 2], false], ['size mismatch', [0, 1], [0], false],
] as const) it(`DL-ST02 read-back comparison consumes complete actual Blob bytes: ${name}`, async () => {
  const match = Reflect.get(app, 'attachmentBytesMatch'); expect(match).toBeTypeOf('function');
  expect(await match(new Blob([new Uint8Array(original)]), new Blob([new Uint8Array(returned)], { type: 'text/plain;charset=utf-8' }))).toBe(expected);
});

it('DL-ST01 sample paths reject every trailing control, including JavaScript regex final-newline behavior', () => {
  const valid = Reflect.get(app, 'daylistAttachmentPath');
  const path = 'daylist/7ec6bd30-e022-4900-8050-427e3a121344.bin';
  for (const suffix of ['\n', '\r', '\r\n', '\0', '\t']) expect(valid(path + suffix)).toBe(false);
});

for (const failOriginal of [false, true]) it(`DL-ST04 mocked Blob read failure drains the other accepted read (original failure=${failOriginal})`, async () => {
  const match = Reflect.get(app, 'attachmentBytesMatch');
  let release!: (value: ArrayBuffer) => void;
  const pending = new Promise<ArrayBuffer>(resolve => { release = resolve; });
  class HeldBlob extends Blob { override arrayBuffer() { return pending; } }
  class FailedBlob extends Blob { override arrayBuffer() { return Promise.reject(new Error('MOCK_READ_FAILURE')); } }
  const held = new HeldBlob(['x']), failed = new FailedBlob(['x']); let settled = false;
  const result = match(failOriginal ? failed : held, failOriginal ? held : failed).then((value: boolean) => { settled = true; return value; }, () => { settled = true; return 'rejected'; });
  await new Promise<void>(done => setImmediate(done));
  try { expect(settled).toBe(false); } finally { release(new ArrayBuffer(1)); }
  expect(await result).toBe(false);
});

it('DL-ST02 Blob metadata/claimed checksum or size is not byte evidence', async () => {
  const match = Reflect.get(app, 'attachmentBytesMatch'); expect(match).toBeTypeOf('function');
  for (const bad of [null, { size: 1, checksum: 'same', arrayBuffer: () => new ArrayBuffer(1) }]) expect(await match(new Blob(['x']), bad)).toBe(false);
});
