import { createClient, type AuthUser, type AuthSession, type AuthResponse } from '../../src/index.js';
const client = createClient('http://localhost:4000', undefined, { trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' } } } } }, auth: { persistSession: false, autoRefreshToken: false } });
const response: Promise<AuthResponse> = client.auth.signInWithPassword({ email: 'placeholder@example.test', password: 'placeholder' });
void response;
void client.auth.signUp({ email: 'placeholder@example.test', password: 'placeholder' });
const cached: Promise<{ data: { session: AuthSession | null }; error: import('../../src/index.js').AuthError | null }> = client.auth.getSession(); void cached;
const user: AuthUser = { id: 'placeholder', email: null }; void user;
// @ts-expect-error metadata unsupported
client.auth.signUp({ email: 'placeholder', password: 'placeholder', options: { data: {} } });
// @ts-expect-error phone unsupported
client.auth.signInWithPassword({ phone: 'placeholder', password: 'placeholder' });
// @ts-expect-error JWT overload unsupported
client.auth.getSession('placeholder');
// @ts-expect-error JWT overload unsupported
client.auth.getUser('placeholder');
// @ts-expect-error caller-supplied refresh credentials unsupported
client.auth.refreshSession({ refresh_token: 'placeholder' });
// @ts-expect-error unsupported signout scope
client.auth.signOut({ scope: 'others' });
// @ts-expect-error no fabricated user metadata
user.user_metadata;
// Explicit persistent opt-in and asynchronous custom storage are supported; no full defaults.
void createClient('http://localhost:4000', undefined, { trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' } } } } }, auth: { persistSession: true, autoRefreshToken: false, storageKey: 'owned', storage: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } } });
// @ts-expect-error storage read must return string/null, not parsed state
const invalidStorage: import('../../src/index.js').AuthStorage = { getItem: () => ({}), setItem: () => {}, removeItem: () => {} };
void invalidStorage;

const liveUser: Promise<{ data: { user: AuthUser | null }; error: import('../../src/index.js').AuthError | null }> = client.auth.getUser(); void liveUser;
