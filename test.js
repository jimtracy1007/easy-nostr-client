const { useWebSocketImplementation } = require('nostr-tools/pool');
const WebSocket = require('ws');
useWebSocketImplementation(WebSocket);

const NostrSdk = require('./src/nostrSdk');
const NostrClient = require('./src/nostrClient');

// 生成的测试密钥
const SERVER_PRIVATE_KEY = '0d515bdddf9eb09eeb41c058070a493b110d48ba613bb8f9eeff60aef7ecc2fe';
const SERVER_PUBLIC_KEY = 'c037c7a68fd9e2642646f5b32854bece9f024cd4909d05b511a073b44e616025';

const CLIENT_PRIVATE_KEY = '66b0f0bbe65d49f650a994dea9c8c014de12197f3c50dae9430afc28547f3537';
const CLIENT_PUBLIC_KEY = '5dce25e51ae62778abcedf4627a6946e6194e815279857f75fe3e276100a1cec';

const RELAY_URL = 'wss://dev-relay.lnfi.network';

/**
 * 业务方法示例
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
 * 主测试流程
 */
async function runTests() {
  console.log('🚀 Starting Nostr SDK Integration Test\n');

  // 初始化服务器
  const sdk = new NostrSdk({
    relays: [RELAY_URL],
    privateKey: Buffer.from(SERVER_PRIVATE_KEY, 'hex'),
    publicKey: SERVER_PUBLIC_KEY,
  });

  // 注册业务方法
  sdk.registerMethod('getinfo', getInfo);
  sdk.registerMethod('add', add);
  sdk.registerMethod('echo', echo);

  // 监听事件
  sdk.on('error', (err) => console.error('❌ SDK Error:', err.message));
  sdk.on('started', () => console.log('✅ SDK started and listening\n'));

  // 启动服务器
  await sdk.start();

  // 等待服务器充分启动 - 增加到 5 秒
  console.log('Waiting for server to fully initialize...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log('Server ready, starting client tests\n');

  // 初始化客户端
  const client = new NostrClient({
    relays: [RELAY_URL],
    privateKey: Buffer.from(CLIENT_PRIVATE_KEY, 'hex'),
    publicKey: CLIENT_PUBLIC_KEY,
    serverPublicKey: SERVER_PUBLIC_KEY,
    timeout: 20000,
  });

  // 连接客户端并建立订阅
  await client.connect();

  // 等待客户端订阅建立
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 测试用例
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

  // 执行测试
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

    // 测试间隔
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // 清理资源
  console.log('\n\n🛑 Cleaning up...');
  client.close();
  sdk.stop();

  console.log('✅ Test completed!\n');
  process.exit(0);
}

// 运行测试
runTests().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
