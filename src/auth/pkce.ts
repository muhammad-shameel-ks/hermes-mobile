/**
 * PKCE material and the loopback redirect, per the server's native flow:
 * verifier = 32 random bytes base64url (43 chars), challenge = base64url of its
 * SHA-256 digest, state = 24 random bytes. The redirect must be an http loopback
 * IP literal - `localhost` and custom schemes are rejected by the gateway.
 */

import * as Crypto from 'expo-crypto';

import { base64UrlEncode } from './base64url.ts';

export const CALLBACK_PORT = 9527;
export const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;

export function createCodeVerifier(): string {
  return base64UrlEncode(Crypto.getRandomBytes(32));
}

export function createState(): string {
  return base64UrlEncode(Crypto.getRandomBytes(24));
}

export async function computeCodeChallenge(verifier: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function authorizeUrl(baseUrl: string, codeChallenge: string, state: string): string {
  const query = new URLSearchParams({
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    redirect_uri: REDIRECT_URI,
    state,
  });
  return `${baseUrl}/auth/native/authorize?${query.toString()}`;
}
