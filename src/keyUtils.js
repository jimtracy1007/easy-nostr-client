import { getPublicKey, generateSecretKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import * as nip04 from 'nostr-tools/nip04';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/**
 * Determine if a value is an nsec (NIP-19 secret key)
 */
export function isNsecKey(value) {
  return typeof value === 'string' && value.startsWith('nsec1');
}

/**
 * Determine if a value is an npub (NIP-19 public key)
 */
export function isNpubKey(value) {
  return typeof value === 'string' && value.startsWith('npub1');
}

/**
 * Convert nsec to Uint8Array
 */
export function decodeNsecToBytes(nsecKey) {
  if (!isNsecKey(nsecKey)) {
    throw new Error('Invalid nsec key');
  }
  const decoded = nip19.decode(nsecKey);
  return decoded.data;
}

/**
 * Convert secret key (nsec | hex | Uint8Array) to Uint8Array
 */
export function normalizeSecretKey(secret) {
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
export function secretToHex(secret) {
  const bytes = normalizeSecretKey(secret);
  return bytesToHex(bytes);
}

/**
 * Convert secret key to nsec string
 */
export function encodeSecretToNsec(secret) {
  const bytes = normalizeSecretKey(secret);
  return nip19.nsecEncode(bytes);
}

/**
 * Generate a new secret key and return as hex string
 */
export function generatePrivateKey() {
  const secret = generateSecretKey();
  return bytesToHex(secret);
}

/**
 * Derive hex public key from secret (nsec | hex | Uint8Array)
 */
export function derivePubkeyFromSecret(secret) {
  const bytes = normalizeSecretKey(secret);
  return getPublicKey(bytes);
}

/**
 * Convert npub to hex public key
 */
export function decodeNpubToHex(npubKey) {
  if (!isNpubKey(npubKey)) {
    throw new Error('Invalid npub key');
  }
  const decoded = nip19.decode(npubKey);
  return decoded.data.toLowerCase();
}

/**
 * Convert hex/Uint8Array public key to npub
 */
export function encodePubkeyToNpub(pubkey) {
  const hex = publicToHex(pubkey);
  return nip19.npubEncode(hex);
}

/**
 * Normalize public key to hex string
 */
export function publicToHex(pubkey) {
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

export function isHex64(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value);
}

const keyUtils = {
  isNsecKey,
  isNpubKey,
  decodeNsecToBytes,
  normalizeSecretKey,
  secretToHex,
  encodeSecretToNsec,
  generatePrivateKey,
  derivePubkeyFromSecret,
  decodeNpubToHex,
  encodePubkeyToNpub,
  publicToHex,
  isHex64,
  bytesToHex,
  hexToBytes,
  nip19,
  nip04,
};

export default keyUtils;
