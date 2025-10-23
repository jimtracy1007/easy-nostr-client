import NostrClient from './src/nostrClient.js';
import NostrSdk from './src/nostrSdk.js';
import keyUtils from './src/keyUtils.js';

import * as nip04 from 'nostr-tools/nip04';
import * as nip19 from 'nostr-tools/nip19';
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import {
  finalizeEvent,
  verifyEvent,
  generateSecretKey,
  getPublicKey,
} from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

const api = {
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
  keyUtils,
};

export {
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
  keyUtils,
};

export default api;
