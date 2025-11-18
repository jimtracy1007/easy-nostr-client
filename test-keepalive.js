import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
// WebSocket.prototype.setMaxListeners(0); 
import { NostrSdk, NostrClient, useWebSocketImplementation } from './index.js';
useWebSocketImplementation(WebSocket);


// Generated test keys
const SERVER_PRIVATE_KEY = '0d515bdddf9eb09eeb41c058070a493b110d48ba613bb8f9eeff60aef7ecc2fe';
const SERVER_PUBLIC_KEY = 'c037c7a68fd9e2642646f5b32854bece9f024cd4909d05b511a073b44e616025';

const CLIENT_PRIVATE_KEY = '66b0f0bbe65d49f650a994dea9c8c014de12197f3c50dae9430afc28547f3537';
const CLIENT_PUBLIC_KEY = '5dce25e51ae62778abcedf4627a6946e6194e815279857f75fe3e276100a1cec';

const RELAY_URL = 'wss://dev-relay.lnfi.network';

const CONFIG = {
  heartbeatIntervalMs: Number(process.env.HEARTBEAT_INTERVAL_MS || 3 * 1000),
  testDurationMs: Number(process.env.TEST_DURATION_MS || 6 * 60 * 60 * 1000), // 默认 6 小时以暴露慢性泄漏
  metricIntervalMs: Number(process.env.METRIC_INTERVAL_MS || 60 * 1000),
  metricLogPath: path.resolve(process.env.METRIC_LOG_PATH || 'keepalive-metrics.ndjson'),
  metricTag: process.env.METRIC_TAG || 'default',
};

function bytesToMB(bytes) {
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

function summarizeMemory() {
  const mem = process.memoryUsage();
  return {
    rssMB: bytesToMB(mem.rss),
    heapTotalMB: bytesToMB(mem.heapTotal),
    heapUsedMB: bytesToMB(mem.heapUsed),
    externalMB: bytesToMB(mem.external),
    arrayBuffersMB: bytesToMB(mem.arrayBuffers || 0),
  };
}

function getQueueSnapshot(queue) {
  if (!queue) {
    return { size: 0 };
  }
  let size = 0;
  let truncated = false;
  let cursor = queue.first;
  while (cursor) {
    size += 1;
    cursor = cursor.next;
    if (size >= 2000 && cursor) {
      truncated = true;
      break;
    }
  }
  return { size, truncated };
}

function collectRelayStats(relay) {
  if (!relay) return null;
  const queue = getQueueSnapshot(relay.incomingMessageQueue);
  return {
    url: relay.url,
    connected: relay.connected ?? relay._connected ?? false,
    openSubs: relay.openSubs ? relay.openSubs.size : undefined,
    queueLength: queue.size,
    queueTruncated: queue.truncated,
    hasPingTimer: Boolean(relay.pingTimeoutHandle || relay.pingIntervalHandle),
    hasReconnectTimer: Boolean(relay.reconnectTimeoutHandle),
    lastPingAt: relay.lastPingAt || relay.lastPing || null,
    lastPongAt: relay.lastPongAt || relay.lastPong || null,
  };
}

function collectPoolStats(pool, label) {
  if (!pool || !pool.relays) {
    return { label, relayCount: 0, relays: [] };
  }
  const relays = [];
  for (const [url, relay] of pool.relays.entries()) {
    const stats = collectRelayStats(relay);
    if (stats) {
      stats.url = url;
      relays.push(stats);
    }
  }
  return {
    label,
    relayCount: relays.length,
    relays,
  };
}

function startMetricLogger({ sdk, client, counters, startTime }) {
  const stream = fs.createWriteStream(CONFIG.metricLogPath, { flags: 'a' });
  console.log(`📊 Metrics stream → ${CONFIG.metricLogPath}`);

  const writeSample = (phase = 'interval') => {
    const now = Date.now();
    const uptimeSec = Math.round((now - startTime) / 1000);
    const sample = {
      timestamp: new Date(now).toISOString(),
      tag: CONFIG.metricTag,
      phase,
      uptimeSec,
      counters: {
        heartbeatCount: counters.heartbeatCount,
        successCount: counters.successCount,
        failureCount: counters.failureCount,
      },
      memory: summarizeMemory(),
      pools: [
        collectPoolStats(client.pool, 'client'),
        collectPoolStats(sdk.pool, 'server'),
      ],
    };
    stream.write(`${JSON.stringify(sample)}\n`);
    console.log(
      `[METRIC][${uptimeSec}s] rss=${sample.memory.rssMB}MB heap=${sample.memory.heapUsedMB}/${sample.memory.heapTotalMB}MB relays(client/server)=${sample.pools[0].relayCount}/${sample.pools[1].relayCount}`
    );
  };

  const timer = setInterval(writeSample, CONFIG.metricIntervalMs);
  writeSample('startup');

  return () => {
    clearInterval(timer);
    writeSample('shutdown');
    stream.end();
  };
}

/**
 * RPC method - heartbeat check
 */
function heartbeat(params, event) {
  return {
    status: 'alive',
    timestamp: Date.now(),
    sequence: params.seq,
  };
}

/**
 * Main keepalive test flow
 */
async function runKeepaliveTest() {
  console.log('🚀 Starting Nostr SDK Keepalive Test\n');
  console.log(
    `Test duration: ${(CONFIG.testDurationMs / (60 * 60 * 1000)).toFixed(2)} hours (heartbeat every ${CONFIG.heartbeatIntervalMs / 1000}s)\n`
  );

  // Initialize server
  const sdk = new NostrSdk({
    relays: [RELAY_URL],
    privateKey: Buffer.from(SERVER_PRIVATE_KEY, 'hex'),
    publicKey: SERVER_PUBLIC_KEY,
    allowedAuthors: [CLIENT_PUBLIC_KEY],
  });

  // Register RPC handlers
  sdk.registerMethod('heartbeat', heartbeat);

  // Subscribe to SDK lifecycle events
  sdk.on('error', (err) => console.error('❌ SDK Error:', err.message));
  sdk.on('started', () => console.log('✅ Server started and listening\n'));

  // Start server
  await sdk.start();

  // Allow server to warm up
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Initialize client
  const client = new NostrClient({
    relays: [RELAY_URL],
    privateKey: Buffer.from(CLIENT_PRIVATE_KEY, 'hex'),
    publicKey: CLIENT_PUBLIC_KEY,
    serverPublicKey: SERVER_PUBLIC_KEY,
    timeout: 30000,
  });

  // Connect client
  await client.connect();

  // Wait for client subscription to settle
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test parameters
  const HEARTBEAT_INTERVAL = CONFIG.heartbeatIntervalMs;
  const TEST_DURATION = CONFIG.testDurationMs;
  const START_TIME = Date.now();

  let heartbeatCount = 0;
  let successCount = 0;
  let failureCount = 0;

  const metricCloser = startMetricLogger({
    sdk,
    client,
    startTime: START_TIME,
    counters: {
      get heartbeatCount() {
        return heartbeatCount;
      },
      get successCount() {
        return successCount;
      },
      get failureCount() {
        return failureCount;
      },
    },
  });

  console.log('Starting heartbeat loop...\n');

  let stopped = false;

  // Graceful shutdown
  process.on('SIGINT', () => {
    if (stopped) return;
    stopped = true;
    console.log('\n\n🛑 Test interrupted by user');
    metricCloser();
    client.close();
    sdk.stop();
    process.exit(0);
  });

  // Heartbeat helper (serial, with stable seq per call)
  const sendHeartbeat = async () => {
    const seq = ++heartbeatCount;
    const start = Date.now();
    const elapsed = Math.round((start - START_TIME) / 1000);
    console.log(`[${elapsed}s] 📤 Sending heartbeat #${seq}...`);

    try {
      const result = await client.call('heartbeat', { seq });
      successCount++;
      const recvElapsed = Math.round((Date.now() - START_TIME) / 1000);
      console.log(`[` + recvElapsed + `s] ✅ Heartbeat #${seq} received: status=${result.status}, seq=${result.sequence}\n`);
    } catch (error) {
      failureCount++;
      const failElapsed = Math.round((Date.now() - START_TIME) / 1000);
      console.log(`[` + failElapsed + `s] ❌ Heartbeat #${seq} failed: ${error.message}\n`);
    }
  };

  // Main heartbeat loop: send heartbeats serially until test duration is reached
  const END_TIME = START_TIME + TEST_DURATION;

  while (!stopped && Date.now() < END_TIME) {
    await sendHeartbeat();
    if (stopped) break;
    const remaining = END_TIME - Date.now();
    if (remaining <= 0) break;
    const delay = Math.min(HEARTBEAT_INTERVAL, remaining);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  if (!stopped) {
    console.log('\n========== Test Summary ==========' );
    console.log(`Total heartbeats sent: ${heartbeatCount}`);
    console.log(`Successful: ${successCount} ✅`);
    console.log(`Failed: ${failureCount} ❌`);
    console.log(`Success rate: ${heartbeatCount ? ((successCount / heartbeatCount) * 100).toFixed(1) : '0.0'}%`);
    console.log(`Test duration: ${Math.round((Date.now() - START_TIME) / 1000)}s`);
    console.log('==================================\n');

    // Cleanup resources
    console.log('🛑 Cleaning up...');
    metricCloser();
    client.close();
    sdk.stop();

    if (successCount === heartbeatCount) {
      console.log('✅ Keepalive test PASSED - All heartbeats received!\n');
      process.exit(0);
    } else {
      console.log('❌ Keepalive test FAILED - Some heartbeats were lost!\n');
      process.exit(1);
    }
  }
}

// Kick off keepalive test
runKeepaliveTest().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
