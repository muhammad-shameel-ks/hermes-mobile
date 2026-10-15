/**
 * Local storage for the one connection v1 creates and the credentials minted
 * for it. Both live in expo-secure-store: the credential is the gateway's
 * unscoped, unrevocable bearer, so it is treated as root material. Credentials
 * are written in a single setItem so a crash can never pair a fresh access token
 * with a stale refresh token.
 */

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { Credentials } from './tokens.ts';

export type SavedConnection = {
  id: string;
  label: string;
  baseUrl: string;
  authMode: 'oauth';
};

type ConnectionsFile = { version: 1; activeId: string; items: SavedConnection[] };

const CONNECTIONS_KEY = 'hermes.connections';
const TOKENS_PREFIX = 'hermes.tokens.';

const tokensKey = (connectionId: string): string => `${TOKENS_PREFIX}${connectionId}`;

export function createConnectionId(): string {
  const bytes = Crypto.getRandomBytes(8);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function asRecord(parsed: unknown): Record<string, unknown> | null {
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
}

function asConnection(value: unknown): SavedConnection | null {
  const record = asRecord(value);
  if (!record) return null;
  const { id, label, baseUrl, authMode } = record;
  if (typeof id !== 'string' || typeof label !== 'string' || typeof baseUrl !== 'string') return null;
  if (authMode !== 'oauth') return null;
  return { id, label, baseUrl, authMode };
}

async function readConnections(): Promise<ConnectionsFile | null> {
  try {
    const raw = await SecureStore.getItemAsync(CONNECTIONS_KEY);
    if (!raw) return null;
    const record = asRecord(JSON.parse(raw));
    if (!record || !Array.isArray(record.items)) return null;
    const items = record.items.map(asConnection).filter((item): item is SavedConnection => item !== null);
    if (items.length === 0) return null;
    const activeId = typeof record.activeId === 'string' ? record.activeId : items[0].id;
    return { version: 1, activeId, items };
  } catch {
    return null;
  }
}

/** The active connection, or null before the first successful sign-in. */
export async function loadConnection(): Promise<SavedConnection | null> {
  const file = await readConnections();
  if (!file) return null;
  return file.items.find((item) => item.id === file.activeId) ?? file.items[0];
}

export async function saveConnection(connection: SavedConnection): Promise<void> {
  const file = await readConnections();
  const items = file ? file.items.filter((item) => item.id !== connection.id) : [];
  items.push(connection);
  const next: ConnectionsFile = { version: 1, activeId: connection.id, items };
  await SecureStore.setItemAsync(CONNECTIONS_KEY, JSON.stringify(next));
}

export async function loadCredentials(connectionId: string): Promise<Credentials | null> {
  try {
    const raw = await SecureStore.getItemAsync(tokensKey(connectionId));
    if (!raw) return null;
    const record = asRecord(JSON.parse(raw));
    if (!record) return null;
    const { accessToken, refreshToken, tokenType, expiresAt, provider, userId } = record;
    if (typeof accessToken !== 'string' || accessToken === '') return null;
    return {
      accessToken,
      refreshToken: typeof refreshToken === 'string' ? refreshToken : '',
      tokenType: typeof tokenType === 'string' ? tokenType : 'Bearer',
      expiresAt: typeof expiresAt === 'number' ? expiresAt : 0,
      provider: typeof provider === 'string' ? provider : '',
      userId: typeof userId === 'string' ? userId : '',
    };
  } catch {
    return null;
  }
}

export async function saveCredentials(connectionId: string, credentials: Credentials): Promise<void> {
  await SecureStore.setItemAsync(tokensKey(connectionId), JSON.stringify(credentials));
}

export async function clearCredentials(connectionId: string): Promise<void> {
  await SecureStore.deleteItemAsync(tokensKey(connectionId));
}
