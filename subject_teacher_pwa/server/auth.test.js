// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createAuthHandler, SCOPE } from './auth.mjs';
const env = { AUTH_ORIGIN: 'https://app.example', AUTH_COOKIE_KEY: Buffer.alloc(32, 7).toString('base64'), GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' };
function harness(fetcher = vi.fn(), settings = env) {
  let time = 1000000;
  const handler = createAuthHandler({ env: settings, fetcher, now: () => time });
  const call = async (path, { method = 'GET', cookie = '', headers = {} } = {}) => {
    const result = { statusCode: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(body = '') { this.body = body; } };
    await handler({ url: `/api/auth/${path}`, method, headers: { cookie, ...headers } }, result);
    return result;
  };
  return { call, advance: ms => { time += ms; }, fetcher };
}
const post = { method: 'POST', headers: { origin: env.AUTH_ORIGIN, 'x-checkon-request': '1' } };
const extract = response => [].concat(response.headers['Set-Cookie'] || []).map(s => s.split(';')[0]).join('; ');
async function login(h) {
  const start = await h.call('start');
  const url = new URL(start.headers.Location);
  h.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access-original', refresh_token: 'refresh-private', expires_in: 3600, scope: SCOPE })));
  const result = await h.call(`callback?state=${url.searchParams.get('state')}&code=one-use-code`, { cookie: extract(start) });
  return { result, cookies: extract(result), start, url };
}
describe('persistent Google session', () => {
  it('binds consent to state and PKCE and keeps refresh tokens out of response bodies', async () => {
    const h = harness(); const {result, cookies, url} = await login(h);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(result.headers.Location).toBe('https://app.example/?auth=connected');
    expect(cookies).not.toContain('refresh-private');
    expect(result.headers['Set-Cookie'][1]).toContain('HttpOnly; Secure; SameSite=Lax');
    expect(result.headers['Cache-Control']).toContain('no-store');
    const restored = await h.call('session', {...post, cookie: cookies});
    expect(restored.statusCode).toBe(200);
    expect(JSON.parse(restored.body).access_token).toBe('access-original');
    expect(restored.body).not.toContain('refresh');
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it('automatically refreshes after an hour with the same protected session', async () => {
    const h = harness(); const {cookies} = await login(h);
    h.advance(3600001);
    h.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'renewed', expires_in: 3600 })));
    const result = await h.call('session', {...post, cookie: cookies});
    expect(JSON.parse(result.body).access_token).toBe('renewed');
    expect(h.fetcher.mock.calls[1][1].body.get('grant_type')).toBe('refresh_token');
    expect(h.fetcher.mock.calls[1][1].body.get('refresh_token')).toBe('refresh-private');
    expect(result.headers['Set-Cookie']).not.toContain('refresh-private');
  });
  it('rejects bad or expired state before exchanging a code', async () => {
    const h = harness(); const start = await h.call('start');
    const state = new URL(start.headers.Location).searchParams.get('state');
    expect((await h.call('callback?state=wrong&code=secret', {cookie: extract(start)})).headers.Location).toContain('invalid_state');
    const unicode = encodeURIComponent('가'.repeat(state.length));
    expect((await h.call(`callback?state=${unicode}&code=secret`, {cookie: extract(start)})).headers.Location).toContain('invalid_state');
    h.advance(600001);
    expect((await h.call(`callback?state=${state}&code=secret`, {cookie: extract(start)})).headers.Location).toContain('invalid_state');
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('rejects cross-site refresh and logout and non-POST token requests', async () => {
    const h = harness(); const {cookies} = await login(h);
    for (const action of ['session', 'logout']) {
      expect((await h.call(action, {method:'POST', cookie:cookies, headers:{origin:'https://evil.example','x-checkon-request':'1'}})).statusCode).toBe(403);
      expect((await h.call(action, {cookie:cookies})).statusCode).toBe(405);
    }
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects a tampered session or one encrypted under a different server key', async () => {
    const h = harness(); const {cookies} = await login(h);
    const wrong = harness(vi.fn(), {...env, AUTH_COOKIE_KEY: Buffer.alloc(32, 8).toString('base64')});
    expect((await wrong.call('session', {...post,cookie:cookies})).statusCode).toBe(401);
    expect((await h.call('session', {...post,cookie:cookies.replace('__Host-checkon-session=', '__Host-checkon-session=broken')})).statusCode).toBe(401);
  });
  it('keeps the session on temporary Google errors but clears it after revocation', async () => {
    const h = harness(); const {cookies} = await login(h); h.advance(3600001);
    h.fetcher.mockResolvedValueOnce(new Response('unavailable', {status:503}));
    const temporary = await h.call('session', {...post,cookie:cookies});
    expect(temporary.statusCode).toBe(503); expect(temporary.headers['Set-Cookie']).toBeUndefined();
    h.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({error:'invalid_grant', error_description:'secret-details'}), {status:400}));
    const revoked = await h.call('session', {...post,cookie:cookies});
    expect(revoked.statusCode).toBe(401); expect(revoked.headers['Set-Cookie']).toContain('Max-Age=0');
    expect(revoked.body).not.toContain('secret-details');
  });
  it('revokes Google access on logout and clears both cookies', async () => {
    const h = harness(); const {cookies} = await login(h);
    h.fetcher.mockResolvedValueOnce(new Response(''));
    const result = await h.call('logout', {...post,cookie:cookies});
    expect(result.statusCode).toBe(200);
    expect(h.fetcher.mock.calls[1][0]).toBe('https://oauth2.googleapis.com/revoke');
    expect(result.headers['Set-Cookie'].every(c => c.includes('Max-Age=0'))).toBe(true);
  });
  it('never borrows a previous account refresh token when consent omits it', async () => {
    const h = harness(); const start = await h.call('start');
    h.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({access_token:'a',expires_in:3600})));
    const result = await h.call(`callback?state=${new URL(start.headers.Location).searchParams.get('state')}&code=x`,{cookie:extract(start)});
    expect(result.headers.Location).toContain('consent_required');
    expect(extract(result)).not.toContain('__Host-checkon-session=');
  });
  it('does not expose server credentials when configuration is missing', async () => {
    const result = await harness(vi.fn(), {}).call('start');
    expect(result.statusCode).toBe(503); expect(result.body).toBe('{"error":"auth_unavailable"}');
  });
});
