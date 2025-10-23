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
- **Method registry** through `NostrSdk.registerMethod()` for quick business wiring
- **Strict filtering** (`kinds`, `authors`, `#p`) to process only the intended events
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

```javascript
// server.js
import { NostrSdk } from 'easy-nostr-client';

const sdk = new NostrSdk({
  relays: ['wss://relay.example.com'],
  privateKey: serverSk, // accepts Uint8Array or Buffer
  publicKey: serverPk,
  allowedAuthors: [clientPk], // optional whitelist
});

sdk.registerMethod('add', async ({ a, b }) => ({ sum: a + b }));
sdk.registerMethod('greet', async ({ name }) => ({ message: `Hello ${name}!` }));

sdk.on('started', () => console.log('Server ready'));
sdk.on('error', (err) => console.error('SDK error:', err));

(async () => {
  await sdk.start();
})();

process.on('SIGINT', () => {
  sdk.stop();
  process.exit(0);
});
```

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
});

await client.connect();

try {
  const sum = await client.call('add', { a: 5, b: 3 });
  console.log(sum); // { sum: 8 }

  const greeting = await client.call('greet', { name: 'Alice' });
  console.log(greeting); // { message: 'Hello Alice!' }
} finally {
  client.close();
}
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
| `allowedAuthors` | `string[]` | `[]` | Optional whitelist of client pubkeys |

Methods:

- `registerMethod(method, handler)` – register an async handler `(params, event) => result`.
- `start()` – connect to relays and begin listening for kind-4 events.
- `stop()` – dispose subscriptions and close the pool.

Events:

- `started`, `stopped`, `error`

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
- **Rate limiting** – consider adding throttling/anti-replay in production.

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
