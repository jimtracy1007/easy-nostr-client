const NostrClient = require('./src/nostrClient');
const NostrSdk = require('./src/nostrSdk');

const nip04 = require('nostr-tools/nip04');
const nip19 = require('nostr-tools/nip19');
const { SimplePool, useWebSocketImplementation } = require('nostr-tools/pool');
const { finalizeEvent, verifyEvent, generateSecretKey, getPublicKey } = require('nostr-tools/pure');
const { bytesToHex, hexToBytes } = require('@noble/hashes/utils');

module.exports = {
  NostrClient,
  NostrSdk,
  nip04,
  nip19,
  SimplePool,
  useWebSocketImplementation,
  finalizeEvent,
  verifyEvent,
  generateSecretKey,
  getPublicKey,
  bytesToHex,
  hexToBytes,
};
