import { FetchError } from 'trailbase';
import type { QueryError } from './index.js';

export function plainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be a plain object with own fields`);
  }
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !Object.getOwnPropertyDescriptor(value, key)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'))) {
    throw new TypeError(`${label} must contain enumerable own data fields`);
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function unsupported(message: string): never {
  const error = new Error(message);
  error.name = 'UnsupportedFeatureError';
  throw error;
}

function assertUuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) throw new TypeError('Expected a canonical UUIDv4');
}

export function uuidToNative(value: unknown): string {
  assertUuid(value);
  const hex = value.replaceAll('-', '');
  let bytes = '';
  for (let index = 0; index < hex.length; index += 2) bytes += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16));
  return btoa(bytes).replaceAll('+', '-').replaceAll('/', '_');
}

export function uuidFromNative(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected native UUID bytes');
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  let decoded: string;
  try { decoded = atob(base64); } catch { throw new TypeError('Invalid native UUID bytes'); }
  if (decoded.length !== 16) throw new TypeError('Invalid native UUID length');
  const hex = Array.from(decoded, byte => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  assertUuid(uuid);
  return uuid;
}

export function normalizeError(error: unknown): QueryError {
  if (error instanceof Error || error instanceof FetchError) {
    const status = Reflect.get(error, 'status');
    const code = Reflect.get(error, 'code');
    const details = Reflect.get(error, 'details');
    const hint = Reflect.get(error, 'hint');
    return {
      name: error.name,
      message: error.message,
      ...(typeof status === 'number' && { status }),
      ...(typeof code === 'string' && { code }),
      ...(typeof details === 'string' && { details }),
      ...(typeof hint === 'string' && { hint }),
    };
  }
  return { name: 'Error', message: String(error) };
}
