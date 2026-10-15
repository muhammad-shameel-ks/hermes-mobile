/**
 * PROTOTYPE — throwaway. Answers one question: does the RFC 8252 loopback PKCE
 * sign-in path work end to end on Android against a real gated Hermes gateway
 * (system-browser authorize -> in-app loopback listener -> code exchange ->
 * refresh -> secure storage -> bearer REST -> ws ticket)?
 *
 * Wayfinder ticket: "Sign-in prototype: loopback PKCE against the live gateway".
 * Not production code: no abstractions, no error handling beyond runnability,
 * harness credentials as constants, every step logged on screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { HttpServer } from 'react-native-nitro-http-server';
import TcpSocket from 'react-native-tcp-socket';

const BASE = 'http://127.0.0.1:9119';
const WS_BASE = 'ws://127.0.0.1:9119';
const PORT = 9527;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const USERNAME = 'hermes-mobile';
const PASSWORD = 'pkce-harness-pw';
const STORE_KEY = 'hermes.prototype.tokens';

type Line = { t: number; level: 'info' | 'ok' | 'err'; text: string };
type Listener = { kind: string; stop: () => Promise<void> };
type StatusPayload = { auth_required?: boolean; auth_flows?: string[]; version?: string };
type TokenPayload = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type?: string;
  user_id?: string;
};
type CallbackPayload = { code: string; state: string; raw: string };

const b64u = (bytes: Uint8Array): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += alphabet[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += alphabet[b2 & 63];
  }
  return out;
};

const trunc = (s: string, n = 220): string => (s.length > n ? `${s.slice(0, n)}…(${s.length} chars)` : s);

const asObject = (raw: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const asString = (v: unknown): string => (typeof v === 'string' ? v : '');

const toTokens = (raw: string): TokenPayload | null => {
  const o = asObject(raw);
  if (!o || typeof o.access_token !== 'string') return null;
  return {
    access_token: o.access_token,
    refresh_token: asString(o.refresh_token),
    expires_at: typeof o.expires_at === 'number' ? o.expires_at : 0,
    token_type: asString(o.token_type),
    user_id: asString(o.user_id),
  };
};

const errorText = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);

async function req(path: string, init: RequestInit = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, signal: ctrl.signal });
    const body = await res.text();
    return { status: res.status, body, ms: Date.now() - startedAt };
  } catch (e) {
    return { status: 0, body: `FETCH FAILED: ${errorText(e)}`, ms: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

const delay = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

export default function App() {
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const t0 = useRef(Date.now());
  const listener = useRef<Listener | null>(null);
  const callback = useRef<((v: CallbackPayload) => void) | null>(null);
  const started = useRef(false);

  const log = useCallback((level: Line['level'], text: string) => {
    setLines((prev) => [...prev, { t: Date.now() - t0.current, level, text }]);
  }, []);

  /** nitro HTTP server: handler sees `request.path` (query visibility is the open question). */
  const startNitro = async (): Promise<Listener> => {
    const server = new HttpServer();
    const bound = await server.start(
      PORT,
      (request) => {
        log('info', `listener <- ${request.method} ${request.path}`);
        log('info', `  headers: ${trunc(JSON.stringify(request.headers), 180)}`);
        const query = request.path?.includes('?') ? request.path.split('?')[1] : '';
        if (!query) log('err', '  path carried NO query string (nitro stripped it?)');
        const params = new URLSearchParams(query);
        const code = params.get('code') ?? '';
        if (code) callback.current?.({ code, state: params.get('state') ?? '', raw: `${request.method} ${request.path}` });
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          body: `<html><body style="font-family:monospace;padding:24px"><h3>Hermes prototype</h3><p>${
            code ? 'code received — return to the app' : 'no code in this request'
          }</p></body></html>`,
        };
      },
      { host: '127.0.0.1' },
    );
    log('ok', `nitro listener bound 127.0.0.1:${bound} (asked for ${PORT})`);
    return {
      kind: 'nitro',
      stop: async () => {
        await server.stop();
      },
    };
  };

  /** Fallback: raw TCP + one-line HTTP parse (react-native-tcp-socket). */
  const startRawTcp = (): Promise<Listener> => {
    const { promise, resolve, reject } = Promise.withResolvers<Listener>();
    const server = TcpSocket.createServer((socket) => {
      socket.on('data', (data: { toString: () => string } | string) => {
        const text = String(data);
        const requestLine = text.split('\r\n')[0] ?? '';
        log('info', `raw listener <- ${trunc(requestLine, 160)}`);
        const target = requestLine.split(' ')[1] ?? '';
        const query = target.includes('?') ? target.split('?')[1] : '';
        const params = new URLSearchParams(query);
        const code = params.get('code') ?? '';
        if (code) callback.current?.({ code, state: params.get('state') ?? '', raw: requestLine });
        const page = `<html><body style="font-family:monospace;padding:24px"><h3>Hermes prototype (raw tcp)</h3><p>${
          code ? 'code received — return to the app' : 'no code'
        }</p></body></html>`;
        socket.write(
          `HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${page.length}\r\nConnection: close\r\n\r\n${page}`,
        );
        socket.end();
      });
    });
    server.on('error', (e: Error) => {
      log('err', `raw listener error: ${errorText(e)}`);
      reject(e);
    });
    server.listen({ port: PORT, host: '127.0.0.1' }, () => {
      log('ok', `raw TCP listener bound 127.0.0.1:${PORT}`);
      resolve({
        kind: 'raw-tcp',
        stop: async () => {
          server.close();
        },
      });
    });
    return promise;
  };

  const dialWs = useCallback(
    (url: string, label: string): Promise<string> => {
      const settled = Promise.withResolvers<string>();
      const ws = new WebSocket(url);
      const finish = (note: string, level: Line['level'] = 'ok') => {
        log(level, `${label}: ${note}`);
        try {
          ws.close();
        } catch {
          /* already closed */
        }
        settled.resolve(note);
      };
      const timer = setTimeout(() => finish('no event within 12s', 'err'), 12000);
      ws.onopen = () => log('info', `${label}: open`);
      ws.onmessage = (event: { data: unknown }) => {
        clearTimeout(timer);
        finish(`first frame ${trunc(String(event.data), 160)}`);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        finish('error event (RN reports no detail)', 'err');
      };
      ws.onclose = (event: { code?: number; reason?: string }) =>
        log('info', `${label}: close code=${event?.code} reason=${trunc(String(event?.reason ?? ''), 60)}`);
      return settled.promise;
    },
    [log],
  );

  const run = useCallback(
    async (kind: 'nitro' | 'raw-tcp') => {
      setBusy(true);
      setLines([]);
      t0.current = Date.now();
      try {
        // 0. what does the gateway advertise?
        const status = await req('/api/status');
        const advertised = asObject(status.body) as StatusPayload | null;
        log(
          advertised?.auth_flows?.includes('native_pkce') ? 'ok' : 'err',
          `GET /api/status -> ${status.status} in ${status.ms}ms  auth_required=${String(advertised?.auth_required)} flows=${JSON.stringify(advertised?.auth_flows)} version=${String(advertised?.version)}`,
        );

        // 1. storage: does a token survive a previous run?
        const existing = await SecureStore.getItemAsync(STORE_KEY);
        log('info', `SecureStore["${STORE_KEY}"] = ${existing ? `${existing.length} chars from an earlier run` : 'empty'}`);

        // 2. listener
        listener.current = kind === 'nitro' ? await startNitro() : await startRawTcp();

        // 3. PKCE material
        const verifier = b64u(Crypto.getRandomBytes(32));
        const challenge = (
          await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
            encoding: Crypto.CryptoEncoding.BASE64,
          })
        )
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        const state = b64u(Crypto.getRandomBytes(24));
        log('info', `verifier ${verifier.length} chars, challenge ${challenge.length}, state ${state.length}`);

        const authorizeUrl = `${BASE}/auth/native/authorize?${new URLSearchParams({
          code_challenge: challenge,
          code_challenge_method: 'S256',
          redirect_uri: REDIRECT_URI,
          state,
        })}`;
        log('info', `authorize: ${trunc(authorizeUrl, 160)}`);

        const redirected = Promise.withResolvers<CallbackPayload>();
        callback.current = redirected.resolve;
        const browse = await WebBrowser.openBrowserAsync(authorizeUrl, { showTitle: true });
        log('info', `openBrowserAsync -> ${JSON.stringify(browse)}`);

        const got = await Promise.race([
          redirected.promise,
          delay(180000).then(() => {
            throw new Error('redirect timeout after 180s');
          }),
        ]);
        log(got.state === state ? 'ok' : 'err', `redirect state ${got.state === state ? 'MATCHES' : 'MISMATCH'}`);

        // 4. redeem
        const exchanged = await req('/auth/native/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: got.code, code_verifier: verifier }),
        });
        log(
          exchanged.status === 200 ? 'ok' : 'err',
          `POST /auth/native/token -> ${exchanged.status} in ${exchanged.ms}ms ${trunc(exchanged.body, 140)}`,
        );
        const tokens = toTokens(exchanged.body);
        if (!tokens) throw new Error('exchange failed');
        const ttlS = tokens.expires_at - Math.floor(Date.now() / 1000);
        log('info', `access ttl=${ttlS}s access=${trunc(tokens.access_token, 40)} refresh=${trunc(tokens.refresh_token, 40)}`);

        // 5. storage round trip
        const stored = JSON.stringify(tokens);
        await SecureStore.setItemAsync(STORE_KEY, stored);
        const readBack = await SecureStore.getItemAsync(STORE_KEY);
        log(readBack ? 'ok' : 'err', `SecureStore write/read: ${readBack === stored ? 'identical' : 'MISMATCH'} (${readBack?.length ?? 0} chars)`);

        const authHeader = { Authorization: `Bearer ${tokens.access_token}` };

        // 6. REST with and without the bearer
        const anon = await req('/api/sessions');
        log('info', `GET /api/sessions anonymous -> ${anon.status} ${trunc(anon.body, 120)}`);
        const authed = await req('/api/sessions', { headers: authHeader });
        log(authed.status === 200 ? 'ok' : 'err', `GET /api/sessions bearer -> ${authed.status} ${trunc(authed.body, 120)}`);

        // 7. ws ticket + socket
        const ticketRes = await req('/api/auth/ws-ticket', { method: 'POST', headers: authHeader });
        log(ticketRes.status === 200 ? 'ok' : 'err', `POST /api/auth/ws-ticket -> ${ticketRes.status} ${trunc(ticketRes.body, 120)}`);
        const ticket = asString(asObject(ticketRes.body)?.ticket);
        if (ticket) {
          await dialWs(`${WS_BASE}/api/ws?ticket=${ticket}`, 'ws ticket');
          await dialWs(`${WS_BASE}/api/ws?ticket=${ticket}`, 'ws ticket reused');
        }
        await dialWs(`${WS_BASE}/api/ws?token=${tokens.access_token}`, 'ws token=');

        // 8. refresh: new pair? rotation?
        const refreshed = await req('/auth/native/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: tokens.refresh_token, provider: '' }),
        });
        log(refreshed.status === 200 ? 'ok' : 'err', `POST /auth/native/refresh -> ${refreshed.status} ${trunc(refreshed.body, 160)}`);
        const rotated = toTokens(refreshed.body);
        if (rotated) {
          log(
            'info',
            `refresh rotated access=${rotated.access_token !== tokens.access_token} refresh=${rotated.refresh_token !== tokens.refresh_token} expires_at=${rotated.expires_at} (was ${tokens.expires_at})`,
          );
        }

        // 9. real expiry: wait it out, expect 401 then one silent refresh
        const expiresAt = tokens.expires_at;
        log('info', `expiry test: waiting for the access token to expire at ${new Date(expiresAt * 1000).toISOString()}`);
        while (Math.floor(Date.now() / 1000) < expiresAt + 2) {
          const left = expiresAt - Math.floor(Date.now() / 1000);
          log('info', `  …${left}s`);
          await delay(Math.min(20000, Math.max(1000, left * 1000)));
        }
        const stale = await req('/api/sessions', { headers: authHeader });
        log('info', `GET /api/sessions with EXPIRED bearer -> ${stale.status} ${trunc(stale.body, 140)}`);
        await dialWs(`${WS_BASE}/api/ws?token=${tokens.access_token}`, 'ws token= (expired)');
        const recover = await req('/auth/native/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: tokens.refresh_token, provider: '' }),
        });
        log(recover.status === 200 ? 'ok' : 'err', `refresh after expiry -> ${recover.status} ${trunc(recover.body, 120)}`);
        const fresh = toTokens(recover.body);
        if (fresh) {
          const retry = await req('/api/sessions', { headers: { Authorization: `Bearer ${fresh.access_token}` } });
          log(retry.status === 200 ? 'ok' : 'err', `GET /api/sessions with refreshed bearer -> ${retry.status} ${trunc(retry.body, 100)}`);
        }
        log('ok', 'FLOW COMPLETE');
      } catch (e) {
        log('err', `FLOW ABORTED: ${errorText(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [log, dialWs],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run('nitro');
  }, [run]);

  const probeCollision = async () => {
    log('info', 'collision probe: starting a second nitro server on 9527…');
    try {
      const second = new HttpServer();
      const bound = await second.start(PORT, () => ({ statusCode: 200, body: 'second' }), { host: '127.0.0.1' });
      log('err', `second server on 9527 returned port=${bound} (no collision error!)`);
      await second.stop();
    } catch (e) {
      log('ok', `second server rejected: ${errorText(e)}`);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>loopback PKCE prototype</Text>
      <Text style={styles.sub}>
        {BASE} · redirect {REDIRECT_URI} · user {USERNAME}
      </Text>
      <View style={styles.row}>
        <Pressable style={styles.btn} onPress={() => void run('nitro')} disabled={busy}>
          <Text style={styles.btnText}>restart (nitro)</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => void run('raw-tcp')} disabled={busy}>
          <Text style={styles.btnText}>restart (raw tcp)</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => void probeCollision()} disabled={busy}>
          <Text style={styles.btnText}>probe port collision</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        <Pressable
          style={styles.btn}
          disabled={busy}
          onPress={() => {
            void (async () => {
              const v = await SecureStore.getItemAsync(STORE_KEY);
              log('info', `SecureStore re-read: ${v ? `${v.length} chars` : 'empty'}`);
            })();
          }}
        >
          <Text style={styles.btnText}>read storage</Text>
        </Pressable>
        <Pressable
          style={styles.btn}
          disabled={busy}
          onPress={() => {
            void (async () => {
              await SecureStore.deleteItemAsync(STORE_KEY);
              log('info', 'storage wiped');
            })();
          }}
        >
          <Text style={styles.btnText}>wipe storage</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.log} contentContainerStyle={{ paddingBottom: 40 }}>
        {lines.map((l, i) => (
          <Text key={i} style={[styles.line, l.level === 'ok' && styles.ok, l.level === 'err' && styles.err]}>
            {String(l.t).padStart(6)}ms {l.text}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 48, paddingHorizontal: 12, backgroundColor: '#111' },
  title: { color: '#fff', fontFamily: 'monospace', fontSize: 16, fontWeight: '700' },
  sub: { color: '#8ab4f8', fontFamily: 'monospace', fontSize: 11, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 6, marginBottom: 6, flexWrap: 'wrap' },
  btn: { backgroundColor: '#2b3a55', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 4 },
  btnText: { color: '#fff', fontFamily: 'monospace', fontSize: 11 },
  log: { flex: 1, backgroundColor: '#000', borderRadius: 4, padding: 8 },
  line: { color: '#ddd', fontFamily: 'monospace', fontSize: 10, marginBottom: 2 },
  ok: { color: '#7ee787' },
  err: { color: '#ff7b72' },
});
