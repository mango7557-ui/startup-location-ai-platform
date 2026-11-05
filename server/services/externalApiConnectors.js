'use strict';
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const CATALOG = [
  { id: 'semas', name: '상가·상권정보', provider: '소상공인시장진흥공단', env: 'DATA_GO_KR_SERVICE_KEY', url: 'https://www.data.go.kr/data/15012005/openapi.do', description: '반경·행정구역별 점포, 업종, 주소와 좌표' },
  { id: 'nts', name: '사업자등록 상태', provider: '국세청', env: 'NTS_SERVICE_KEY', url: 'https://www.data.go.kr/data/15081808/openapi.do', description: '입력한 사업자번호의 현재 상태·진위 확인' },
  { id: 'kosis', name: '기업생멸 통계', provider: 'KOSIS 국가통계포털', env: 'KOSIS_API_KEY', url: 'https://kosis.kr/openapi/index/index.jsp', description: '선택한 통계표의 원래 분류·단위·시점을 보존' },
  { id: 'region', name: '지역 인구·수요', provider: 'KOSIS / 공공데이터포털', env: 'KOSIS_API_KEY', url: 'https://www.data.go.kr/', description: '별도로 지정한 KOSIS 지역 통계표 조회' },
  { id: 'kakao', name: '주소·장소 검색', provider: 'Kakao Local', env: 'KAKAO_REST_API_KEY', url: 'https://developers.kakao.com/', description: '장소 검색, 주소 및 좌표 → 행정구역 변환' }
];
class ApiError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
function number(value) {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(n) ? n : null;
}
function bounded(value, min, max, name, fallback) {
  const n = value == null ? fallback : number(value);
  if (n == null || n < min || n > max) throw new ApiError('INVALID_INPUT', `${name}: ${min}~${max} 범위로 입력하세요.`);
  return n;
}
function text(value, name, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApiError('INVALID_INPUT', `${name}을 확인하세요.`);
  return value.trim();
}
function keyValue(value) { return value && !/^(YOUR_|dev-admin)/i.test(value) ? value.trim() : ''; }
function decodedKey(value) { try { return decodeURIComponent(value); } catch { throw new ApiError('INVALID_CONFIG', '인증키 인코딩을 확인하세요.', 503); } }
function rowsFrom(json) {
  const root = json.response || json;
  const code = root.header?.resultCode ?? root.resultCode;
  if (code != null && !['00', '0', 'NORMAL_SERVICE'].includes(String(code))) throw new ApiError('PROVIDER_REJECTED', '제공기관이 요청을 거부했습니다. 인증키·활용 승인·요청 조건을 확인하세요.', 502);
  const body = root.body || root;
  const items = body.items?.item ?? body.items;
  if (items === '' || items === null) return { body, rows: [] };
  if (Array.isArray(items)) return { body, rows: items };
  if (items && typeof items === 'object') return { body, rows: [items] };
  throw new ApiError('INVALID_RESPONSE', '제공기관의 응답 구조를 확인할 수 없습니다.', 502);
}

// Credentials and outbound requests stay on the server. No synthetic API fallbacks.
function createConnectors({ env = process.env, fetchImpl = (...args) => fetch(...args), cacheDir = null, timeout = 10000 } = {}) {
  const logs = [], states = {}, cache = new Map();
  const allowedKeys = ['DATA_GO_KR_SERVICE_KEY', 'NTS_SERVICE_KEY', 'KOSIS_API_KEY', 'KAKAO_REST_API_KEY'];
  const keys = Object.fromEntries(allowedKeys.map(k => [k, keyValue(env[k])]));
  function credential(id) {
    const entry = CATALOG.find(p => p.id === id);
    return keys[entry.env] || (id === 'nts' ? keys.DATA_GO_KR_SERVICE_KEY : '');
  }
  function profile(id) {
    const raw = env[id === 'region' ? 'KOSIS_REGION_QUERY' : 'KOSIS_SURVIVAL_QUERY'];
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  function status() {
    return CATALOG.map(p => ({ ...p, configured: Boolean(credential(p.id)),
      status: !credential(p.id) ? 'NOT_CONFIGURED' : states[p.id]?.status || ((['kosis', 'region'].includes(p.id) && !profile(p.id)) ? 'NEEDS_TABLE' : 'READY'),
      last_success_at: states[p.id]?.last_success_at || null, last_error: states[p.id]?.last_error || null }));
  }
  function configure(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError('INVALID_INPUT', '설정 객체가 필요합니다.');
    for (const [k, value] of Object.entries(input)) {
      if (!allowedKeys.includes(k) || typeof value !== 'string' || value.length > 1024) throw new ApiError('INVALID_INPUT', '지원하지 않는 인증키 설정입니다.');
    }
    for (const [k, value] of Object.entries(input)) keys[k] = keyValue(value);
    for (const k of Object.keys(states)) delete states[k];
    cache.clear();
    return { providers: status(), persistence: 'MEMORY_ONLY', message: '서버 메모리에 적용했습니다. 영구 설정은 서버 환경변수를 사용하세요.' };
  }
  function log(id, started, result, count = 0) {
    logs.unshift({ id: `${Date.now()}-${logs.length}`, provider: id, status: result, records_fetched: count, records_upserted: 0,
      started_at: started, finished_at: new Date().toISOString() });
    if (logs.length > 100) logs.pop();
  }
  async function request(id, endpoint, params, { body, normalize, cacheable = true } = {}) {
    const key = credential(id);
    if (!key) throw new ApiError('NOT_CONFIGURED', `${CATALOG.find(p => p.id === id).name}: 서버 인증키가 필요합니다.`, 503);
    const url = new URL(endpoint);
    for (const [k, value] of Object.entries(params || {})) if (value != null && value !== '') url.searchParams.set(k, String(value));
    const fingerprint = createHash('sha256').update(`${id}:${url}:${JSON.stringify(body)}:${key}`).digest('hex');
    const file = cacheDir && path.join(cacheDir, `${fingerprint}.json`);
    let previous = cache.get(fingerprint);
    if (cacheable && !previous && file) {
      try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); if (data.mode === 'LIVE' && data.collected_at) previous = data; } catch { /* No prior real response */ }
    }
    if (cacheable && previous && Date.now() - Date.parse(previous.collected_at) < 300000) return { ...previous, mode: 'CACHED' };
    const headers = { Accept: 'application/json' };
    if (id === 'kakao') headers.Authorization = `KakaoAK ${key}`;
    else url.searchParams.set(['kosis', 'region'].includes(id) ? 'apiKey' : 'serviceKey', decodedKey(key));
    if (body) headers['Content-Type'] = 'application/json';
    const started = new Date().toISOString();
    try {
      const res = await fetchImpl(url, { method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw new ApiError(res.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_REJECTED', `제공기관 응답 오류 (${res.status}). 활용 승인·호출 한도를 확인하세요.`, 502);
      const raw = await res.text();
      if (raw.length > 8000000) throw new ApiError('RESPONSE_TOO_LARGE', '조회 범위를 줄여 주세요.', 502);
      let json;
      try { json = JSON.parse(raw); } catch { throw new ApiError('INVALID_RESPONSE', '제공기관이 JSON 대신 오류 또는 XML 응답을 반환했습니다.', 502); }
      if (json?.err || json?.error || json?.status_code && json.status_code !== 'OK') throw new ApiError('PROVIDER_REJECTED', '제공기관 오류: 인증·통계표·분류 조건을 확인하세요.', 502);
      const data = normalize(json);
      const result = { ...data, provider: id, mode: 'LIVE', collected_at: new Date().toISOString(), source_url: CATALOG.find(p => p.id === id).url };
      states[id] = { status: 'CONNECTED', last_success_at: result.collected_at, last_error: null };
      log(id, started, 'SUCCESS', data.items?.length ?? data.records?.length ?? data.documents?.length ?? 0);
      if (cacheable) {
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        cache.set(fingerprint, result);
        if (file) { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(result)); }
      }
      return result;
    } catch (err) {
      const safe = err instanceof ApiError ? err : new ApiError('UPSTREAM_UNAVAILABLE', '외부 API에 연결할 수 없습니다. 잠시 후 다시 시도하세요.', 502);
      states[id] = { ...states[id], status: 'ERROR', last_error: safe.code };
      log(id, started, safe.code);
      if (cacheable && previous && Date.now() - Date.parse(previous.collected_at) <= 86400000) return { ...previous, mode: 'STALE', warning: safe.message };
      throw safe;
    }
  }
  async function semas(p = {}) {
    const pageNo = bounded(p.pageNo, 1, 10000, '페이지', 1);
    const numOfRows = bounded(p.numOfRows, 1, 1000, '조회 건수', 100);
    if (!Number.isInteger(pageNo) || !Number.isInteger(numOfRows)) throw new ApiError('INVALID_INPUT', '페이지와 건수는 정수여야 합니다.');
    const params = { pageNo, numOfRows, type: 'json' };
    let operation = 'storeListInRadius';
    if (p.divId) {
      if (!['ctprvnCd', 'signguCd', 'adongCd'].includes(p.divId)) throw new ApiError('INVALID_INPUT', '지역 코드 종류를 확인하세요.');
      if (!/^\d{2,10}$/.test(p.key || '')) throw new ApiError('INVALID_INPUT', '공식 지역 코드를 입력하세요.');
      Object.assign(params, { divId: p.divId, key: p.key }); operation = 'storeListInDong';
    } else Object.assign(params, { cx: bounded(p.cx, 124, 132, '경도'), cy: bounded(p.cy, 33, 39, '위도'), radius: bounded(p.radius, 1, 2000, '반경', 500) });
    if (p.indsSclsCd) {
      if (!/^[A-Z]\d{5}$/.test(p.indsSclsCd)) throw new ApiError('INVALID_INPUT', '소분류 업종 코드를 확인하세요.');
      params.indsSclsCd = p.indsSclsCd;
    }
    return request('semas', `https://apis.data.go.kr/B553077/api/open/sdsc2/${operation}`, params, { normalize(json) {
      const { body, rows } = rowsFrom(json);
      return { total_count: number(body.totalCount), page: pageNo, page_size: numOfRows, observation_period: body.stdrYm || json.header?.stdrYm || null,
        items: rows.map(r => ({ store_id: r.bizesId, store_name: r.bizesNm, branch_name: r.brchNm || null, industry_code: r.indsSclsCd || null,
          industry_name: r.indsSclsNm || null, address: r.rdnmAdr || r.lnoAdr || null, region_code: r.adongCd || null,
          lat: number(r.lat), lng: number(r.lon), floor: r.flrNo || null, observation_period: r.stdrYm || body.stdrYm || null })) };
    } });
  }
  async function nts(p = {}) {
    const action = p.action || 'status';
    if (!['status', 'validate'].includes(action)) throw new ApiError('INVALID_INPUT', '국세청 조회 종류를 확인하세요.');
    let body;
    if (action === 'status') {
      const values = p.numbers || [p.bizNo];
      if (!Array.isArray(values) || !values.length || values.length > 100) throw new ApiError('INVALID_INPUT', '사업자번호는 1~100개까지 조회할 수 있습니다.');
      const numbers = values.map(v => String(v || '').replaceAll('-', '').trim());
      if (numbers.some(n => !/^\d{10}$/.test(n))) throw new ApiError('INVALID_INPUT', '사업자번호는 숫자 10자리여야 합니다.');
      body = { b_no: numbers };
    } else {
      if (!Array.isArray(p.businesses) || !p.businesses.length || p.businesses.length > 100) throw new ApiError('INVALID_INPUT', '진위 확인 대상은 1~100건이어야 합니다.');
      body = { businesses: p.businesses.map(r => {
        if (!/^\d{10}$/.test(r.b_no) || !/^\d{8}$/.test(r.start_dt)) throw new ApiError('INVALID_INPUT', '사업자번호와 개업일자를 확인하세요.');
        return { b_no: r.b_no, start_dt: r.start_dt, p_nm: text(r.p_nm, '대표자명', 100) };
      }) };
    }
    return request('nts', `https://api.odcloud.kr/api/nts-businessman/v1/${action}`, {}, { body, cacheable: false, normalize(json) {
      if (!Array.isArray(json.data)) throw new ApiError('INVALID_RESPONSE', '국세청 응답을 확인할 수 없습니다.', 502);
      return { action, items: json.data.map(r => ({ number_masked: `${String(r.b_no).slice(0, 3)}-${String(r.b_no).slice(3, 5)}-*****`,
        status: r.b_stt || r.status?.b_stt || null, tax_type: r.tax_type || r.status?.tax_type || null,
        closed_on: r.end_dt || r.status?.end_dt || null, validity: r.valid || null })), notice: '현재 조회 결과입니다. 수집 이전의 과거 폐업 이력을 복원하지 않습니다.' };
    } });
  }
  async function kosis(p = {}, id = 'kosis') {
    const query = { ...(profile(id) || {}), ...p };
    if (!credential(id)) throw new ApiError('NOT_CONFIGURED', '서버에 KOSIS_API_KEY를 설정하세요.', 503);
    for (const field of ['orgId', 'tblId', 'objL1', 'itmId', 'prdSe']) text(query[field], field, 1000);
    const allowed = ['orgId', 'tblId', 'objL1', 'objL2', 'objL3', 'objL4', 'objL5', 'objL6', 'objL7', 'objL8', 'itmId', 'prdSe', 'startPrdDe', 'endPrdDe', 'newEstPrdCnt'];
    const params = { method: 'getList', format: 'json', jsonVD: 'Y' };
    for (const k of allowed) if (query[k] != null) params[k] = text(String(query[k]), k, 1000);
    if (!params.startPrdDe) params.newEstPrdCnt = params.newEstPrdCnt || '1';
    return request(id, 'https://kosis.kr/openapi/Param/statisticsParameterData.do', params, { normalize(json) {
      if (!Array.isArray(json)) throw new ApiError('INVALID_RESPONSE', 'KOSIS 통계표 응답을 확인할 수 없습니다.', 502);
      return { query: params, records: json.map(r => ({ table_id: r.TBL_ID, table_name: r.TBL_NM, period: r.PRD_DE, frequency: r.PRD_SE,
        item_code: r.ITM_ID, item_name: r.ITM_NM, unit: r.UNIT_NM || null, value: number(r.DT), raw_value: r.DT,
        classifications: Array.from({ length: 8 }, (_, i) => i + 1).filter(i => r[`C${i}`] != null).map(i => ({ code: r[`C${i}`], name: r[`C${i}_NM`], dimension: r[`C${i}_OBJ_NM`] })),
        last_changed: r.LST_CHN_DE || null })), notice: '원본 통계표의 범위입니다. 생존율을 특정 점포나 상권의 성공 확률로 환산하지 않습니다.' };
    } });
  }
  async function kosisList(p = {}) {
    return request('kosis', 'https://kosis.kr/openapi/statisticsList.do', { method: 'getList', format: 'json', jsonVD: 'Y', vwCd: 'MT_ZTITLE', parentListId: p.parentListId || '' }, { normalize(j) {
      if (!Array.isArray(j)) throw new ApiError('INVALID_RESPONSE', '통계목록 응답이 올바르지 않습니다.', 502);
      return { items: j };
    } });
  }
  async function kakao(p = {}) {
    const action = p.action || 'keyword';
    const paths = { keyword: 'search/keyword.json', address: 'search/address.json', region: 'geo/coord2regioncode.json' };
    if (!paths[action]) throw new ApiError('INVALID_INPUT', '검색 종류를 확인하세요.');
    const params = action === 'region' ? { x: bounded(p.x, 124, 132, '경도'), y: bounded(p.y, 33, 39, '위도') } : { query: text(p.query, '검색어'), page: bounded(p.page, 1, 45, '페이지', 1), size: 15 };
    if (action === 'keyword' && p.x != null) Object.assign(params, { x: bounded(p.x, 124, 132, '경도'), y: bounded(p.y, 33, 39, '위도'), radius: bounded(p.radius, 0, 20000, '반경', 2000) });
    return request('kakao', `https://dapi.kakao.com/v2/local/${paths[action]}`, params, { cacheable: false, normalize(j) {
      if (!Array.isArray(j.documents)) throw new ApiError('INVALID_RESPONSE', '카카오 응답을 확인할 수 없습니다.', 502);
      return { meta: j.meta, documents: j.documents.map(r => ({ name: r.place_name || r.address_name, address: r.road_address_name || r.road_address?.address_name || r.address_name,
        lat: number(r.y), lng: number(r.x), code: r.code || r.address?.h_code || null, region_type: r.region_type || null,
        category: r.category_name || null, place_url: r.place_url || null })) };
    } });
  }
  return { status, configure, semas, nts, kosis, kosisList, kakao, logs: () => logs, profile };
}
const clients = createConnectors({ cacheDir: path.join(__dirname, '..', '..', '.runtime', 'cache') });
module.exports = { CATALOG, ApiError, createConnectors, clients, number };
