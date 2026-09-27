/**
 * Real End-to-End Encryption (E2EE) utilities using Web Cryptography API (crypto.subtle)
 * - ECDH (P-256) Key Pair generation and public key export/import
 * - Derivation of shared AES-GCM (256-bit) session keys
 * - AES-GCM authenticated encryption/decryption with random 96-bit IVs
 * - Safety numbers / cryptographic fingerprint generation (SHA-256)
 */

export interface KeyPairData {
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
}

// In-memory or localStorage cache for user crypto keys
const KEY_STORAGE_PREFIX = 'ciphercall_keys_';

/**
 * Generate a new ECDH P-256 key pair for identity & key exchange
 */
export async function generateIdentityKeyPair(): Promise<{
  keyPair: CryptoKeyPair;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
}> {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true, // extractable
    ['deriveKey', 'deriveBits']
  );

  const publicKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);

  return { keyPair, publicKeyJwk, privateKeyJwk };
}

/**
 * Store or load user keypair for a given user ID
 */
export async function getOrCreateUserKeys(userId: string): Promise<{
  publicKeyJwk: JsonWebKey;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}> {
  const storageKey = `${KEY_STORAGE_PREFIX}${userId}`;
  const stored = localStorage.getItem(storageKey);

  if (stored) {
    try {
      const parsed: KeyPairData = JSON.parse(stored);
      const privateKey = await window.crypto.subtle.importKey(
        'jwk',
        parsed.privateKeyJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey', 'deriveBits']
      );
      const publicKey = await window.crypto.subtle.importKey(
        'jwk',
        parsed.publicKeyJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
      );
      return { publicKeyJwk: parsed.publicKeyJwk, privateKey, publicKey };
    } catch {
      // Re-generate if corrupt
    }
  }

  const generated = await generateIdentityKeyPair();
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      publicKeyJwk: generated.publicKeyJwk,
      privateKeyJwk: generated.privateKeyJwk,
    })
  );

  return {
    publicKeyJwk: generated.publicKeyJwk,
    privateKey: generated.keyPair.privateKey,
    publicKey: generated.keyPair.publicKey,
  };
}

/**
 * Import a peer's public JWK into a CryptoKey for ECDH derivation
 */
export async function importPeerPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return window.crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

/**
 * Derive shared AES-GCM (256-bit) key from own private key and peer's public key
 */
export async function deriveSharedSessionKey(
  ownPrivateKey: CryptoKey,
  peerPublicKey: CryptoKey
): Promise<CryptoKey> {
  return window.crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: peerPublicKey,
    },
    ownPrivateKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false, // not extractable for security
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a text string or serializable payload using AES-GCM 256
 */
export async function encryptPayload(
  key: CryptoKey,
  plaintext: string
): Promise<{ ciphertext: string; iv: string }> {
  // Generate random 96-bit (12 byte) IV
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encodedData = encoder.encode(plaintext);

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    encodedData
  );

  // Convert to Base64 strings
  const ciphertext = arrayBufferToBase64(encryptedBuffer);
  const ivBase64 = arrayBufferToBase64(iv.buffer);

  return { ciphertext, iv: ivBase64 };
}

/**
 * Decrypt a ciphertext string using AES-GCM 256
 */
export async function decryptPayload(
  key: CryptoKey,
  ciphertextBase64: string,
  ivBase64: string
): Promise<string> {
  const ciphertextBuffer = base64ToArrayBuffer(ciphertextBase64);
  const ivBuffer = base64ToArrayBuffer(ivBase64);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(ivBuffer),
    },
    key,
    ciphertextBuffer
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}

/**
 * Generate Safety Numbers / Security Fingerprint (SHA-256) between two users' public keys
 * Formatted like Signal/WhatsApp: 6 blocks of 5 digits
 */
export async function generateSafetyNumber(
  userA_Jwk: JsonWebKey,
  userB_Jwk: JsonWebKey
): Promise<string> {
  const keyAStr = `${userA_Jwk.x || ''}:${userA_Jwk.y || ''}`;
  const keyBStr = `${userB_Jwk.x || ''}:${userB_Jwk.y || ''}`;

  // Sort deterministically so both users compute the exact same fingerprint
  const combined = [keyAStr, keyBStr].sort().join('|');

  const encoder = new TextEncoder();
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', encoder.encode(combined));
  const hashArray = Array.from(new Uint8Array(hashBuffer));

  // Convert bytes into chunks of numbers
  const blocks: string[] = [];
  for (let i = 0; i < 6; i++) {
    // Take 4 bytes per block
    const byteSlice = hashArray.slice(i * 4, i * 4 + 4);
    let num = 0;
    for (const b of byteSlice) {
      num = (num << 8) + b;
    }
    const blockNum = Math.abs(num % 100000);
    blocks.push(blockNum.toString().padStart(5, '0'));
  }

  return blocks.join(' ');
}

// Helpers for Base64 <-> ArrayBuffer
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
