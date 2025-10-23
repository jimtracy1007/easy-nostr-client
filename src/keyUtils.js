const { getPublicKey } = require('nostr-tools/pure');
const nip19 = require('nostr-tools/nip19');
const { bytesToHex, hexToBytes } = require('@noble/hashes/utils');

/**
 * Determine if a value is an nsec (NIP-19 secret key)
 */
function isNsecKey(value) {
  return typeof value === 'string' && value.startsWith('nsec1');
}

/**
 * Determine if a value is an npub (NIP-19 public key)
 */
function isNpubKey(value) {
  return typeof value === 'string' && value.startsWith('npub1');
}

/**
 * Convert nsec to Uint8Array
 */
function decodeNsecToBytes(nsecKey) {
  if (!isNsecKey(nsecKey)) {
    throw new Error('Invalid nsec key');
  }
  const decoded = nip19.decode(nsecKey);
  return decoded.data;
}

/**
 * Convert secret key (nsec | hex | Uint8Array) to Uint8Array
 */
function normalizeSecretKey(secret) {
  if (secret instanceof Uint8Array) {
    return secret;
  }
  if (Buffer.isBuffer(secret)) {
    return Uint8Array.from(secret);
  }
  if (typeof secret === 'string') {
    if (isNsecKey(secret)) {
      return decodeNsecToBytes(secret);
    }
    if (isHex64(secret)) {
      return hexToBytes(secret);
    }
  }
  throw new Error('Unsupported secret key format');
}

/**
 * Convert Uint8Array/Buffer/hex secret key to hex string
 */
function secretToHex(secret) {
  const bytes = normalizeSecretKey(secret);
  return bytesToHex(bytes);
}

/**
 * Convert secret key to nsec string
 */
function encodeSecretToNsec(secret) {
  const bytes = normalizeSecretKey(secret);
  return nip19.nsecEncode(bytes);
}

/**
 * Derive hex public key from secret (nsec | hex | Uint8Array)
 */
function derivePubkeyFromSecret(secret) {
  const bytes = normalizeSecretKey(secret);
  return getPublicKey(bytes);
}

/**
 * Convert npub to hex public key
 */
function decodeNpubToHex(npubKey) {
  if (!isNpubKey(npubKey)) {
    throw new Error('Invalid npub key');
  }
  const decoded = nip19.decode(npubKey);
  return decoded.data.toLowerCase();
}

/**
 * Convert hex/Uint8Array public key to npub
 */
function encodePubkeyToNpub(pubkey) {
  const hex = publicToHex(pubkey);
  return nip19.npubEncode(hex);
}

/**
 * Normalize public key to hex string
 */
function publicToHex(pubkey) {
  if (pubkey instanceof Uint8Array) {
    return bytesToHex(pubkey);
  }
  if (Buffer.isBuffer(pubkey)) {
    return Buffer.from(pubkey).toString('hex');
  }
  if (typeof pubkey === 'string') {
    if (isNpubKey(pubkey)) {
      return decodeNpubToHex(pubkey);
    }
    if (isHex64(pubkey)) {
      return pubkey.toLowerCase();
    }
  }
  throw new Error('Unsupported public key format');
}

function isHex64(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value);
}

module.exports = {
  isNsecKey,
  isNpubKey,
  decodeNsecToBytes,
  normalizeSecretKey,
  secretToHex,
  encodeSecretToNsec,
  derivePubkeyFromSecret,
  decodeNpubToHex,
  encodePubkeyToNpub,
  publicToHex,
  isHex64,
};
