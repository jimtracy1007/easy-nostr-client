# Nostr SDK for Node.js

A lightweight toolkit that enables server-side business logic to be exposed through the Nostr protocol using encrypted direct messages (NIP-04). The package ships both a backend listener (`NostrSdk`) and a client helper (`NostrClient`), plus a collection of cryptographic utilities re-exported from `nostr-tools`.

# Features
- **Persistent relay connections** powered by `SimplePool` with automatic ping/reconnect.
- **End-to-end encryption** using NIP-04 for every request/response pair.
- **JSON-RPC style payloads** (`{ method, params, id }`).
- **Method registry** on the server for easy business-logic wiring.
- **Strict filtering** (`kinds`, `authors`, `#p`) to accept only relevant events.
- **Utility exports** (nip04, nip19, key helpers, encoding helpers) for custom workflows.

# Installation

```bash
npm install nostr-dev
# or
yarn add nostr-dev
```

If you are working from source, clone the repo and run `npm install` in the root.

# Exports

`index.js` re-exports the following symbols:

- **Core classes**: `NostrClient`, `NostrSdk`
- **Pools**: `SimplePool`, `useWebSocketImplementation`
- **NIP helpers**: `nip04`, `nip19`
- **Key utilities**: `generateSecretKey`, `getPublicKey`
- **Event helpers**: `finalizeEvent`, `verifyEvent`
- **Encoding helpers**: `bytesToHex`, `hexToBytes`

Example import:

```javascript
const {
  NostrSdk,
  NostrClient,
  nip04,
  generateSecretKey,
  getPublicKey,
} = require('nostr-dev');
```

When consuming directly from the repository, replace `'nostr-dev'` with `'./index'`.

# Quick Start

## 1. Provision keys

```javascript
const { generateSecretKey, getPublicKey, bytesToHex } = require('nostr-dev');

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
const { NostrSdk } = require('nostr-dev');

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
const { NostrClient } = require('nostr-dev');

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
# install dependencies
npm install

# run integration suite
node test.js

# optional: keepalive smoke test
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
├── index.js            # package entry point
├── src/
│   ├── nostrSdk.js     # backend listener implementation
│   └── nostrClient.js  # RPC client helper
├── test.js             # integration scenarios
├── test-keepalive*.js  # long-running connection tests
├── package.json
└── README.md
```

# License

ISC
