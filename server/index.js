'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { isIP } = require('node:net');
const { timingSafeEqual, randomBytes } = require('node:crypto');
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const { clients, ApiError } = require('./services/externalApiConnectors');
const { INDUSTRY_CODES, REGIONS_TREE } = require('./data/publicDatasetStore');
const { createAccounts } = require('./services/accounts');
const { createCardSalesService } = require('./services/cardSalesService');
const accounts = createAccounts();
const cardSales = createCardSalesService({ connectors: clients });
const authLimits = new Map();
const PUBLIC = path.join(__dirname, '..', 'public');
const limits = new Map();
function json(res, code, value) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
async function readBody(req, maxBytes = 65536) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) throw new ApiError('INVALID_INPUT', 'JSON 형식으로 요청하세요.', 415);
  if (Number(req.headers['content-length']) > maxBytes) { req.resume(); throw new ApiError('PAYLOAD_TOO_LARGE', '요청 크기를 줄여 주세요.', 413); }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > maxBytes) { req.resume(); throw new ApiError('PAYLOAD_TOO_LARGE', '요청 크기를 줄여 주세요.', 413); }
    chunks.push(chunk);
  }
  // Decode once: a Korean character may span two TCP chunks.
  const raw = Buffer.concat(chunks).toString('utf8');
  try { const value = JSON.parse(raw || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new ApiError('INVALID_JSON', 'JSON 형식이 올바르지 않습니다.'); }
}
function trustedProxy(req) {
  return process.env.TRUST_PROXY === 'loopback' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
}
function clientIp(req) {
  if (trustedProxy(req)) {
    // Trust only the final hop appended by the local reverse proxy.
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').at(-1).trim();
    if (isIP(forwarded)) return forwarded;
  }
  return req.socket.remoteAddress;
}
function requestBase(req) {
  const base = new URL(`${req.secure ? 'https' : 'http'}://${req.headers.host || 'localhost'}`);
  if (base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new ApiError('INVALID_INPUT', '요청 주소를 확인하세요.');
  return base.origin;
}
function publicBase(req) {
  if (!process.env.PUBLIC_BASE_URL?.trim()) return requestBase(req);
  try {
    const base = new URL(process.env.PUBLIC_BASE_URL.trim());
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error();
    if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error();
    return base.origin;
  } catch { throw new ApiError('INVALID_CONFIG', 'PUBLIC_BASE_URL에 HTTPS 사이트 주소를 설정하세요.', 503); }
}
function admin(req) {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected || expected.length < 24 || expected.startsWith('dev-admin')) throw new ApiError('ADMIN_NOT_CONFIGURED', '서버에 24자 이상의 ADMIN_API_TOKEN을 설정하세요.', 503);
  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  const a = Buffer.from(token), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError('UNAUTHORIZED', '관리자 인증이 필요합니다.', 401);
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  try {
    req.secure = Boolean(req.socket.encrypted) || (trustedProxy(req) && req.headers['x-forwarded-proto'] === 'https');
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname;
    if (route.startsWith('/api/')) {
      const now = Date.now(), ip = clientIp(req);
      for (const [k, v] of limits) if (now > v.until) limits.delete(k);
      const limit = limits.get(ip) || { count: 0, until: now + 60000 };
      limits.set(ip, limit);
      if (++limit.count > 120) { res.setHeader('Retry-After', String(Math.max(1, Math.ceil((limit.until - now) / 1000)))); throw new ApiError('RATE_LIMITED', '잠시 후 다시 시도하세요.', 429); }
      if (req.headers.origin && ![requestBase(req), publicBase(req)].includes(req.headers.origin)) throw new ApiError('ORIGIN_DENIED', '동일 출처에서 요청하세요.', 403);
      if (route === '/api/health' && req.method === 'GET') return json(res, 200, { status: 'OK', mode: 'SERVER', providers: clients.status() });
      if (route === '/api/auth/me' && req.method === 'GET') {
        const oauth = clients.kakaoOAuth();
        return json(res, 200, { user: accounts.current(req, false), kakao_login: Boolean(oauth.clientId), kakao_sdk: oauth.jsSdkConfigured });
      }
      if (route === '/api/auth/kakao/start' && req.method === 'GET') {
        const { clientId } = clients.kakaoOAuth();
        if (!clientId) throw new ApiError('NOT_CONFIGURED', '서버에 카카오 로그인 키가 설정되지 않았습니다.', 503);
        const base = publicBase(req);
        const redirectUri = `${base}/api/auth/kakao/callback`;
        const stateToken = randomBytes(24).toString('hex');
        res.writeHead(302, {
          Location: `https://kauth.kakao.com/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${stateToken}`,
          'Set-Cookie': `kakao_oauth_state=${stateToken}; HttpOnly; SameSite=Lax; Path=/api/auth/kakao; Max-Age=600${base.startsWith('https:') ? '; Secure' : ''}`,
          'Cache-Control': 'no-store'
        });
        return res.end();
      }
      if (route === '/api/auth/kakao/callback' && req.method === 'GET') {
        const base = publicBase(req);
        res.setHeader('Set-Cookie', `kakao_oauth_state=; HttpOnly; SameSite=Lax; Path=/api/auth/kakao; Max-Age=0${base.startsWith('https:') ? '; Secure' : ''}`);
        const finishHtml = target => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${target}"><script>location.replace(${JSON.stringify(target)})</script>`);
        };
        const { clientId, clientSecret } = clients.kakaoOAuth();
        const code = url.searchParams.get('code') || '';
        const returnedState = url.searchParams.get('state') || '';
        const expectedState = /(?:^|;\s*)kakao_oauth_state=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie || '')?.[1] || '';
        if (!clientId || !code || !expectedState || !/^[a-f0-9]{48}$/.test(returnedState) || !timingSafeEqual(Buffer.from(returnedState), Buffer.from(expectedState))) {
          return finishHtml('/?oauth_error=state#auth');
        }
        try {
          const redirectUri = `${base}/api/auth/kakao/callback`;
          const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, code });
          if (clientSecret) form.set('client_secret', clientSecret);
          const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: form.toString(), signal: AbortSignal.timeout(10000) });
          const tokenJson = await tokenRes.json();
          if (!tokenRes.ok || !tokenJson.access_token) return finishHtml('/?oauth_error=token#auth');
          const meRes = await fetch('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: `Bearer ${tokenJson.access_token}` }, signal: AbortSignal.timeout(10000) });
          const meJson = await meRes.json();
          if (!meRes.ok || !meJson.id) return finishHtml('/?oauth_error=profile#auth');
          const kakaoAccount = meJson.kakao_account || {};
          await accounts.loginWithKakao({ kakaoId: String(meJson.id), name: kakaoAccount.profile?.nickname || meJson.properties?.nickname,
            email: kakaoAccount.email, emailVerified: kakaoAccount.is_email_valid === true && kakaoAccount.is_email_verified === true }, req, res);
          return finishHtml('/#account');
        } catch (err) {
          if (err.code === 'ACCOUNT_LINK_REQUIRED') return finishHtml('/?oauth_error=account#auth');
          return finishHtml('/?oauth_error=network#auth');
        }
      }
      if (route === '/api/account/searches' && req.method === 'GET') return json(res, 200, { searches: accounts.searches(req) });
      if (route === '/api/admin/overview' && req.method === 'GET') {
        admin(req);
        const oauth = clients.kakaoOAuth();
        return json(res, 200, { ...accounts.summary(), providers: clients.status(), kakao_channels: { oauth: Boolean(oauth.clientId), client_secret: Boolean(oauth.clientSecret), js_sdk: oauth.jsSdkConfigured, native_app: oauth.nativeConfigured, biz_auth: oauth.bizConfigured }, logs: clients.logs(), uptime: Math.floor(process.uptime()) });
      }
      if (route === '/api/meta' && req.method === 'GET') return json(res, 200, { industries: INDUSTRY_CODES, regions: REGIONS_TREE,
        kakao_js_key: clients.kakaoOAuth().jsKey || null,
        coverage: '선택용 지역 목록입니다. 전국 전체 행정구역 또는 공식 통계 확보 범위를 의미하지 않습니다.' });
      if (route === '/api/external/catalog' && req.method === 'GET') return json(res, 200, { providers: clients.status() });
      if (route === '/api/card-sales/datasets' && req.method === 'GET') return json(res, 200, cardSales.listDatasets({ keyword: url.searchParams.get('keyword') || '' }));
      if (route === '/api/admin/logs' && req.method === 'GET') { admin(req); return json(res, 200, { logs: clients.logs() }); }
      if (req.method !== 'POST') throw new ApiError('NOT_FOUND', 'API 경로를 확인하세요.', 404);
      const p = await readBody(req, route === '/api/admin/card-sales/import' ? 524288 : 65536);
      if (['/api/auth/register', '/api/auth/login'].includes(route)) {
        for (const [k, v] of authLimits) if (now > v.until) authLimits.delete(k);
        const attempts = authLimits.get(ip) || { count: 0, until: now + 900000 };
        authLimits.set(ip, attempts);
        if (++attempts.count > 15) { res.setHeader('Retry-After', String(Math.max(1, Math.ceil((attempts.until - now) / 1000)))); throw new ApiError('RATE_LIMITED', '인증 요청이 많습니다. 15분 후 다시 시도하세요.', 429); }
        return json(res, route.endsWith('register') ? 201 : 200, await accounts[route.endsWith('register') ? 'register' : 'login'](p, req, res));
      }
      if (route === '/api/auth/logout') return json(res, 200, accounts.logout(req, res));
      if (route === '/api/account/searches') return json(res, 200, accounts.save(req, p));
      if (route === '/api/account/searches/delete') return json(res, 200, accounts.remove(req, p));
      if (route === '/api/admin/check') {
        admin(req);
        const checks = { semas: () => clients.semas({ cx: 127.0334, cy: 37.5006, radius: 300, numOfRows: 1 }), kakao: () => clients.kakao({ query: '강남역' }), kosis: () => clients.kosis(), region: () => clients.kosis({}, 'region'), nts: () => p.bizNo ? clients.nts({ bizNo: p.bizNo }) : Promise.reject(new ApiError('INPUT_REQUIRED', '사업자번호 입력 후 검사할 수 있습니다.')) };
        const results = await Promise.all(Object.entries(checks).map(async ([id, check]) => { try { const r = await check(); return { id, status: r.mode, message: r.mode === 'STALE' ? '갱신 실패 · 이전 실제 응답 캐시' : '실제 응답 확인', collected_at: r.collected_at }; } catch (err) { return { id, status: err.code || 'ERROR', message: err instanceof ApiError ? err.message : '연결 확인 실패' }; } }));
        return json(res, 200, { results });
      }
      if (route === '/api/recommend') {
        return json(res, 200, { mode: 'LIVE', candidates: [], message: '비교 가능한 실데이터가 적재되기 전에는 추천 점수를 산출하지 않습니다. 상권 탐색에서 점포와 공식 통계를 조회하세요.' });
      }
      if (route === '/api/external/keys') { admin(req); return json(res, 200, clients.configure(p)); }
      if (route === '/api/nts/verify') { admin(req); return json(res, 200, await clients.nts(p)); }
      if (route === '/api/external/semas') return json(res, 200, await clients.semas(p));
      if (route === '/api/external/kakao') return json(res, 200, await clients.kakao(p));
      if (route === '/api/external/kosis') return json(res, 200, await clients.kosis(p));
      if (route === '/api/external/region') return json(res, 200, await clients.kosis(p, 'region'));
      if (route === '/api/external/kosis/list') return json(res, 200, await clients.kosisList(p));
      if (route === '/api/card-sales/kosis') return json(res, 200, await cardSales.kosisCard(p));
      if (route === '/api/card-sales/seoul') return json(res, 200, await cardSales.seoulCard(p));
      if (route === '/api/admin/card-sales/import') { admin(req); return json(res, 200, cardSales.importDataset(p)); }
      if (route === '/api/admin/card-sales/clear') { admin(req); return json(res, 200, cardSales.clearDatasets()); }
      throw new ApiError('NOT_FOUND', 'API 경로를 확인하세요.', 404);
    }
    if (!['GET', 'HEAD'].includes(req.method)) throw new ApiError('METHOD_NOT_ALLOWED', '지원하지 않는 요청입니다.', 405);
    let relative;
    try { relative = route === '/' ? 'index.html' : decodeURIComponent(route).slice(1); }
    catch { throw new ApiError('INVALID_INPUT', '요청 주소의 인코딩을 확인하세요.'); }
    if (relative.includes('\0')) throw new ApiError('INVALID_INPUT', '요청 주소를 확인하세요.');
    const file = path.resolve(PUBLIC, relative);
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new ApiError('NOT_FOUND', '파일을 찾을 수 없습니다.', 404);
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch (err) {
    if (!res.headersSent) json(res, err instanceof ApiError ? err.status : 500, { code: err.code || 'INTERNAL_ERROR', error: err instanceof ApiError ? err.message : '서버 요청 처리에 실패했습니다.' });
    else res.destroy();
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;
if (require.main === module) {
  server.on('error', err => { console.error(`서버 시작 실패: ${err.code || 'UNKNOWN'}`); process.exitCode = 1; });
  server.listen(Number(process.env.PORT) || 3000, process.env.HOST || '127.0.0.1', () => console.log(`창업입지 AI 실행: http://localhost:${server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
module.exports = server;
