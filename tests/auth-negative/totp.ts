import { createHmac } from 'node:crypto';

// Fixture-only RFC6238 code generation; never shipped as an SDK MFA API.
export function totp(uri: string, time = Date.now()): string {
  let url: URL;
  try { url = new URL(uri); } catch { throw new Error('Unsupported fixture TOTP'); }
  const secret = url.searchParams.get('secret') ?? '';
  if (url.protocol !== 'otpauth:' || url.hostname !== 'totp' || (url.searchParams.get('algorithm') ?? 'SHA1') !== 'SHA1' || (url.searchParams.get('digits') ?? '6') !== '6' || (url.searchParams.get('period') ?? '30') !== '30' || !/^[A-Z2-7]{16,128}$/.test(secret) || !Number.isSafeInteger(time) || time < 0) throw new Error('Unsupported fixture TOTP');
  const bytes: number[] = []; let value = 0, bits = 0;
  for (const character of secret) {
    value = value * 32 + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(character); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push(value >>> bits); value &= (1 << bits) - 1; }
  }
  if (value !== 0) throw new Error('Unsupported fixture TOTP');
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(time / 30000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  return String((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}
