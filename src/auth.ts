import { FetchError } from 'trailbase';
import { plainObject, unsupported, normalizeError, uuidFromNative } from './common.js';
import type { QueryError } from './index.js';

export type PasswordCredentials = { email: string; password: string };
export type AuthUser = { id: string; email: string | null };
export type AuthSession = { access_token: string; refresh_token: string; token_type: 'bearer'; expires_at: number; expires_in: number; user: AuthUser };
export type AuthError = QueryError;
export type AuthResponse = { data: { user: AuthUser | null; session: AuthSession | null }; error: AuthError | null };
export type AuthStorage = { getItem(key: string): string | null | Promise<string | null>; setItem(key: string, value: string): void | Promise<void>; removeItem(key: string): void | Promise<void> };
export type AuthOptions = { persistSession?: boolean; autoRefreshToken?: boolean; detectSessionInUrl?: false; storageKey?: string; storage?: AuthStorage };
export type AuthChangeEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED';

function credentials(value: unknown, arity: number): PasswordCredentials {
  if (arity !== 1) unsupported('Unsupported password auth arguments');
  plainObject(value, 'Password credentials');
  for (const key of Object.keys(value)) if (!['email', 'password'].includes(key)) unsupported(`Unsupported password credential option: ${key}`);
  if (!Object.hasOwn(value, 'email') || !Object.hasOwn(value, 'password') || typeof value.email !== 'string' || !value.email.trim() || typeof value.password !== 'string' || !value.password) throw new TypeError('Nonempty email and password required');
  return { email: value.email, password: value.password };
}
function namedError(name: string, message: string): Error { const error = new Error(message); error.name = name; return error; }
function decodePart(value: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError('Invalid JWT encoding');
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), byte => byte.charCodeAt(0));
  let decoded: unknown;
  try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw namedError('AuthInvalidPayloadError', 'Malformed native JWT JSON payload'); }
  plainObject(decoded, 'JWT claims'); return decoded;
}
type NativeCredentials = { auth_token: string; refresh_token: string; csrf_token: string | null };
type AuthState = { session: AuthSession; tokens: NativeCredentials };
function sessionFromNative(value: unknown, allowExpired = false): AuthSession {
  plainObject(value, 'Native login response');
  if (Object.hasOwn(value, 'mfa_token')) throw namedError('AuthMfaUnsupportedError', 'MFA authentication is not implemented');
  if (!Object.hasOwn(value, 'auth_token') || !Object.hasOwn(value, 'refresh_token') || typeof value.auth_token !== 'string' || typeof value.refresh_token !== 'string' || !/^[\x21-\x7e]+$/.test(value.refresh_token) || !Object.hasOwn(value, 'csrf_token') || !(value.csrf_token === null || typeof value.csrf_token === 'string' && /^[\x21-\x7e]+$/.test(value.csrf_token))) throw new TypeError('Invalid native login credentials');
  const parts = value.auth_token.split('.');
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[2])) throw new TypeError('Invalid native access JWT');
  const header = decodePart(parts[0]), claims = decodePart(parts[1]);
  if (!Object.hasOwn(header, 'alg') || typeof header.alg !== 'string' || !header.alg || header.alg.toLowerCase() === 'none') throw new TypeError('Invalid JWT algorithm');
  if (!['sub', 'iat', 'exp', 'email'].every(key => Object.hasOwn(claims, key)) || !(claims.email === null || typeof claims.email === 'string' && !!claims.email.trim()) || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || (claims.iat as number) < 0 || (claims.exp as number) <= (claims.iat as number) || (!allowExpired && (claims.exp as number) <= Date.now() / 1000) || (claims.iat as number) > Date.now() / 1000 || (claims.mfa !== undefined && typeof claims.mfa !== 'boolean')) throw new TypeError('Invalid native JWT claims');
  // Claims are cached identity information, not signature verification or live authorization.
  return { access_token: value.auth_token, refresh_token: value.refresh_token, token_type: 'bearer', expires_at: claims.exp as number, expires_in: (claims.exp as number) - (claims.iat as number), user: { id: uuidFromNative(claims.sub), email: claims.email as string | null } };
}

function validateStorage(value: unknown): asserts value is AuthStorage {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !['getItem', 'setItem', 'removeItem'].every(key => typeof Reflect.get(value, key) === 'function')) throw new Error();
  } catch { throw new TypeError('Storage must implement getItem, setItem and removeItem'); }
}
function stateFromNative(value: unknown, allowExpired = false): AuthState {
  const session = sessionFromNative(value, allowExpired);
  const input = value as NativeCredentials;
  return { session, tokens: { auth_token: input.auth_token, refresh_token: input.refresh_token, csrf_token: input.csrf_token } };
}
function decodeStored(value: unknown): AuthState | null {
  if (value === null) return null;
  try {
    if (typeof value !== 'string') throw new Error();
    const parsed: unknown = JSON.parse(value);
    plainObject(parsed, 'Stored credentials');
    if (!Object.hasOwn(parsed, 'version') || parsed.version !== 1 || Object.keys(parsed).length !== 2 || !Object.hasOwn(parsed, 'tokens')) throw new Error();
    plainObject(parsed.tokens, 'Stored native credentials');
    if (Object.keys(parsed.tokens).length !== 3 || Object.keys(parsed.tokens).some(key => !['auth_token', 'refresh_token', 'csrf_token'].includes(key))) throw new Error();
    return stateFromNative(parsed.tokens, true);
  } catch { throw namedError('AuthInvalidStoredSessionError', 'Invalid stored native session envelope'); }
}
const encodeStored = (state: AuthState) => JSON.stringify({ version: 1, tokens: state.tokens });

export function createAuth(base: URL, fetcher: typeof fetch, options: AuthOptions | undefined) {
  const enabled = options !== undefined;
  const ownOption = <Key extends keyof AuthOptions>(key: Key): AuthOptions[Key] | undefined => options !== undefined && Object.hasOwn(options, key) ? options[key] : undefined;
  if (enabled) {
    plainObject(options, 'Auth options');
    for (const key of Object.keys(options)) if (!['persistSession', 'autoRefreshToken', 'detectSessionInUrl', 'storageKey', 'storage'].includes(key)) unsupported(`Unsupported auth option: ${key}`);
    if (typeof ownOption('persistSession') !== 'boolean' || ownOption('autoRefreshToken') !== false) unsupported('Explicit persistSession boolean and autoRefreshToken:false required; default refresh is not implemented');
    const detectSessionInUrl = ownOption('detectSessionInUrl'), storageKey = ownOption('storageKey'), storage = ownOption('storage');
    if (detectSessionInUrl !== undefined && detectSessionInUrl !== false) unsupported('URL session adoption is not implemented');
    if (storageKey !== undefined && (typeof storageKey !== 'string' || !storageKey.trim() || /[\x00-\x1f\x7f]/.test(storageKey))) throw new TypeError('storageKey must be a nonempty control-free string');
    if (storage !== undefined) validateStorage(storage);
  }
  const persist = ownOption('persistSession') === true;
  const key = ownOption('storageKey') ?? `trailbase-supabase.auth:${base.origin}`;
  let storage: AuthStorage | undefined = ownOption('storage');
  let generation = 0, commitVersion = 0, state: AuthState | null = null, committed: AuthState | null = null;
  let initialization: Promise<void> | undefined, storageTail: Promise<void> = Promise.resolve(), storageFailure: Error | null = null;
  const requireAuth = () => { if (!enabled) unsupported('Auth defaults are not implemented; explicitly configure auth'); };
  const snapshot = () => state === null ? null : structuredClone(state.session);
  function failClosed() { if (storageFailure) throw storageFailure; }
  function ownedStorage(): AuthStorage {
    if (storage) return storage;
    try {
      if (typeof window !== 'undefined') storage = window.localStorage;
      else { const data = new Map<string, string>(); storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } }; }
      validateStorage(storage); return storage;
    } catch { throw namedError('AuthStorageUnavailableError', 'Persistent auth storage unavailable'); }
  }
  function initialize(): Promise<void> {
    if (!initialization) {
      const epoch = generation;
      initialization = (async () => {
        if (!persist) return;
        const target = ownedStorage(); let value: unknown;
        try { value = await target.getItem(key); }
        catch { throw namedError('AuthStorageReadError', 'Auth storage read failed'); }
        const hydrated = decodeStored(value);
        committed = hydrated; commitVersion++;
        if (epoch === generation) state = hydrated;
      })();
    }
    return initialization;
  }
  async function ready() { failClosed(); await initialize(); await storageTail; failClosed(); }
  function stale(epoch: number) { if (epoch !== generation) throw namedError('AuthStaleOperationError', 'Login superseded by a newer operation'); }
  async function restore(previous: AuthState | null, primary: string) {
    try {
      if (previous) await ownedStorage().setItem(key, encodeStored(previous));
      else await ownedStorage().removeItem(key);
    } catch {
      storageFailure = namedError('AuthStorageRestoreError', 'Auth storage consistency unknown after restoration failure');
      Object.assign(storageFailure, { details: `primary=${primary}; restoration=AuthStorageRestoreError` });
      throw storageFailure;
    }
  }
  function activeState(epoch: number, baseline: AuthState) {
    stale(epoch);
    if (state !== baseline || committed !== baseline) throw namedError('AuthStaleOperationError', 'Auth credential baseline superseded by a committed operation');
  }
  async function install(next: AuthState, epoch: number, baseline?: AuthState): Promise<void> {
    const guard = () => baseline ? activeState(epoch, baseline) : stale(epoch);
    const operation = storageTail.then(async () => {
      failClosed(); guard();
      if (persist) {
        const previous = committed, version = commitVersion;
        const authoritative = () => version === commitVersion ? previous : committed;
        try { await ownedStorage().setItem(key, encodeStored(next)); }
        catch { await restore(authoritative(), 'AuthStorageWriteError'); throw namedError('AuthStorageWriteError', 'Auth storage write failed; authoritative credentials restored'); }
        if (epoch !== generation || baseline && (state !== baseline || committed !== baseline)) {
          await restore(authoritative(), 'AuthStaleOperationError'); guard();
        }
      }
      failClosed(); guard(); committed = next; state = next; commitVersion++;
    });
    storageTail = operation.catch(() => {});
    await operation;
  }
  function operationError(error: unknown): AuthError {
    const result = normalizeError(storageFailure ?? error);
    if (storageFailure && error !== storageFailure) result.details = `${result.details}; operation=${error instanceof FetchError ? 'AuthHttpError' : 'AuthOperationError'}`;
    return result;
  }
  async function request(path: 'register' | 'login' | 'refresh' | 'status', body: Record<string, string> | NativeCredentials, ownResponse?: (cancel: () => void) => void): Promise<Response> {
    const controller = new AbortController();
    const response = await fetcher(new URL(`/api/auth/v1/${path}`, base), { method: path === 'status' ? 'GET' : 'POST', ...(path === 'status' ? { headers: { authorization: `Bearer ${body.auth_token}`, 'Refresh-Token': body.refresh_token } } : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), credentials: 'omit', redirect: 'error', signal: controller.signal });
    function cancelResponse() {
      controller.abort();
      try { void response.body?.cancel().catch(() => {}); } catch { /* Custom transports may reject cancellation synchronously. */ }
    }
    // A followed/opaque redirect cannot establish a native endpoint's terminal status.
    if (response.redirected || response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) {
      cancelResponse();
      throw namedError('AuthRedirectError', 'Auth redirects are not accepted');
    }
    if (path === 'status' && response.status !== 200) {
      cancelResponse();
      throw new FetchError(response.status, 'Native status endpoint did not acknowledge authentication', new URL(`/api/auth/v1/${path}`, base).href);
    }
    if (path === 'refresh' && response.status === 401) {
      // Delivered native status is authoritative even if its body never settles.
      cancelResponse();
      throw new FetchError(401, 'Native refresh endpoint rejected the credential', new URL(`/api/auth/v1/${path}`, base).href);
    }
    if (path === 'refresh' && response.ok && response.status !== 200) {
      cancelResponse();
      throw new FetchError(response.status, 'Unexpected native refresh success status', new URL(`/api/auth/v1/${path}`, base).href);
    }
    if (!response.ok) {
      const text = await response.text();
      if (response.status === 403) {
        let payload: unknown; try { payload = JSON.parse(text); } catch { /* Native plain-text failures remain actionable. */ }
        if (payload && typeof payload === 'object' && Object.hasOwn(payload, 'mfa_token')) {
          const error = namedError('AuthMfaUnsupportedError', 'MFA authentication is not implemented'); Object.assign(error, { status: 403 }); throw error;
        }
      }
      throw new FetchError(response.status, text || response.statusText, new URL(`/api/auth/v1/${path}`, base).href);
    }
    ownResponse?.(cancelResponse);
    return response;
  }
  async function register(input: PasswordCredentials): Promise<AuthResponse> {
    try { await ready(); await request('register', { email: input.email, password: input.password, password_repeat: input.password }); return { data: { user: null, session: null }, error: null }; }
    catch (error) { await storageTail; return { data: { user: null, session: null }, error: operationError(error) }; }
  }
  async function login(input: PasswordCredentials, epoch: number): Promise<AuthResponse> {
    try {
      failClosed(); await initialize(); failClosed(); stale(epoch);
      const response = await request('login', { email_or_username: input.email, password: input.password });
      let payload: unknown;
      try { payload = await response.json(); }
      catch { throw namedError('AuthInvalidPayloadError', 'Malformed native login JSON payload'); }
      const next = stateFromNative(payload);
      stale(epoch); await install(next, epoch); stale(epoch);
      return { data: { session: snapshot(), user: structuredClone(next.session.user) }, error: null };
    } catch (error) {
      await storageTail;
      // Only the current failed login may reconcile hydration suppressed by its invocation.
      if (epoch === generation && !storageFailure) state = committed;
      return { data: { user: null, session: null }, error: operationError(error) };
    }
  }
  let refreshFlight: { epoch: number; promise: Promise<AuthResponse> } | null = null;
  async function clearRejected(epoch: number, baseline: AuthState): Promise<void> {
    failClosed(); activeState(epoch, baseline);
    // Invalidate before enqueueing: a newer failed login must not reconcile the
    // rejected baseline. New commits queue behind removal, so they cannot be removed.
    state = committed = null;
    const clearedVersion = ++commitVersion;
    const operation = storageTail.then(async () => {
      failClosed();
      if (commitVersion !== clearedVersion || state !== null || committed !== null) return;
      if (persist) {
        try { await ownedStorage().removeItem(key); }
        catch {
          storageFailure = namedError('AuthStorageRemoveError', 'Auth storage consistency unknown after rejected-session removal failed');
          Object.assign(storageFailure, { details: 'primary=AuthRefreshUnauthorized; status=401; removal=AuthStorageRemoveError' });
          throw storageFailure;
        }
      }
    });
    storageTail = operation.catch(() => {});
    await operation;
  }
  async function performRefresh(epoch: number): Promise<AuthResponse> {
    let baseline: AuthState | null = null;
    try {
      await ready(); stale(epoch);
      const previous = state; baseline = previous;
      if (!previous) throw namedError('AuthSessionMissingError', 'No session available to refresh');
      const response = await request('refresh', { refresh_token: previous.tokens.refresh_token });
      let payload: unknown;
      try { payload = await response.json(); }
      catch { throw namedError('AuthInvalidPayloadError', 'Malformed native refresh JSON payload'); }
      plainObject(payload, 'Native refresh response');
      if (Object.keys(payload).length !== 2 || !Object.hasOwn(payload, 'auth_token') || !Object.hasOwn(payload, 'csrf_token') || typeof payload.csrf_token !== 'string' || !/^[\x21-\x7e]+$/.test(payload.csrf_token)) throw namedError('AuthInvalidPayloadError', 'Invalid native refresh response fields');
      // Pinned RefreshResponse omits refresh_token; retain only the captured genuine credential.
      const next = stateFromNative({ auth_token: payload.auth_token, refresh_token: previous.tokens.refresh_token, csrf_token: payload.csrf_token });
      if (next.session.user.id !== previous.session.user.id) throw namedError('AuthRefreshIdentityError', 'Native refresh identity differs from current session');
      activeState(epoch, previous); await install(next, epoch, previous); activeState(epoch, next);
      return { data: { session: snapshot(), user: structuredClone(next.session.user) }, error: null };
    } catch (error) {
      if (error instanceof FetchError && error.status === 401 && baseline && !storageFailure) {
        try { await clearRejected(epoch, baseline); }
        catch (clearError) { error = clearError; }
      }
      await storageTail;
      return { data: { user: null, session: null }, error: operationError(error) };
    }
  }
  function refresh(): Promise<AuthResponse> {
    if (refreshFlight?.epoch === generation) return refreshFlight.promise;
    const current = { epoch: generation, promise: performRefresh(generation) };
    refreshFlight = current;
    void current.promise.finally(() => { if (refreshFlight === current) refreshFlight = null; });
    return current.promise;
  }
  async function sessionReady(): Promise<void> {
    // Join before waiting on storageTail so calls during an in-flight refresh write
    // share its result, including a terminal error, rather than dispatching anonymously.
    const joined = refreshFlight?.epoch === generation ? refreshFlight.promise : null;
    if (joined) {
      const result = await joined;
      if (result.error) throw Object.assign(new Error(result.error.message), result.error);
    } else {
      await ready();
      if (state && state.session.expires_at <= Date.now() / 1000) {
        const result = await refresh();
        if (result.error) throw Object.assign(new Error(result.error.message), result.error);
      }
    }
    failClosed();
  }
  async function liveUser(epoch: number): Promise<{ data: { user: AuthUser | null }; error: AuthError | null }> {
    let discardResponse: (() => void) | undefined;
    try {
      await sessionReady(); stale(epoch);
      const previous = state;
      if (!previous) throw namedError('AuthSessionMissingError', 'No session available for live validation');
      activeState(epoch, previous);
      // Both credentials are required: bearer-only status just re-encodes cached claims.
      const response = await request('status', previous.tokens, cancel => { discardResponse = cancel; });
      activeState(epoch, previous);
      let payload: unknown;
      try { payload = await response.json(); }
      catch { throw namedError('AuthInvalidPayloadError', 'Malformed native status JSON payload'); }
      activeState(epoch, previous);
      plainObject(payload, 'Native status response');
      const fields = ['auth_token', 'refresh_token', 'csrf_token'];
      if (Object.keys(payload).length !== 3 || !fields.every(key => Object.hasOwn(payload, key))) throw namedError('AuthInvalidPayloadError', 'Invalid native status response fields');
      if (fields.every(key => payload[key] === null)) throw namedError('AuthSessionMissingError', 'Native status did not acknowledge an authenticated session');
      if (payload.refresh_token !== previous.tokens.refresh_token || typeof payload.csrf_token !== 'string' || !/^[\x21-\x7e]+$/.test(payload.csrf_token)) throw namedError('AuthInvalidPayloadError', 'Invalid native status credential acknowledgement');
      const next = stateFromNative(payload);
      if (next.session.user.id !== previous.session.user.id) throw namedError('AuthStatusIdentityError', 'Native status identity differs from current session');
      await install(next, epoch, previous); activeState(epoch, next);
      return { data: { user: structuredClone(next.session.user) }, error: null };
    } catch (error) {
      discardResponse?.(); // Own transport only; cleanup cannot await/replace the operation error.
      await storageTail;
      return { data: { user: null }, error: operationError(error) };
    }
  }
  return {
    api: {
      signUp(input: PasswordCredentials): Promise<AuthResponse> { requireAuth(); return register(credentials(input, arguments.length)); },
      signInWithPassword(input: PasswordCredentials): Promise<AuthResponse> { requireAuth(); const value = credentials(input, arguments.length); return login(value, ++generation); },
      getSession(): Promise<{ data: { session: AuthSession | null }; error: AuthError | null }> { requireAuth(); if (arguments.length) unsupported('getSession accepts no arguments'); return (async () => { try { await sessionReady(); return { data: { session: snapshot() }, error: null }; } catch (error) { return { data: { session: null }, error: normalizeError(error) }; } })(); },
      getUser(): Promise<{ data: { user: AuthUser | null }; error: AuthError | null }> { requireAuth(); if (arguments.length) unsupported('getUser accepts no arguments'); return liveUser(generation); },
      refreshSession(): Promise<AuthResponse> { requireAuth(); if (arguments.length) unsupported('refreshSession accepts no arguments'); return refresh(); },
      signOut(_options?: { scope?: 'global' | 'local' }): Promise<{ error: AuthError | null }> { return unsupported('Local/global signOut is not implemented'); },
      onAuthStateChange(_callback: (event: AuthChangeEvent, session: AuthSession | null) => void): { data: { subscription: { unsubscribe(): void } } } { return unsupported('Auth notifications are not implemented'); },
    },
    async recordFetch(path: string, init?: RequestInit): Promise<Response> {
      if (enabled) await sessionReady();
      const headers = new Headers(init?.headers);
      if (state !== null) {
        headers.set('authorization', `Bearer ${state.session.access_token}`);
      }
      return fetcher(new URL(path, base), { ...init, headers, credentials: 'omit', redirect: 'error' });
    },
  };
}
