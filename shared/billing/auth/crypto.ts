/**
 * WebCrypto Cryptographic Helpers for GexGrow
 * Conforming strictly to AGENTS.md §4:
 * - PBKDF2-SHA256, 100,000 iterations (the Workers maximum), random 16-byte salt (Workers-compatible WebCrypto).
 * - SHA-256 + server pepper for OTPs.
 * - HMAC-SHA256 JWT sign/verify for 15-minute access tokens.
 * - Secure random 6-digit OTP and 32-byte refresh token generation.
 */

// Cloudflare Workers' WebCrypto rejects PBKDF2 above 100,000 iterations (live signup failed at 210k).
const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

function bufToHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Hashes password or PIN using WebCrypto PBKDF2-SHA256
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const enc = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_BYTES * 8,
  );

  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${bufToHex(salt)}$${bufToHex(derived)}`;
}

/**
 * Verifies password against PBKDF2 hash using constant-time comparison
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
    return false;
  }

  const p1 = parts[1];
  const p2 = parts[2];
  const p3 = parts[3];
  if (!p1 || !p2 || !p3) return false;

  const iterations = parseInt(p1, 10);
  const salt = hexToBuf(p2);
  const expectedHash = hexToBuf(p3);

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as ArrayBuffer,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    expectedHash.length * 8,
  );

  const derivedArray = new Uint8Array(derived);
  if (derivedArray.length !== expectedHash.length) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  let diff = 0;
  for (let i = 0; i < derivedArray.length; i++) {
    const dVal = derivedArray[i] ?? 0;
    const eVal = expectedHash[i] ?? 0;
    diff |= dVal ^ eVal;
  }
  return diff === 0;
}

/**
 * Generates a cryptographically secure 6-digit numeric OTP
 */
export function generateOtp(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  const val = array[0] ?? 123456;
  const num = 100000 + (val % 900000);
  return num.toString();
}

/**
 * Hashes an OTP with a server pepper using SHA-256
 */
export async function hashOtp(code: string, pepper: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(`${code}:${pepper}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bufToHex(hash);
}

/**
 * Generates a 32-byte secure random refresh token and its SHA-256 hash
 */
export async function generateRefreshToken(): Promise<{ token: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  const token = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const hash = await hashToken(token);
  return { token, hash };
}

/**
 * Hashes a token using SHA-256 for secure DB lookup
 */
export async function hashToken(token: string): Promise<string> {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(token));
  return bufToHex(hash);
}

export interface JwtPayload {
  sub: string; // userId
  name: string;
  phone: string;
  email?: string | null;
  isSuperAdmin?: boolean;
  businessId?: string;
  roleKey?: string;
  /** Token type. Access tokens are 'access'; signup contact-verification tokens are 'contact' and never accepted as auth. */
  typ?: 'access' | 'contact';
  /** For 'contact' tokens: the verified channel. */
  ch?: 'SMS' | 'EMAIL';
  iat: number;
  exp: number;
}

/**
 * Signs a JWT with HMAC-SHA256 using WebCrypto
 */
export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const sigBytes = new Uint8Array(signature);
  let sigBinary = '';
  for (let i = 0; i < sigBytes.length; i++) {
    sigBinary += String.fromCharCode(sigBytes[i] ?? 0);
  }
  const encodedSignature = btoa(sigBinary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${data}.${encodedSignature}`;
}

/**
 * Verifies a JWT and returns its payload if valid and unexpired
 */
export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const headerB64 = parts[0];
    const payloadB64 = parts[1];
    const signatureB64 = parts[2];
    if (!headerB64 || !payloadB64 || !signatureB64) return null;

    const data = `${headerB64}.${payloadB64}`;
    const enc = new TextEncoder();

    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    let sigB64 = signatureB64.replace(/-/g, '+').replace(/_/g, '/');
    while (sigB64.length % 4) {
      sigB64 += '=';
    }
    const sigBinary = atob(sigB64);
    const sigBytes = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) {
      sigBytes[i] = sigBinary.charCodeAt(i);
    }

    const isValid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data));
    if (!isValid) return null;

    const payload: JwtPayload = JSON.parse(base64UrlDecode(payloadB64));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null; // Expired
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Encrypts sensitive data (e.g. bank account numbers) using AES-256-GCM
 */
export async function encryptAesGcm(plainText: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const keyHash = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  const key = await crypto.subtle.importKey('raw', keyHash, { name: 'AES-GCM' }, false, ['encrypt']);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plainText),
  );

  const combined = new Uint8Array(iv.length + cipherBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuffer), iv.length);

  let binary = '';
  for (let i = 0; i < combined.length; i++) {
    binary += String.fromCharCode(combined[i]!);
  }
  return btoa(binary);
}

/**
 * Decrypts AES-256-GCM encrypted ciphertext
 */
export async function decryptAesGcm(cipherTextB64: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const keyHash = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  const key = await crypto.subtle.importKey('raw', keyHash, { name: 'AES-GCM' }, false, ['decrypt']);

  const binary = atob(cipherTextB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const iv = bytes.slice(0, 12);
  const data = bytes.slice(12);

  const decryptedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(decryptedBuffer);
}

/**
 * Masks bank account number, displaying only the last 4 digits
 */
export function maskAccountNumber(accountNumber: string): string {
  const clean = accountNumber.trim();
  if (clean.length <= 4) return clean;
  return `•••• ${clean.slice(-4)}`;
}

