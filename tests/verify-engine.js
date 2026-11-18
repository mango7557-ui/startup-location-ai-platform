'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createConnectors, number, limitedResponseText } = require('../server/services/externalApiConnectors');
const { createCardSalesService } = require('../server/services/cardSalesService');
const { createAccounts } = require('../server/services/accounts');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
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
test('SEMAS no-data responses are successful empty results for radius and region searches', async () => {
  const queries = [location, { divId: 'adongCd', key: '1168064000' }];
  const operations = ['storeListInRadius', 'storeListInDong'];
  for (const [index, query] of queries.entries()) {
    let calls = 0;
    const c = createConnectors({ env: { DATA_GO_KR_SERVICE_KEY: 'test-key' }, fetchImpl: async url => {
      calls++;
      assert(url.pathname.endsWith('/' + operations[index]));
      const payload = { header: { resultCode: '03', resultMsg: 'NODATA_ERROR' } };
      return response(index === 0 ? payload : { response: payload });
    } });
    const empty = await c.semas(query);
    assert.equal(empty.mode, 'LIVE');
    assert.equal(empty.total_count, 0);
    assert.deepEqual(empty.items, []);
    assert.equal(empty.page, 1);
    assert.equal(empty.page_size, 100);
    assert.equal(c.status().find(p => p.id === 'semas').status, 'CONNECTED');
    assert.equal(c.logs()[0].status, 'SUCCESS');
    assert.equal(c.logs()[0].records_fetched, 0);
    const cached = await c.semas(query);
    assert.equal(cached.mode, 'CACHED');
    assert.equal(cached.collected_at, empty.collected_at);
    assert.equal(calls, 1);
  }
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

test('an unwritable disk cache does not discard a successful live response', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'location-cache-test-'));
  const blocked = path.join(dir, 'not-a-directory');
  fs.writeFileSync(blocked, 'test');
  try {
    const c = createConnectors({ env: { DATA_GO_KR_SERVICE_KEY: 'key' }, cacheDir: blocked,
      fetchImpl: async () => response({ header: { resultCode: '00' }, body: { items: [], totalCount: 0 } }) });
    assert.equal((await c.semas(location)).mode, 'LIVE');
    assert.equal(c.status().find(p => p.id === 'semas').status, 'CONNECTED');
    assert.equal((await c.semas(location)).mode, 'CACHED');
    assert(c.logs().some(l => l.status === 'CACHE_WRITE_FAILED'));
  } finally { fs.unlinkSync(blocked); fs.rmdirSync(dir); }
});

test('upstream response bodies are bounded before the whole stream is buffered', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(16)); }, cancel() { cancelled = true; } });
  await assert.rejects(() => limitedResponseText(new Response(stream), 20), { code: 'RESPONSE_TOO_LARGE' });
  assert.equal(cancelled, true);
});

test('Kakao cannot link a password account by email alone or trust an unverified email', async () => {
  const accounts = createAccounts(':memory:');
  const req = { headers: {}, socket: {} };
  const res = { cookies: null, getHeader() { return this.cookies; }, setHeader(_, value) { this.cookies = value; } };
  try {
    const original = await accounts.register({ name: '기존 회원', email: 'owner@example.com', password: 'strong-password-123', consent: true }, req, res);
    await assert.rejects(() => accounts.loginWithKakao({ kakaoId: '12345678', name: '카카오 회원', email: 'owner@example.com', emailVerified: true }, req, res), { code: 'ACCOUNT_LINK_REQUIRED' });
    assert.equal(accounts.summary().count, 1);
    const unverified = await accounts.loginWithKakao({ kakaoId: '87654321', name: '카카오 회원', email: 'owner@example.com' }, req, res);
    assert.notEqual(unverified.user.id, original.user.id);
    assert.notEqual(unverified.user.email, 'owner@example.com');
    assert.equal((await accounts.loginWithKakao({ kakaoId: '87654321', name: '새 이름' }, req, res)).user.id, unverified.user.id);
  } finally { accounts.close(); }
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
  assert.equal(svc.importDataset({ csv: '지역,상권명,업종,매출금액\n서울,"상권\n이름",카페,"1,000"' }).inserted, 1);
  assert.equal(svc.listDatasets({ keyword: '상권\n이름' }).items[0].sales_amount, 1000);
  assert.throws(() => svc.importDataset({ csv: '지역,업종,매출금액\n' + Array(2001).fill('서울,카페,100').join('\n') }), { code: 'INVALID_INPUT' });
  assert.throws(() => svc.importDataset({ rows: [null] }), { code: 'INVALID_INPUT' });
  assert.equal(svc.listDatasets().total_count, 2);
  assert.equal(svc.importDataset({ csv: '지역,업종,매출건수,매출금액\n서울,카페,7,70000' }).inserted, 1);
  assert(svc.listDatasets().items.some(r => r.sales_amount === 70000 && r.sales_count === 7));
  assert.throws(() => svc.importDataset({ rows: [{ region: '서울', industry: '카페', sales_amount: '100' }, { sales_amount: '잘못된 값' }] }), { code: 'INVALID_INPUT' });
  assert.equal(svc.listDatasets().total_count, 3, 'An invalid row rolls back the entire import instead of silently losing rows');
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
  process.env.TRUST_PROXY = '';
  process.env.PUBLIC_BASE_URL = '';
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
    assert.equal((await fetch(base + '/.env')).status, 404);
    assert.equal((await fetch(base + '/.runtime/accounts.sqlite')).status, 404);
    assert.equal((await fetch(base + '/%ZZ')).status, 400);
    assert.equal((await post('/api/external/semas', { cx: 0, cy: 0 })).status, 400);
    assert.equal((await post('/api/external/keys', {}, { Origin: 'https://evil.example' })).status, 403);
    const invalid = await fetch(base + '/api/external/semas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }); assert.equal(invalid.status, 400);
    const oversized = await post('/api/recommend', { large: 'x'.repeat(66000) }); assert.equal(oversized.status, 413);
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
    const splitBody = Buffer.from(JSON.stringify({ title: '한글 조각 전송', data: { industry: 'IND_CAFE' } }));
    const splitAt = splitBody.indexOf(Buffer.from('한')) + 1;
    const splitResult = await new Promise((resolve, reject) => {
      const request = http.request(base + '/api/account/searches', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie } }, response => {
        let body = ''; response.setEncoding('utf8'); response.on('data', c => body += c); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
      });
      request.on('error', reject); request.write(splitBody.subarray(0, splitAt));
      setTimeout(() => request.end(splitBody.subarray(splitAt)), 15);
    });
    assert.equal(splitResult.status, 200);
    assert(splitResult.body.searches.some(s => s.title === '한글 조각 전송'));
    const other = await post('/api/auth/register', { ...account, email: 'other@example.com' });
    const otherCookie = other.headers.get('set-cookie').split(';')[0];
    assert.deepEqual((await (await post('/api/account/searches/delete', { id: savedId }, { Cookie: otherCookie })).json()).searches, []);
    assert.equal((await (await fetch(base + '/api/account/searches', { headers: { Cookie: cookie } })).json()).searches.length, 2);
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
    const unicodeState = await fetch(base + '/api/auth/kakao/callback?code=abc&state=' + encodeURIComponent('한'.repeat(48)), { headers: { Cookie: 'kakao_oauth_state=' + 'a'.repeat(48) } });
    assert.equal(unicodeState.status, 200); assert.match(await unicodeState.text(), /oauth_error=state/);
    const spoofed = await fetch(base + '/api/auth/kakao/start', { redirect: 'manual', headers: { 'X-Forwarded-Proto': 'https' } });
    assert.equal(new URL(spoofed.headers.get('location')).searchParams.get('redirect_uri'), base + '/api/auth/kakao/callback');
    process.env.TRUST_PROXY = 'loopback';
    process.env.PUBLIC_BASE_URL = 'https://site.example.com';
    const pinned = await fetch(base + '/api/auth/kakao/start', { redirect: 'manual', headers: { Host: 'attacker.example.com', 'X-Forwarded-Proto': 'https' } });
    assert.equal(new URL(pinned.headers.get('location')).searchParams.get('redirect_uri'), 'https://site.example.com/api/auth/kakao/callback');
    assert.match(pinned.headers.get('set-cookie'), /; Secure/);
    const secureLogin = await post('/api/auth/login', account, { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '198.51.100.7', Origin: 'https://site.example.com' });
    assert.equal(secureLogin.status, 200); assert.match(secureLogin.headers.get('set-cookie'), /; Secure/);
    for (let n = 0; n < 120; n++) await fetch(base + '/api/health', { headers: { 'X-Forwarded-For': '198.51.100.8' } });
    const blocked = await fetch(base + '/api/health', { headers: { 'X-Forwarded-For': '198.51.100.8' } });
    assert.equal(blocked.status, 429); assert(Number(blocked.headers.get('retry-after')) > 0);
    assert.equal((await fetch(base + '/api/health', { headers: { 'X-Forwarded-For': '198.51.100.9' } })).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
