// Explicit in-memory UI model, never a backend/SDK/security compatibility substitute.
export function initializeMock(app, root, { capabilities = 'none', signedIn = true } = {}) {
  const callbacks = new Set(), blobs = new Map();
  let session = signedIn ? { user: { id: 'owner-a', email: 'owner-a@example.test' } } : null;
  let readRelease, uploadRelease, downloadRelease, unsubscribeRelease;
  const state = { reads: [], writes: [], uploads: [], downloads: [], channels: [], storageFrom: [],
    mode: 'healthy', unsubscribeMode: 'ok', holdRead: false, holdUpload: false, holdDownload: false, holdUnsubscribe: false,
    rows: Array.from({ length: 26 }, (_, i) => ({ id: `row-${i}`, user_id: 'owner-a', title: `Task ${i}`, completed: false, priority: 0, created_at: String(99 - i).padStart(3, '0') })) };
  const emit = (event, owner) => { session = owner ? { user: { id: owner, email: `${owner}@example.test` } } : null; for (const cb of callbacks) cb(event, session); };
  const client = { auth: {
    onAuthStateChange(cb) { callbacks.add(cb); queueMicrotask(() => callbacks.has(cb) && cb('INITIAL_SESSION', session)); return { data: { subscription: { unsubscribe: () => callbacks.delete(cb) } } }; },
    async signInWithPassword() { emit('SIGNED_IN', 'owner-a'); return { data: { session }, error: null }; },
    async signUp() { return { data: { user: null, session: null }, error: null }; },
    async signOut() { emit('SIGNED_OUT', null); return { error: null }; },
    async getUser() { return { data: { user: session?.user }, error: null }; },
    async refreshSession() { for (const cb of callbacks) cb('TOKEN_REFRESHED', session); return { data: { session }, error: null }; },
  }, from(table) {
    let operation = 'select', values, first = 0, last = 20; const predicates = [];
    const query = { select() { return query; }, insert(value) { operation = 'insert'; values = value; return query; }, update(value) { operation = 'update'; values = value; return query; }, delete() { operation = 'delete'; return query; },
      eq(key, value) { predicates.push([key, value]); return query; }, order() { return query; }, range(a, b) { first = a; last = b; return query; },
      then(resolve, reject) {
        return (async () => {
          const owner = session?.user.id;
          const matches = row => row.user_id === owner && predicates.every(([key, value]) => row[key] === value);
          if (operation === 'select') {
            state.reads.push({ table, predicates, first, last, owner });
            if (state.holdRead) await new Promise(done => { readRelease = done; });
            return { data: state.rows.filter(matches).slice(first, last + 1).map(row => ({ ...row })), error: null };
          }
          state.writes.push({ table, operation, values, predicates });
          if (operation === 'insert') state.rows.unshift({ ...values, completed: false, created_at: '999' });
          else if (operation === 'delete') state.rows = state.rows.filter(row => !matches(row));
          else for (const row of state.rows.filter(matches)) Object.assign(row, values);
          return { data: null, error: state.mode === 'write-unknown' ? new Error('PRIVATE_CANARY') : null };
        })().then(resolve, reject);
      },
    }; return query;
  } };
  if (capabilities.includes('storage') || capabilities === 'all') {
    const bucket = {
      async upload(...args) {
        const [path, blob] = args; state.uploads.push({ path, arguments: args.length, blob: blob instanceof Blob });
        if (state.holdUpload) await new Promise(done => { uploadRelease = done; });
        if (blobs.has(path)) return { data: null, error: { name: 'StorageError', message: 'PRIVATE_CANARY' } };
        blobs.set(path, blob);
        if (state.mode === 'lost') throw new Error('PRIVATE_CANARY');
        return { data: { id: state.mode === 'bad-ack' ? null : 'opaque-record-id', path, fullPath: `attachments/${path}` }, error: null };
      },
      async download(...args) {
        const [path] = args; state.downloads.push({ path, arguments: args.length });
        if (state.holdDownload) await new Promise(done => { downloadRelease = done; });
        if (state.mode === 'download-error') throw new Error('PRIVATE_CANARY');
        if (state.mode === 'wrong') return { data: new Blob(['wrong']), error: null };
        const blob = blobs.get(path); return blob ? { data: blob, error: null } : { data: null, error: { name: 'StorageError', message: 'PRIVATE_CANARY' } };
      },
    };
    if (capabilities === 'storage-partial') delete bucket.download;
    client.storage = { from(name) { state.storageFrom.push(name); return bucket; } };
  }
  if (capabilities.includes('realtime') || capabilities === 'all') client.channel = name => {
    const channel = { name, stops: 0,
      on(event, filter, callback) { Object.assign(channel, { event, filter, callback }); return channel; },
      subscribe(statusCallback) { channel.statusCallback = statusCallback; statusCallback('SUBSCRIBED'); return channel; },
      async unsubscribe() { channel.stops++; if (state.holdUnsubscribe) await new Promise(done => { unsubscribeRelease = done; }); if (state.unsubscribeMode === 'reject') throw new Error('PRIVATE_CANARY'); channel.statusCallback?.('CLOSED'); return state.unsubscribeMode; },
    };
    if (capabilities === 'realtime-partial') delete channel.subscribe;
    state.channels.push(channel); return channel;
  };
  if (capabilities === 'realtime-getter') Object.defineProperty(client, 'channel', { get() { throw new Error('PRIVATE_CANARY'); } });
  let ids = 0;
  state.ui = app.mountAuthTodos(root, client, { mockFeatures: true, makeId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` });
  Object.assign(state, { emit, notify: () => state.channels.at(-1)?.callback?.({ eventType: 'DELETE', old: { id: 'not-a-complete-row' } }),
    status: value => state.channels.at(-1)?.statusCallback?.(value), listenerCount: () => callbacks.size,
    releaseRead: () => { state.holdRead = false; readRelease?.(); }, releaseUpload: () => { state.holdUpload = false; uploadRelease?.(); },
    releaseDownload: () => { state.holdDownload = false; downloadRelease?.(); }, releaseUnsubscribe: () => { state.holdUnsubscribe = false; unsubscribeRelease?.(); },
  });
  return state;
}
