'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createConnectors, number } = require('../server/services/externalApiConnectors');
const { demoAnalysis } = require('../server/services/demoAnalysis');
const { INDUSTRY_CODES, REGIONS_TREE } = require('../server/data/publicDatasetStore');
const response = (obj, status = 200) => new Response(JSON.stringify(obj), { status });
const location = { cx: 127.03, cy: 37.5, radius: 500 };
test('missing keys never return synthetic stores, statistics or business status', async () => {
  const c = createConnectors({ env: {}, fetchImpl() { assert.fail('must not call external API'); } });
  for (const fn of [() => c.semas(location), () => c.nts({ bizNo: '1234567890' }), () => c.kosis(), () => c.kakao({ query: '강남역' })]) await assert.rejects(fn, { code: 'NOT_CONFIGURED' });
  assert(c.status().every(p => p.last_success_at === null && p.status === 'NOT_CONFIGURED'));
});
test('SEMAS request, pagination, missing fields and actual response cache', async () => {
  let calls = 0;
  const c = createConnectors({ env: { DATA_GO_KR_SERVICE_KEY: 'test%2Bkey%3D' }, fetchImpl: async url => {
    calls++; assert.equal(url.searchParams.get('serviceKey'), 'test+key='); assert.equal(url.searchParams.get('pageNo'), '2');
    return response({ header: { resultCode: '00' }, body: { totalCount: 150, stdrYm: '202610', items: [{ bizesId: 'S1', bizesNm: '실제응답 테스트', lat: '', lon: '127.03' }] } });
  } });
  const result = await c.semas({ ...location, pageNo: 2 });
  assert.equal(result.items[0].lat, null); assert.equal(result.items[0].industry_code, null);
  assert.equal(result.total_count, 150); assert.equal(result.mode, 'LIVE');
  assert.equal((await c.semas({ ...location, pageNo: 2 })).mode, 'CACHED'); assert.equal(calls, 1);
  assert.equal(c.logs()[0].records_upserted, 0);
  assert(!JSON.stringify(c.status()).includes('test%2Bkey'));
});
test('HTTP 200 provider errors and XML errors never turn into success', async () => {
  const c = createConnectors({ env: { DATA_GO_KR_SERVICE_KEY: 'secret' }, fetchImpl: async () => response({ header: { resultCode: '30', resultMsg: 'secret' }, body: { items: [] } }) });
  await assert.rejects(() => c.semas(location), { code: 'PROVIDER_REJECTED' });
  const xml = createConnectors({ env: { DATA_GO_KR_SERVICE_KEY: 'secret' }, fetchImpl: async () => new Response('<error>secret</error>') });
  await assert.rejects(() => xml.semas(location), { code: 'INVALID_RESPONSE' });
  assert(!JSON.stringify(c.logs()).includes('secret'));
});
test('outage fallback is only a previously collected real response with unchanged timestamp', async () => {
  const originalNow = Date.now;
  let fail = false;
  const c = createConnectors({ env: { DATA_GO_KR_SERVICE_KEY: 'key' }, fetchImpl: async () => {
    if (fail) throw new Error('secret-url-with-key');
    return response({ header: { resultCode: '00' }, body: { items: [], totalCount: 0 } });
  } });
  const first = await c.semas(location);
  fail = true;
  try {
    Date.now = () => originalNow() + 600000;
    const stale = await c.semas(location);
    assert.equal(stale.mode, 'STALE'); assert.equal(stale.collected_at, first.collected_at);
    assert(!JSON.stringify(stale).includes('secret-url'));
    Date.now = () => originalNow() + 90000000;
    await assert.rejects(() => c.semas(location), { code: 'UPSTREAM_UNAVAILABLE' });
  } finally { Date.now = originalNow; }
});
test('KOSIS preserves suppressed values, units, classifications and time', async () => {
  const c = createConnectors({ env: { KOSIS_API_KEY: 'key' }, fetchImpl: async url => {
    assert.equal(url.searchParams.get('objL2'), 'B');
    return response([{ TBL_ID: 'T', TBL_NM: '테스트 통계표', PRD_DE: '2024', DT: '-', UNIT_NM: '%', C1: 'A', C1_NM: '전국', C2: 'B', C2_NM: '산업', ITM_NM: '3년 생존율' }]);
  } });
  const r = await c.kosis({ orgId: '101', tblId: 'T', objL1: 'A', objL2: 'B', itmId: 'I', prdSe: 'Y' });
  assert.equal(r.records[0].value, null); assert.equal(r.records[0].period, '2024'); assert.equal(r.records[0].classifications.length, 2);
  assert.equal(number('1,234'), 1234); assert.equal(number('...'), null); assert.equal(number(''), null);
});
test('Kakao supports address, keyword and region operations without made-up matches', async () => {
  let target;
  const c = createConnectors({ env: { KAKAO_REST_API_KEY: 'rest-key' }, fetchImpl: async (url, opts) => {
    target = url.pathname; assert.equal(opts.headers.Authorization, 'KakaoAK rest-key'); return response({ documents: [], meta: { total_count: 0 } });
  } });
  assert.deepEqual((await c.kakao({ query: '없는 주소', action: 'address' })).documents, []); assert(target.endsWith('/address.json'));
  await c.kakao({ x: 127, y: 37, action: 'region' }); assert(target.endsWith('/coord2regioncode.json'));
  await assert.rejects(() => c.kakao({ action: 'region', x: 'NaN', y: 37 }), { code: 'INVALID_INPUT' });
});
test('NTS masks identifiers, supports validation and has no persistent cache', async () => {
  let calls = 0;
  const c = createConnectors({ env: { NTS_SERVICE_KEY: 'key' }, fetchImpl: async (url, opts) => {
    calls++; const body = JSON.parse(opts.body); assert(body.b_no || body.businesses);
    return response({ status_code: 'OK', data: [{ b_no: '1234567890', b_stt: '계속사업자', end_dt: '' }] });
  } });
  const r = await c.nts({ bizNo: '123-45-67890' });
  assert.equal(r.items[0].closed_on, null); assert(!JSON.stringify(r).includes('1234567890'));
  await c.nts({ bizNo: '1234567890' }); assert.equal(calls, 2);
  await c.nts({ action: 'validate', businesses: [{ b_no: '1234567890', start_dt: '20200101', p_nm: '테스트' }] });
  assert(!JSON.stringify(c.logs()).includes('1234567890'));
});
test('all industries and listed regional choices produce explicitly labeled demo results', () => {
  for (const i of INDUSTRY_CODES) {
    const r = demoAnalysis({ industry: i.industry_code, sido: '서울특별시', sigungu: '강남구' });
    assert.equal(r.mode, 'DEMO'); assert(r.candidates.length); assert(r.candidates.every(c => c.quality === 'DEMO' && c.observed_at === null));
  }
  for (const s of REGIONS_TREE) {
    const r = demoAnalysis({ industry: 'IND_CAFE', sido: s.sido_name, sigungu: s.sigungu_list[0].sigungu_name });
    assert(r.candidates.every(c => Number.isFinite(c.score)));
  }
  assert.throws(() => demoAnalysis({ industry: 'INVALID', sido: '서울특별시', sigungu: '강남구' }));
});
test('server rejects unauthenticated credential changes and invalid API input', async () => {
  process.env.ADMIN_API_TOKEN = 'integration-test-admin-token-123456';
  const server = require('../server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/api/external/keys', { KOSIS_API_KEY: 'secret' })).status, 401);
    assert.equal((await post('/api/external/keys', { KOSIS_API_KEY: 'secret' }, { Authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` })).status, 200);
    const health = await (await fetch(base + '/api/health')).json(); assert(!JSON.stringify(health).includes('secret'));
    const live = await (await post('/api/recommend', {})).json(); assert.equal(live.mode, 'LIVE'); assert.deepEqual(live.candidates, []);
    assert.equal((await fetch(base + '/api/not-found')).status, 404);
    assert.equal((await post('/api/external/semas', { cx: 0, cy: 0 })).status, 400);
    assert.equal((await post('/api/external/keys', {}, { Origin: 'https://evil.example' })).status, 403);
    const invalid = await fetch(base + '/api/external/semas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }); assert.equal(invalid.status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
