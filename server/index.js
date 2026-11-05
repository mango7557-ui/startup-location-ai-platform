'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { timingSafeEqual } = require('node:crypto');
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const { clients, ApiError } = require('./services/externalApiConnectors');
const { INDUSTRY_CODES, REGIONS_TREE } = require('./data/publicDatasetStore');
const { demoAnalysis } = require('./services/demoAnalysis');
const PUBLIC = path.join(__dirname, '..', 'public');
const limits = new Map();
function json(res, code, value) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
async function readBody(req) {
  if (!String(req.headers['content-type']).includes('application/json')) throw new ApiError('INVALID_INPUT', 'JSON 형식으로 요청하세요.', 415);
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 65536) throw new ApiError('PAYLOAD_TOO_LARGE', '요청 크기를 줄여 주세요.', 413); }
  try { const value = JSON.parse(raw || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new ApiError('INVALID_JSON', 'JSON 형식이 올바르지 않습니다.'); }
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
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname;
    if (route.startsWith('/api/')) {
      const now = Date.now(), ip = req.socket.remoteAddress;
      for (const [k, v] of limits) if (now > v.until) limits.delete(k);
      const limit = limits.get(ip) || { count: 0, until: now + 60000 };
      limits.set(ip, limit);
      if (++limit.count > 120) throw new ApiError('RATE_LIMITED', '잠시 후 다시 시도하세요.', 429);
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) throw new ApiError('ORIGIN_DENIED', '동일 출처에서 요청하세요.', 403);
      if (route === '/api/health' && req.method === 'GET') return json(res, 200, { status: 'OK', mode: 'SERVER', providers: clients.status() });
      if (route === '/api/meta' && req.method === 'GET') return json(res, 200, { industries: INDUSTRY_CODES, regions: REGIONS_TREE,
        coverage: '선택용 지역 목록입니다. 전국 전체 행정구역 또는 공식 통계 확보 범위를 의미하지 않습니다.' });
      if (route === '/api/external/catalog' && req.method === 'GET') return json(res, 200, { providers: clients.status() });
      if (route === '/api/admin/logs' && req.method === 'GET') { admin(req); return json(res, 200, { logs: clients.logs() }); }
      if (req.method !== 'POST') throw new ApiError('NOT_FOUND', 'API 경로를 확인하세요.', 404);
      const p = await readBody(req);
      if (route === '/api/recommend') {
        if (p.mode !== 'DEMO') return json(res, 200, { mode: 'LIVE', candidates: [], message: '비교 가능한 실데이터가 적재되기 전에는 추천 점수를 산출하지 않습니다. 실데이터 탐색에서 점포와 공식 통계를 조회하세요.' });
        try { return json(res, 200, demoAnalysis(p)); } catch { throw new ApiError('INVALID_INPUT', '업종·지역·가중치 조건을 확인하세요.'); }
      }
      if (route === '/api/external/keys') { admin(req); return json(res, 200, clients.configure(p)); }
      if (route === '/api/nts/verify') { admin(req); return json(res, 200, await clients.nts(p)); }
      if (route === '/api/external/semas') return json(res, 200, await clients.semas(p));
      if (route === '/api/external/kakao') return json(res, 200, await clients.kakao(p));
      if (route === '/api/external/kosis') return json(res, 200, await clients.kosis(p));
      if (route === '/api/external/region') return json(res, 200, await clients.kosis(p, 'region'));
      if (route === '/api/external/kosis/list') return json(res, 200, await clients.kosisList(p));
      throw new ApiError('NOT_FOUND', 'API 경로를 확인하세요.', 404);
    }
    if (!['GET', 'HEAD'].includes(req.method)) throw new ApiError('METHOD_NOT_ALLOWED', '지원하지 않는 요청입니다.', 405);
    const relative = route === '/' ? 'index.html' : decodeURIComponent(route).slice(1);
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
