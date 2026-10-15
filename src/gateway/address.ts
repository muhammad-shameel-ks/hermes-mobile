/**
 * Turns what the reader types on the connect screen into a connection's base URL.
 *
 * A connection stores an explicit scheme and port (issue "Connection model and
 * credential storage"); this module makes both explicit and rejects anything that
 * is not a bare origin, so the stored value is always `${scheme}://${host}:${port}`.
 * A bare host gets `http` when it is a loopback, link-local or private address -
 * the dev-harness affordance - and `https` otherwise, which is the product path.
 */

export type Scheme = 'http' | 'https';

export type GatewayAddress = {
  baseUrl: string;
  scheme: Scheme;
  /** host exactly as it appears in the base URL (IPv6 keeps its brackets) */
  host: string;
  port: number;
  /** host:port, the default connection label */
  label: string;
};

export type AddressResult = { ok: true; address: GatewayAddress } | { ok: false; reason: string };

/** `hermes serve`'s documented default port; https keeps 443. */
export const DEFAULT_HTTP_PORT = 9119;

const PORT_REASON = 'The port must be a number between 1 and 65535.';

const SCHEME_PREFIX = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//;
const HOST_NAME = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;
const IPV6 = /^[0-9a-fA-F:.]+$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const fail = (reason: string): AddressResult => ({ ok: false, reason });

/** true for loopback, link-local, CGNAT-style and the emulator's host alias */
export function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '' || h.endsWith('.local')) return true;
  if (h === '::1' || h === '0.0.0.0') return true;
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  const v4 = IPV4.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 127 ||
      a === 10 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254)
    );
  }
  return false;
}

function splitHostPort(authority: string): { host: string; port: string | null } | null {
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    if (end < 0) return null;
    const host = authority.slice(1, end);
    const tail = authority.slice(end + 1);
    if (tail === '') return { host, port: null };
    if (!tail.startsWith(':')) return null;
    return { host, port: tail.slice(1) };
  }
  const colon = authority.indexOf(':');
  if (colon < 0) return { host: authority, port: null };
  if (authority.indexOf(':', colon + 1) >= 0) return null; // bare IPv6 needs brackets
  return { host: authority.slice(0, colon), port: authority.slice(colon + 1) };
}

function isHostShaped(host: string): boolean {
  if (host === '') return false;
  if (host.includes(':')) return IPV6.test(host);
  if (IPV4.test(host)) return true;
  return HOST_NAME.test(host);
}

export function parseGatewayAddress(raw: string): AddressResult {
  const input = raw.trim();
  if (input === '') return fail('Enter a gateway address.');
  if (/\s/.test(input)) return fail('A gateway address cannot contain spaces.');

  const explicit = SCHEME_PREFIX.exec(input);
  let scheme: Scheme | null = null;
  if (explicit) {
    const named = explicit[1].toLowerCase();
    if (named !== 'http' && named !== 'https') {
      return fail(`“${named}” is not supported — Hermes gateways are reached over http or https.`);
    }
    scheme = named;
  }

  const rest = explicit ? input.slice(explicit[0].length) : input;
  if (rest === '') return fail('Enter a gateway address.');

  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  const tail = authorityEnd === -1 ? '' : rest.slice(authorityEnd);
  if (tail !== '' && tail !== '/') {
    return fail('Give just a host and port, without a path, query or fragment.');
  }

  if (authority.includes('@')) {
    return fail('Remove the credentials from the address.');
  }

  const split = splitHostPort(authority);
  if (!split || !isHostShaped(split.host)) {
    return fail('That does not look like a host name or IP address.');
  }

  let explicitPort: number | null = null;
  if (split.port !== null && split.port !== '') {
    if (!/^\d{1,5}$/.test(split.port)) return fail(PORT_REASON);
    explicitPort = Number(split.port);
    if (explicitPort < 1 || explicitPort > 65535) return fail(PORT_REASON);
  }
  if (!scheme) scheme = isPrivateHost(split.host) ? 'http' : 'https';
  const port = explicitPort ?? (scheme === 'https' ? 443 : DEFAULT_HTTP_PORT);

  let url: URL;
  try {
    url = new URL(`${scheme}://${authority}`);
  } catch {
    return fail('That does not look like a host name or IP address.');
  }

  const host = url.hostname === '' ? split.host : url.hostname;
  return {
    ok: true,
    address: { baseUrl: `${scheme}://${host}:${port}`, scheme, host, port, label: `${host}:${port}` },
  };
}
