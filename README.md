# easy-nostr-client

`easy-nostr-client` is a Nostr JSON-RPC toolkit that works in browsers and Node.js alike. It ships with:
- `NostrSdk`: a backend listener that consumes kind-4 events and executes business handlers
- `NostrClient`: a thin client wrapper that issues JSON-RPC requests and awaits replies
- Utility exports such as `keyUtils`, `nip04`, and `nip19` for NIP-19 key conversion, encryption, and event signing

# Features
- **ESM & CJS builds** via Vite library mode, producing `dist/index.mjs` and `dist/index.cjs`
- **Persistent relay pool** powered by `SimplePool` with automatic ping/reconnect
- **NIP-04 encryption** for every request/response pair
- **JSON-RPC payloads** using the familiar `{ method, params, id }` shape
- **Dual processing modes**: immediate (default) and queued with rate limiting
- **Timeout protection**: configurable per-event timeout with automatic failure handling
- **Parallel batch processing**: events processed concurrently within rate limits
- **Dynamic whitelist management** with async support for database/Redis integration
- **Method-level permissions** (public, whitelist, custom auth handlers)
- **Pluggable event storage** for custom queue backends (database, message queues)
- **Enhanced handler interface** with eventId and senderPubkey parameters
- **Utility re-exports** (`nip04`, `nip19`, `keyUtils`, etc.) ready for custom workflows

# Installation

```bash
npm install easy-nostr-client
# or
yarn add easy-nostr-client
```

If you are working from source, clone the repo and run `npm install` in the root.

# Build from source

```bash
npm install
npm run build
# or with Yarn
yarn
yarn build
```

Build artifacts are emitted to `dist/`:
- `dist/index.mjs` (ES Module)
- `dist/index.cjs` (CommonJS)

Run `npm publish --dry-run` before releasing to verify the package contents.

# Exports

`index.js` (and the compiled `dist/index.*`) exports the following:

- **Core classes**: `NostrClient`, `NostrSdk`
- **Pools**: `SimplePool`, `useWebSocketImplementation`
- **NIP helpers**: `nip04`, `nip19`
- **Key utilities**: `generateSecretKey`, `getPublicKey`
- **Event helpers**: `finalizeEvent`, `verifyEvent`
- **Encoding helpers**: `bytesToHex`, `hexToBytes`
- **keyUtils**: helpers such as `normalizeSecretKey`, `encodeSecretToNsec`, and `encodePubkeyToNpub`

Example import:

```javascript
import {
  NostrSdk,
  NostrClient,
  nip04,
  generateSecretKey,
  getPublicKey,
} from 'easy-nostr-client';
```

CommonJS usage:

```javascript
const {
  NostrSdk,
  NostrClient,
  keyUtils,
} = require('easy-nostr-client');
```

# Quick Start

## 1. Provision keys

```javascript
import { generateSecretKey, getPublicKey, bytesToHex } from 'easy-nostr-client';

const serverSk = generateSecretKey(); // Uint8Array
const serverPk = getPublicKey(serverSk);

const clientSk = generateSecretKey(); // Uint8Array
const clientPk = getPublicKey(clientSk);

// Optional: persist keys as hex strings
const serverSkHex = bytesToHex(serverSk);
const clientSkHex = bytesToHex(clientSk);
```

Store secrets securely (environment variables, secret manager, etc.).

## 2. Server (backend)

### Basic usage (immediate mode)

```javascript
// server.js
import { NostrSdk } from 'easy-nostr-client';

const sdk = new NostrSdk({
  relays: ['wss://relay.example.com'],
  privateKey: serverSk,
  publicKey: serverPk,
  allowedAuthors: [clientPk], // optional initial whitelist
});

// Register public method
sdk.registerMethod('add', async ({ a, b }) => ({ sum: a + b }));

// Register method with whitelist auth
sdk.registerMethod('admin', async (params, event, eventId, senderPubkey) => {
  return { admin: true, sender: senderPubkey };
}, { authMode: 'whitelist' });

// Register method with custom auth handler (e.g. database lookup)
sdk.registerMethod('restricted', async (params) => {
  return { secret: 'classified' };
}, {
  authMode: 'custom',
  authHandler: async (senderPubkey) => {
    const user = await db.users.findByPubkey(senderPubkey);
    return user?.role === 'admin';
  },
});

sdk.on('started', () => console.log('Server ready'));
sdk.on('error', (err) => console.error('SDK error:', err));

await sdk.start();

process.on('SIGINT', () => {
  sdk.stop();
  process.exit(0);
});
```

### Queued mode with rate limiting and timeout

```javascript
const sdk = new NostrSdk({
  relays: ['wss://relay.example.com'],
  privateKey: serverSk,
  publicKey: serverPk,
  processingMode: 'queued',
  processingRate: 3,      // max 3 events/second (relay limit)
  eventTimeout: 30000,    // 30s timeout per event (default)
});

sdk.registerMethod('process', async (params) => {
  // Heavy processing here (will timeout after 30s)
  return { processed: true };
});

await sdk.start();
```

### Dynamic whitelist with database

```javascript
const sdk = new NostrSdk({
  relays: ['wss://relay.example.com'],
  privateKey: serverSk,
  publicKey: serverPk,
  getAuthorWhitelist: async () => {
    // Query from database/Redis
    const users = await db.getActiveUsers();
    return users.map(u => u.pubkey);
  },
});

// Or use built-in whitelist management
sdk.addToWhitelist('pubkey1', 'pubkey2');
sdk.removeFromWhitelist('pubkey1');
```

### Custom event storage (database queue)

```javascript
const sdk = new NostrSdk({
  processingMode: 'queued',
  eventStorage: {
    async enqueue(event) {
      const id = await db.events.insert(event);
      return id.toString();
    },
    async dequeueBatch(limit) {
      const rows = await db.events.findPending(limit);
      return rows.map(r => ({ storageId: r.id, event: r.data }));
    },
    async ack(storageId, meta) {
      // meta: { status: 'success' | 'failed', error?: string }
      await db.events.update(storageId, { 
        status: meta.status,
        error: meta.error,
        processed_at: new Date()
      });
    },
  },
});
```

### SQLite queue implementation example

```javascript
import Database from 'better-sqlite3';

function createSQLiteQueue(dbPath) {
  const db = new Database(dbPath);
  
  // Create table
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_data TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at DATETIME
    )
  `);

  return {
    async enqueue(event) {
      const stmt = db.prepare(
        'INSERT INTO event_queue (event_data) VALUES (?)'
      );
      const result = stmt.run(JSON.stringify(event));
      return result.lastInsertRowid.toString();
    },

    async dequeueBatch(limit) {
      const stmt = db.prepare(`
        SELECT id, event_data 
        FROM event_queue 
        WHERE status = 'pending' 
        ORDER BY created_at ASC 
        LIMIT ?
      `);
      const rows = stmt.all(limit);
      
      return rows.map(row => ({
        storageId: row.id.toString(),
        event: JSON.parse(row.event_data)
      }));
    },

    async ack(storageId, meta) {
      const stmt = db.prepare(`
        UPDATE event_queue 
        SET status = ?, error = ?, processed_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `);
      stmt.run(meta.status, meta.error || null, storageId);
    },

    // Optional: cleanup old processed events
    async cleanup(olderThanDays = 7) {
      const stmt = db.prepare(`
        DELETE FROM event_queue 
        WHERE status != 'pending' 
        AND processed_at < datetime('now', '-' || ? || ' days')
      `);
      return stmt.run(olderThanDays);
    }
  };
}

// Usage
const sdk = new NostrSdk({
  processingMode: 'queued',
  eventStorage: createSQLiteQueue('./events.db'),
});
```

**Meta field status values:**
- `'success'` - Event processed successfully
- `'failed'` - Processing failed (includes timeout, errors, permission denied)

## 3. Client

```javascript
// client.js
import { NostrClient } from 'easy-nostr-client';

const client = new NostrClient({
  relays: ['wss://relay.example.com'],
  privateKey: clientSk, // accepts Uint8Array or Buffer
  publicKey: clientPk,
  serverPublicKey: serverPk,
  timeout: 30_000,
  tags: [['client', 'demo']],
  replyFilter: (base) => ({ ...base, limit: 50 }),
});

await client.connect();

try {
  client.setTags([['session', '123']]);
  client.setReplyFilter((base, ctx) => ({ ...base, '#e': [ctx.requestId] }));

  const sum = await client.call('add', { a: 5, b: 3 });
  console.log(sum); // { sum: 8 }

  const greeting = await client.call('greet', { name: 'Alice' });
  console.log(greeting); // { message: 'Hello Alice!' }

  const dm = await client.sendMessage('Hello via DM', serverPk, true);
  console.log(dm); // { success: true, reply, ... }
} finally {
  client.close();
}

// Update filters later if needed
client.setIncomingFilter((base, ctx) => ({ ...base, since: Math.floor(Date.now() / 1000) - 60 }));
```

# Message format

## Request (client → server)

```json
{
  "method": "method_name",
  "params": { "arg": "value" },
  "id": "unique-request-id"
}
```

## Response (server → client)

```json
{
  "id": "unique-request-id",
  "result": { "key": "value" },
  "error": null
}
```

Errors set `result` to `null` and populate `error` with a message.

# API Reference

## `new NostrSdk(options)`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `relays` | `string[]` | `['wss://dev-relay.lnfi.network']` | Relay endpoints to join |
| `privateKey` | `Buffer` \| `Uint8Array` | — | Server secret key |
| `publicKey` | `string` | — | Server public key (hex) |
| `allowedAuthors` | `string[]` | `[]` | Initial whitelist (deprecated, use `getAuthorWhitelist`) |
| `getAuthorWhitelist` | `Function` | — | Async/sync function returning `string[]` or `null` |
| `processingMode` | `'immediate'` \| `'queued'` | `'immediate'` | Event processing mode |
| `processingRate` | `number` | `3` | Events per second (queued mode, max 3) |
| `eventTimeout` | `number` | `30000` | Event processing timeout in ms (queued mode) |
| `eventStorage` | `Object` | Memory queue | Custom storage adapter with `enqueue`, `dequeueBatch`, `ack` |

Methods:

- `registerMethod(method, handler, authConfig?)` – register handler with optional auth config
  - Handler signature: `(params, event, eventId, senderPubkey) => result`
  - Auth config: `{ authMode: 'public'|'whitelist'|'custom', whitelist?, authHandler? }`
- `start()` – connect to relays and begin listening
- `stop()` – cleanup resources and close connections
- `getAuthorWhitelist()` – get current whitelist (async)
- `addToWhitelist(...pubkeys)` – add to internal whitelist
- `removeFromWhitelist(...pubkeys)` – remove from internal whitelist
- `clearWhitelist()` – clear internal whitelist
- `isInWhitelist(pubkey)` – check if pubkey is allowed (async)

Events:

- `started`, `stopped`, `error`

### Auth modes

- **public**: No restrictions (default)
- **whitelist**: Check method-level or global whitelist
- **custom**: Use custom `authHandler(senderPubkey) => boolean`

### Event storage adapter interface

```javascript
{
  async enqueue(event) { return storageId; },
  async dequeueBatch(limit) { return [{ storageId, event }]; },
  async ack(storageId, meta) { /* meta: { status, error } */ },
}
```

## `new NostrClient(options)`

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `relays` | `string[]` | ✔ | Relay endpoints |
| `privateKey` | `Buffer` \| `Uint8Array` | ✔ | Client secret key |
| `publicKey` | `string` | ✔ | Client public key |
| `serverPublicKey` | `string` | ✔ | Server public key |
| `timeout` | `number` | ✖ (30000) | Request timeout in ms |

Methods:

- `connect()` – prepares the pool (SimplePool auto-connects on subscribe).
- `call(method, params)` – send an RPC request; resolves with `result` or rejects with an error.
- `close()` – closes all relay connections.

# Testing

```bash
# Install dependencies
npm install

# Build the bundle
npm run build

# Integration test
node test.js

# Quick keepalive smoke test
node test-keepalive-quick.js
```

The integration test covers `getinfo`, `add`, `echo`, and missing-method scenarios.

# Operational notes

- **Subscription warm-up** – leave a few seconds after startup before sending traffic.
- **Relay latency** – adjust `timeout` according to your relay infrastructure.
- **Key security** – never hardcode real keys; rely on environment secrets.
- **Signature validation** – `verifyEvent` is exported if you need additional checks.
- **Rate limiting** – use `processingMode: 'queued'` with `processingRate` for built-in rate control.
- **Relay limits** – most relays limit to 3 events/second; `processingRate` is capped at 3.
- **Timeout protection** – queued mode processes events in parallel with `eventTimeout` protection; slow events won't block the batch.
- **Concurrency control** – batch processing uses `_isProcessing` flag to prevent timer re-entry and queue buildup.
- **Dynamic whitelist** – use `getAuthorWhitelist` for database-backed access control.
- **Queue persistence** – provide custom `eventStorage` for durable queues (database, Redis, etc.).
- **Permission layers** – global whitelist filters at entry; method-level auth controls execution.

# Project structure

```
nostr-dev/
├── index.js            # ESM entry point (build emits both ESM & CJS)
├── src/
│   ├── nostrSdk.js     # backend listener implementation
│   └── nostrClient.js  # RPC client helper
├── test.js             # integration scenarios
├── test-keepalive*.js  # long-running connection tests
├── vite.config.js      # Vite library build config
├── package.json
└── README.md
```

# License

ISC
