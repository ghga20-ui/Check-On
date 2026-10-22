// Only public school and timetable data passes through this endpoint.
const endpoints = new Set(['schoolInfo', 'elsTimetable', 'misTimetable', 'hisTimetable', 'spsTimetable']);
const patterns = {
  ATPT_OFCDC_SC_CODE: /^[B-HJ-NP-T]10$|^I10$/,
  SD_SCHUL_CODE: /^\d{7,10}$/,
  SCHUL_NM: /^[가-힣A-Za-z0-9 ()·.-]{2,60}$/,
  ALL_TI_YMD: /^\d{8}$/,
  GRADE: /^[1-6]$/,
  CLASS_NM: /^[가-힣A-Za-z0-9 ()·._-]{1,30}$/,
};
export function validateRequest(body) {
  if (!body || !endpoints.has(body.endpoint) || !body.params || typeof body.params !== 'object' || Array.isArray(body.params)) throw new Error('invalid_request');
  const params = { Type: 'json', pIndex: '1', pSize: '100' };
  for (const [key, value] of Object.entries(body.params)) {
    if (['Type', 'pIndex', 'pSize'].includes(key)) {
      if (String(value) !== params[key]) throw new Error('invalid_request');
    } else {
      if (!patterns[key]?.test(String(value))) throw new Error('invalid_request');
      params[key] = String(value);
    }
  }
  if (!params.ATPT_OFCDC_SC_CODE) throw new Error('invalid_request');
  if (body.endpoint === 'schoolInfo') {
    if (!(params.SCHUL_NM || params.SD_SCHUL_CODE) || params.ALL_TI_YMD || params.GRADE || params.CLASS_NM) throw new Error('invalid_request');
  } else if (!params.SD_SCHUL_CODE || !params.ALL_TI_YMD || !params.GRADE || params.SCHUL_NM) throw new Error('invalid_request');
  return { endpoint: body.endpoint, params };
}

export function createNeisHandler({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map(), inflight = new Map(), rates = new Map();
  let windowStart = 0, requests = 0;
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body) => res.status(status).json(body);
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(405, {error:'method_not_allowed'}); }
    let query;
    try {
      if (JSON.stringify(req.body).length > 2048) throw new Error();
      query = validateRequest(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
    } catch { return send(400, {error:'invalid_request'}); }
    if (!env.NEIS_API_KEY) return send(503, {error:'timetable_unavailable'});
    const time = now();
    if (time - windowStart >= 60000) { windowStart = time; requests = 0; rates.clear(); }
    // Instance-local protection; platform-wide quotas remain an operator setting.
    const ip = String(req.headers?.['x-real-ip'] || req.headers?.['x-vercel-forwarded-for'] || 'unknown');
    const count = (rates.get(ip) || 0) + 1;
    rates.set(ip, count);
    if (++requests > 600 || count > 120 || rates.size > 600) { res.setHeader('Retry-After','60'); return send(429, {error:'try_again_later'}); }
    const id = JSON.stringify([query.endpoint, Object.entries(query.params).sort()]);
    const saved = cache.get(id);
    if (saved && saved.until > time) return send(200, saved.body);
    cache.delete(id);
    try {
      if (!inflight.has(id)) {
        if (inflight.size >= 16) { res.setHeader('Retry-After','5'); return send(429, {error:'try_again_later'}); }
        const work = (async () => {
          const url = new URL(`https://open.neis.go.kr/hub/${query.endpoint}`);
          url.search = new URLSearchParams({...query.params, KEY:env.NEIS_API_KEY}).toString();
          const response = await fetchImpl(url, {signal:AbortSignal.timeout(7000), redirect:'error'});
          if (!response.ok) throw new Error();
          const raw = await response.text();
          if (raw.length > 2000000) throw new Error();
          const body = JSON.parse(raw);
          if (!body || typeof body !== 'object' || (!body[query.endpoint] && body.RESULT?.CODE !== 'INFO-200')) throw new Error();
          if (cache.size >= 500) cache.delete(cache.keys().next().value);
          cache.set(id,{body,until:now()+300000});
          return body;
        })();
        inflight.set(id, work);
      }
      return send(200, await inflight.get(id));
    } catch { return send(502, {error:'timetable_unavailable'}); }
    finally { inflight.delete(id); }
  };
}
