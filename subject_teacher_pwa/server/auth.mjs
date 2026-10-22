import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const SESSION = '__Host-checkon-session';
const FLOW = '__Host-checkon-oauth';
const DAYS = 180 * 86400;
const fail = (status, code) => Object.assign(new Error(code), { status, code });

function configuration(env) {
  const origin = new URL(env.AUTH_ORIGIN).origin;
  const key = Buffer.from(env.AUTH_COOKIE_KEY || '', 'base64');
  if (!origin.startsWith('https://') || key.length !== 32 || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw fail(503, 'auth_unavailable');
  return { origin, key, clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirect: `${origin}/api/auth/callback` };
}
function seal(value, purpose, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(purpose));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const encoded = Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  if (encoded.length > 3800) throw fail(503, 'session_too_large');
  return encoded;
}
function unseal(value, purpose, key) {
  try {
    if (!value || value.length > 3800) return null;
    const bytes = Buffer.from(value, 'base64url');
    const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(purpose));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'));
  } catch { return null; }
}
function readCookie(req, name) {
  return String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1);
}
function cookie(name, value, seconds) {
  return `${name}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`;
}
function equal(a, b) {
  return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** No request, token, cookie, or upstream error body is ever logged. */
export function createAuthHandler({ env = process.env, fetcher = fetch, now = Date.now } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status, value) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    const redirect = (url) => { res.statusCode = 303; res.setHeader('Location', url); res.end(); };
    try {
      const config = configuration(env);
      const url = new URL(req.url, config.origin);
      const action = url.pathname.split('/').pop();
      const expected = ['start', 'callback'].includes(action) ? 'GET' : 'POST';
      if (!['start', 'callback', 'session', 'logout'].includes(action)) throw fail(404, 'not_found');
      if (req.method !== expected) { res.setHeader('Allow', expected); throw fail(405, 'method_not_allowed'); }
      if (req.method === 'POST' && (req.headers.origin !== config.origin || req.headers['x-checkon-request'] !== '1')) throw fail(403, 'invalid_origin');
      const tokenRequest = async (parameters) => {
        let response;
        try {
          response = await fetcher('https://oauth2.googleapis.com/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...parameters }),
            signal: AbortSignal.timeout(12000),
          });
        } catch { throw fail(503, 'google_unavailable'); }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (data.error === 'invalid_grant') throw fail(401, 'reconnect_required');
          throw fail(503, 'google_unavailable');
        }
        if (!data.access_token || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 60) throw fail(503, 'google_unavailable');
        if (data.scope && !data.scope.split(' ').includes(SCOPE)) throw fail(401, 'scope_required');
        return data;
      };
      if (action === 'start') {
        const state = randomBytes(32).toString('base64url');
        const verifier = randomBytes(32).toString('base64url');
        res.setHeader('Set-Cookie', cookie(FLOW, seal({ state, verifier, expires: now() + 600000 }, FLOW, config.key), 600));
        const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        auth.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirect,
          response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent',
          state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
        return redirect(auth.toString());
      }
      if (action === 'callback') {
        const flow = unseal(readCookie(req, FLOW), FLOW, config.key);
        res.setHeader('Set-Cookie', cookie(FLOW, '', 0));
        if (!flow || flow.expires <= now() || !equal(flow.state, url.searchParams.get('state'))) return redirect(`${config.origin}/?auth=invalid_state`);
        if (url.searchParams.has('error') || !url.searchParams.get('code')) return redirect(`${config.origin}/?auth=cancelled`);
        let tokens;
        try { tokens = await tokenRequest({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: config.redirect, code_verifier: flow.verifier }); }
        catch { return redirect(`${config.origin}/?auth=failed`); }
        // Never reuse an old account's refresh token when Google omits one.
        if (!tokens.refresh_token) return redirect(`${config.origin}/?auth=consent_required`);
        const session = { refresh: tokens.refresh_token, access: tokens.access_token,
          accessExpires: now() + Number(tokens.expires_in) * 1000, expires: now() + DAYS * 1000 };
        res.setHeader('Set-Cookie', [cookie(FLOW, '', 0), cookie(SESSION, seal(session, SESSION, config.key), DAYS)]);
        return redirect(`${config.origin}/?auth=connected`);
      }
      const session = unseal(readCookie(req, SESSION), SESSION, config.key);
      if (action === 'logout') {
        if (session?.refresh) {
          let response;
          try { response = await fetcher('https://oauth2.googleapis.com/revoke', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: session.refresh }), signal: AbortSignal.timeout(12000),
          }); } catch { throw fail(503, 'google_unavailable'); }
          if (!response.ok && response.status !== 400) throw fail(503, 'google_unavailable');
        }
        res.setHeader('Set-Cookie', [cookie(SESSION, '', 0), cookie(FLOW, '', 0)]);
        return json(200, { disconnected: true });
      }
      if (!session?.refresh || session.expires <= now()) {
        res.setHeader('Set-Cookie', cookie(SESSION, '', 0));
        throw fail(401, 'reconnect_required');
      }
      if (!session.access || session.accessExpires <= now() + 60000 || req.headers['x-checkon-refresh'] === '1') {
        let tokens;
        try { tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: session.refresh }); }
        catch (error) {
          if (error.status === 401) res.setHeader('Set-Cookie', cookie(SESSION, '', 0));
          throw error;
        }
        session.access = tokens.access_token;
        session.refresh = tokens.refresh_token || session.refresh;
        session.accessExpires = now() + Number(tokens.expires_in) * 1000;
        session.expires = now() + DAYS * 1000;
        res.setHeader('Set-Cookie', cookie(SESSION, seal(session, SESSION, config.key), DAYS));
      }
      return json(200, { access_token: session.access, expires_in: Math.floor((session.accessExpires - now()) / 1000) });
    } catch (error) {
      return json(error.status || 503, { error: error.status ? error.code : 'auth_unavailable' });
    }
  };
}
