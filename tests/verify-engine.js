'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createConnectors, number } = require('../server/services/externalApiConnectors');
const { createCardSalesService } = require('../server/services/cardSalesService');
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
test('KOSIS defaults can be configured atomically and remain separate per provider', async () => {
  const env = {};
  const c = createConnectors({ env, fetchImpl: async url => response([{ TBL_ID: url.searchParams.get('tblId'), DT: '42' }]) });
  assert.throws(() => c.configure({ KOSIS_API_KEY: 'never-apply', KOSIS_REGION_QUERY: '{invalid' }), { code: 'INVALID_INPUT' });
  assert(c.status().every(p => !p.configured));
  const profile = tblId => JSON.stringify({ orgId: '101', tblId, itmId: 'I', prdSe: 'Y', objL1: 'ALL' });
  c.configure({ KOSIS_API_KEY: 'test-key', KOSIS_SURVIVAL_QUERY: profile('SURVIVAL'), KOSIS_REGION_QUERY: profile('REGION') });
  assert.equal(c.status().find(p => p.id === 'kosis').status, 'READY');
  assert.equal((await c.kosis()).records[0].table_id, 'SURVIVAL');
  assert.equal((await c.kosis({}, 'region')).records[0].table_id, 'REGION');
  assert(!JSON.stringify(c.status()).includes('test-key'));
});
test('NTS masks identifiers, supports v1.1 validation and has no persistent cache', async () => {
  let calls = 0, lastBody = null, lastUrl = null;
  const c = createConnectors({ env: { NTS_SERVICE_KEY: 'key' }, fetchImpl: async (url, opts) => {
    calls++; lastUrl = url; lastBody = JSON.parse(opts.body); assert(lastBody.b_no || lastBody.businesses);
    return response({ status_code: 'OK', data: [{ b_no: '1234567890', b_stt: '계속사업자', tax_type: '부가가치세 일반과세자', rbf_tax_type: '부가가치세 간이과세자', rbf_tax_type_cd: '02', end_dt: '', valid: '01', valid_msg: '' }] });
  } });
  const r = await c.nts({ bizNo: '123-45-67890' });
  assert.equal(lastUrl.searchParams.get('returnType'), 'JSON');
  assert.equal(r.items[0].closed_on, null);
  assert.equal(r.items[0].prev_tax_type, '부가가치세 간이과세자');
  assert(!JSON.stringify(r).includes('1234567890'));
  await c.nts({ bizNo: '1234567890' }); assert.equal(calls, 2);
  await c.nts({ action: 'validate', bizNo: '123-45-67890', start_dt: '2020-01-01', p_nm: '테스트', b_adr: '서울특별시 강남구' });
  assert.equal(lastBody.businesses[0].b_adr, '서울특별시 강남구');
  assert.equal('p_nm2' in lastBody.businesses[0], false);
  await c.nts({ action: 'validate', businesses: [{ b_no: '1234567890', start_dt: '20200101', p_nm: 'JOHN DOE', p_nm2: '존도우' }] });
  assert.equal(lastBody.businesses[0].p_nm2, '존도우');
  assert(!JSON.stringify(c.logs()).includes('1234567890'));
});
test('upstream 403 diagnostics explain Kakao Map activation and SEMAS subscription without leaking keys', async () => {
  const kakaoC = createConnectors({ env: { KAKAO_REST_API_KEY: 'secret-kakao' }, fetchImpl: async () => new Response('{"errorType":"NotAuthorizedError","message":"App disabled OPEN_MAP_AND_LOCAL service."}', { status: 403 }) });
  await assert.rejects(() => kakaoC.kakao({ query: '강남역' }), err => err.code === 'PROVIDER_REJECTED' && err.message.includes('카카오맵') && !err.message.includes('secret-kakao'));
  const semasC = createConnectors({ env: { DATA_GO_KR_SERVICE_KEY: 'secret-semas' }, fetchImpl: async () => new Response('{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"SERVICE_KEY_IS_NOT_REGISTERED_ERROR"}}}', { status: 403 }) });
  await assert.rejects(() => semasC.semas(location), err => err.code === 'PROVIDER_REJECTED' && err.message.includes('15012005') && !err.message.includes('secret-semas'));
});
test('card sales service supports KOSIS presets, Seoul commercial district breakdown and CSV dataset import', async () => {
  const c = createConnectors({ env: { KOSIS_API_KEY: 'k-key' }, fetchImpl: async url => {
    assert.equal(url.searchParams.get('tblId'), 'DT_435001N_001');
    return response([{ TBL_ID: 'DT_435001N_001', TBL_NM: '월간 국내카드승인실적', PRD_DE: '202609', DT: '5411', UNIT_NM: '백억원', C1: 'G', C1_NM: '도매 및 소매업', ITM_ID: 'T001', ITM_NM: '승인금액' }]);
  } });
  const svc = createCardSalesService({
    connectors: c,
    env: {},
    dbFile: ':memory:',
    fetchImpl: async url => {
      assert.match(String(url), /\/sample\/json\/VwsmTrdarSelngQq\/1\/5/);
      return response({ VwsmTrdarSelngQq: { list_total_count: 481462, RESULT: { CODE: 'INFO-000' }, row: [{ STDR_YYQU_CD: '20243', TRDAR_SE_CD_NM: '골목상권', TRDAR_CD: '311', TRDAR_CD_NM: '역삼역상권', SVC_INDUTY_CD: 'CS100010', SVC_INDUTY_CD_NM: '커피-음료', THSMON_SELNG_AMT: 400000000, THSMON_SELNG_CO: 40000, TMZON_11_14_SELNG_AMT: 150000000, AGRDE_30_SELNG_AMT: 160000000, MON_SELNG_AMT: 60000000, ML_SELNG_AMT: 180000000, FML_SELNG_AMT: 220000000 }] } });
    }
  });
  const kr = await svc.kosisCard({ type: 'approval' });
  assert.equal(kr.records[0].value, 5411);
  await assert.rejects(() => svc.seoulCard({ useSample: false }), { code: 'NOT_CONFIGURED' });
  const sr = await svc.seoulCard({ useSample: true });
  assert.equal(sr.mode, 'SAMPLE_LIVE');
  assert.equal(sr.items[0].avg_ticket, 10000);
  assert.equal(sr.items[0].by_time['11~14시'], 150000000);
  const imp = svc.importDataset({ source: '경기데이터드림', csv: '지역,상권명,업종,기준년월,카드매출금액,승인건수\n경기도 성남시,판교역상권,커피전문점,202609,520000000,48000' });
  assert.equal(imp.inserted, 1);
  assert.equal(svc.listDatasets({ keyword: '판교' }).items[0].sales_amount, 520000000);
  svc.clearDatasets();
  assert.equal(svc.listDatasets().total_count, 0);
  svc.close();
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
  process.env.ACCOUNTS_DB = ':memory:';
  process.env.CARD_SALES_DB = ':memory:';
  process.env.DATA_GO_KR_SERVICE_KEY = '';
  process.env.NTS_SERVICE_KEY = '';
  process.env.KOSIS_API_KEY = '';
  process.env.KAKAO_REST_API_KEY = 'kakao-oauth-test-client';
  process.env.KAKAO_CLIENT_SECRET = 'kakao-oauth-test-secret';
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
    assert.equal((await fetch(base + '/api/admin/overview')).status, 401);
    assert.equal((await fetch(base + '/api/account/searches')).status, 401);
    const account = { name: '테스트 회원', email: 'person@example.com', password: 'a-strong-password-123', consent: true };
    assert.equal((await post('/api/auth/register', { ...account, consent: false })).status, 400);
    assert.equal((await post('/api/auth/register', { ...account, password: 'short' })).status, 400);
    const registered = await post('/api/auth/register', account);
    assert.equal(registered.status, 201);
    assert.match(registered.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    const cookie = registered.headers.get('set-cookie').split(';')[0];
    const user = await registered.json(); assert(!JSON.stringify(user).includes('hash')); assert(!JSON.stringify(user).includes(account.password));
    assert.equal((await post('/api/auth/register', account)).status, 409);
    assert.equal((await post('/api/auth/login', { ...account, password: 'wrong' })).status, 401);
    assert.equal((await post('/api/auth/login', account)).status, 200);
    const saved = await post('/api/account/searches', { title: '카페 조건', data: { industry: 'IND_CAFE', radius: 500 } }, { Cookie: cookie });
    assert.equal(saved.status, 200); const savedId = (await saved.json()).searches[0].id;
    const other = await post('/api/auth/register', { ...account, email: 'other@example.com' });
    const otherCookie = other.headers.get('set-cookie').split(';')[0];
    assert.deepEqual((await (await post('/api/account/searches/delete', { id: savedId }, { Cookie: otherCookie })).json()).searches, []);
    assert.equal((await (await fetch(base + '/api/account/searches', { headers: { Cookie: cookie } })).json()).searches.length, 1);
    assert.equal((await fetch(base + '/api/admin/overview', { headers: { Cookie: cookie } })).status, 401);
    const overview = await (await fetch(base + '/api/admin/overview', { headers: { Authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` } })).json();
    assert.equal(overview.count, 2); assert(!JSON.stringify(overview).includes(account.password));
    await post('/api/auth/logout', {}, { Cookie: cookie });
    assert.equal((await fetch(base + '/api/account/searches', { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await post('/api/external/keys', { KAKAO_REST_API_KEY: 'kakao-oauth-test-client', KAKAO_CLIENT_SECRET: 'kakao-oauth-test-secret' }, { Authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` })).status, 200);
    const oauthStart = await fetch(base + '/api/auth/kakao/start', { redirect: 'manual' });
    assert.equal(oauthStart.status, 302);
    assert.match(oauthStart.headers.get('location'), /^https:\/\/kauth\.kakao\.com\/oauth\/authorize\?/);
    assert.match(oauthStart.headers.get('set-cookie'), /kakao_oauth_state=[a-f0-9]{48}; HttpOnly/);
    const badCallback = await fetch(base + '/api/auth/kakao/callback?code=abc&state=mismatch');
    assert.equal(badCallback.status, 200);
    assert.match(await badCallback.text(), /oauth_error=state/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
