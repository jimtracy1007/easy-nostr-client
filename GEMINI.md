# Gemini Code Understanding Report

## Project Overview

This project is a lightweight Node.js SDK for the Nostr protocol. It enables server-side business logic to be exposed through encrypted direct messages (NIP-04). The SDK includes a backend listener (`NostrSdk`) and a client helper (`NostrClient`). It uses `nostr-tools` for Nostr-related functionality and `ws` for WebSocket connections.

The core architecture revolves around a JSON-RPC style request/response pattern over Nostr direct messages. The server registers methods, and the client calls them. All communication is end-to-end encrypted using NIP-04.

## Building and Running

### Dependencies

The project relies on the following main dependencies:

-   `nostr-tools`: A library for building Nostr clients and servers.
-   `ws`: A WebSocket client and server library for Node.js.

### Running the Project

To run the project, you can use the example code provided in the `README.md` file.

**Server:**

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

**Client:**

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

### Testing

The project includes an integration test suite. To run the tests, execute the following command:

```bash
node test.js
```

There is also a keepalive smoke test that can be run with:

```bash
node test-keepalive-quick.js
```

## Development Conventions

-   The project uses a class-based approach for the `NostrSdk` and `NostrClient`.
-   Asynchronous operations are handled using `async/await`.
-   The code follows a consistent style, with clear comments and JSDoc annotations.
-   The project uses the `EventEmitter` class to emit events like `started`, `stopped`, and `error`.
-   The `README.md` file is comprehensive and well-maintained, serving as the primary source of documentation.
