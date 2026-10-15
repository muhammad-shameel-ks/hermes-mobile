/**
 * Which glyph names a connection: the desktop draws one per kind (device, cloud, network, terminal) so a
 * gateway looks the same wherever it is named (apps/desktop/src/app/chat/sidebar/connection-glyph.tsx).
 * A phone's connection is a base URL, so its kind is read from the host: this device's own network or
 * a remote one.
 */

import type { CodiconName } from '../ui/Codicon.tsx';

export type ConnectionKind = 'local' | 'remote';

/** loopback, a private LAN address or an mDNS name: a gateway on the reader's own network */
export function connectionKind(baseUrl: string): ConnectionKind {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^:/?#]+)/i.exec(baseUrl.trim());
  const host = (match?.[1] ?? '').replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return 'local';
  const octets = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!octets) return 'remote';
  const [a, b] = [Number(octets[1]), Number(octets[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) ? 'local' : 'remote';
}

export const connectionGlyphName = (kind: ConnectionKind): CodiconName => (kind === 'local' ? 'device-desktop' : 'remote-explorer');
