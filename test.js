const { useWebSocketImplementation } = require('nostr-tools/pool');
const WebSocket = require('ws');
useWebSocketImplementation(WebSocket);

const { NostrSdk, NostrClient } = require('./dist/index.cjs');

// Generated test keys
const SERVER_PRIVATE_KEY = process.env.SERVER_PRIV_KEY || '0d515bdddf9eb09eeb41c058070a493b110d48ba613bb8f9eeff60aef7ecc2fe';
const SERVER_PUBLIC_KEY = process.env.SERVER_PUB_KEY || 'c037c7a68fd9e2642646f5b32854bece9f024cd4909d05b511a073b44e616025';

const CLIENT_PRIVATE_KEY = process.env.CLIENT_PRIV_KEY || '66b0f0bbe65d49f650a994dea9c8c014de12197f3c50dae9430afc28547f3537';
const CLIENT_PUBLIC_KEY = process.env.CLIENT_PUB_KEY || '5dce25e51ae62778abcedf4627a6946e6194e815279857f75fe3e276100a1cec';

const RELAY_URL = process.env.RELAY_URL || 'wss://dev-relay.lnfi.network';

/**
 * Example RPC handlers
 */
function getInfo(params, event) {
  return {
    method: 'getinfo',
    version: '1.0.0',
    timestamp: Date.now(),
    from: event.pubkey.slice(0, 16),
  };
}

async function add(params, event) {
  const { a, b } = params;
  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new Error('Parameters a and b must be numbers');
  }
  return {
    a,
    b,
    sum: a + b,
  };
}

async function echo(params, event) {
  return {
    message: params.message || 'Hello from Nostr SDK!',
    receivedAt: Date.now(),
  };
}

/**
 * Main integration test flow
 */
async function runTests() {
  console.log('🚀 Starting Nostr SDK Integration Test\n');
  console.log('Configuration:', {
    relay: RELAY_URL,
    serverPub: SERVER_PUBLIC_KEY.slice(0, 8),
    clientPub: CLIENT_PUBLIC_KEY.slice(0, 8),
  });

  // Initialize server
  const sdk = new NostrSdk({
    relays: [RELAY_URL],
    privateKey: Buffer.from(SERVER_PRIVATE_KEY, 'hex'),
    publicKey: SERVER_PUBLIC_KEY,
  });

  // Register RPC handlers
  sdk.registerMethod('getinfo', getInfo);
  sdk.registerMethod('add', add);
  sdk.registerMethod('echo', echo);

  // Subscribe to SDK lifecycle events
  sdk.on('error', (err) => console.error('❌ SDK Error:', err.message));
  sdk.on('started', () => console.log('✅ SDK started and listening\n'));

  // Start server
  await sdk.start();

  // Allow server to warm up (5 seconds)
  console.log('Waiting for server to fully initialize...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log('Server ready, starting client tests\n');

  // Initialize client
  const client = new NostrClient({
    relays: [RELAY_URL],
    privateKey: Buffer.from(CLIENT_PRIVATE_KEY, 'hex'),
    publicKey: CLIENT_PUBLIC_KEY,
    serverPublicKey: SERVER_PUBLIC_KEY,
    timeout: 20000,
  });

  // Connect client and prepare subscriptions
  await client.connect();

  // Wait for client subscription to settle
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test matrix
  const tests = [
    {
      name: 'getinfo',
      method: 'getinfo',
      params: {},
    },
    {
      name: 'add(5, 3)',
      method: 'add',
      params: { a: 5, b: 3 },
    },
    {
      name: 'echo',
      method: 'echo',
      params: { message: '你好 Nostr SDK!' },
    },
    {
      name: 'nonexistent method',
      method: 'nonexistent',
      params: {},
      expectError: true,
    },
  ];

  // Execute scenarios sequentially
  for (const test of tests) {
    try {
      console.log(`\n📤 Test: ${test.name}`);
      console.log(`   Method: ${test.method}`);
      console.log(`   Params:`, test.params);

      const result = await client.call(test.method, test.params);

      if (test.expectError) {
        console.log('   ❌ Expected error but got result:', result);
      } else {
        console.log('   ✅ Success:', result);
      }
    } catch (error) {
      if (test.expectError) {
        console.log(`   ✅ Expected error: ${error.message}`);
      } else {
        console.log(`   ❌ Error: ${error.message}`);
      }
    }

    // Small delay between cases
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Cleanup resources
  console.log('\n\n🛑 Cleaning up...');
  client.close();
  sdk.stop();

  console.log('✅ Test completed!\n');
  process.exit(0);
}

// Kick off test runner
runTests().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
