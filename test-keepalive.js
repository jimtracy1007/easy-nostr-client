const { useWebSocketImplementation } = require('nostr-tools/pool');
const WebSocket = require('ws');
WebSocket.prototype.setMaxListeners(0); 
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
 * 业务方法 - 心跳检测
 */
function heartbeat(params, event) {
  return {
    status: 'alive',
    timestamp: Date.now(),
    sequence: params.seq,
  };
}

/**
 * 主测试流程 - 保持活跃测试
 */
async function runKeepaliveTest() {
  console.log('🚀 Starting Nostr SDK Keepalive Test\n');
  console.log('Test duration: 10 minutes (sends heartbeat every 5 minutes)\n');

  // 初始化服务器
  const sdk = new NostrSdk({
    relays: [RELAY_URL],
    privateKey: Buffer.from(SERVER_PRIVATE_KEY, 'hex'),
    publicKey: SERVER_PUBLIC_KEY,
    allowedAuthors: [CLIENT_PUBLIC_KEY],
  });

  // 注册业务方法
  sdk.registerMethod('heartbeat', heartbeat);

  // 监听事件
  sdk.on('error', (err) => console.error('❌ SDK Error:', err.message));
  sdk.on('started', () => console.log('✅ Server started and listening\n'));

  // 启动服务器
  await sdk.start();

  // 等待服务器充分启动
  await new Promise(resolve => setTimeout(resolve, 5000));

  // 初始化客户端
  const client = new NostrClient({
    relays: [RELAY_URL],
    privateKey: Buffer.from(CLIENT_PRIVATE_KEY, 'hex'),
    publicKey: CLIENT_PUBLIC_KEY,
    serverPublicKey: SERVER_PUBLIC_KEY,
    timeout: 30000,
  });

  // 连接客户端
  await client.connect();

  // 等待客户端订阅建立
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 测试参数
  const HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 分钟
  const TEST_DURATION = 10 * 60 * 1000; // 10 分钟
  const START_TIME = Date.now();

  let heartbeatCount = 0;
  let successCount = 0;
  let failureCount = 0;

  console.log('Starting heartbeat loop...\n');

  // 发送第一个心跳
  const sendHeartbeat = async () => {
    heartbeatCount++;
    const elapsed = Math.round((Date.now() - START_TIME) / 1000);
    console.log(`[${elapsed}s] 📤 Sending heartbeat #${heartbeatCount}...`);

    try {
      const result = await client.call('heartbeat', { seq: heartbeatCount });
      successCount++;
      console.log(`[${elapsed}s] ✅ Heartbeat #${heartbeatCount} received: status=${result.status}, seq=${result.sequence}\n`);
    } catch (error) {
      failureCount++;
      console.log(`[${elapsed}s] ❌ Heartbeat #${heartbeatCount} failed: ${error.message}\n`);
    }
  };

  // 立即发送第一个心跳
  await sendHeartbeat();

  // 设置定时心跳
  const heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

  // 设置测试超时
  const testTimer = setTimeout(async () => {
    clearInterval(heartbeatTimer);

    console.log('\n========== Test Summary ==========');
    console.log(`Total heartbeats sent: ${heartbeatCount}`);
    console.log(`Successful: ${successCount} ✅`);
    console.log(`Failed: ${failureCount} ❌`);
    console.log(`Success rate: ${((successCount / heartbeatCount) * 100).toFixed(1)}%`);
    console.log(`Test duration: ${Math.round((Date.now() - START_TIME) / 1000)}s`);
    console.log('==================================\n');

    // 清理资源
    console.log('🛑 Cleaning up...');
    client.close();
    sdk.stop();

    if (successCount === heartbeatCount) {
      console.log('✅ Keepalive test PASSED - All heartbeats received!\n');
      process.exit(0);
    } else {
      console.log('❌ Keepalive test FAILED - Some heartbeats were lost!\n');
      process.exit(1);
    }
  }, TEST_DURATION);

  // 优雅关闭
  process.on('SIGINT', () => {
    clearInterval(heartbeatTimer);
    clearTimeout(testTimer);
    console.log('\n\n🛑 Test interrupted by user');
    client.close();
    sdk.stop();
    process.exit(0);
  });
}

// 运行测试
runKeepaliveTest().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
