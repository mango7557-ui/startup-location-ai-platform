'use strict';
const { DatabaseSync } = require('node:sqlite');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ApiError, number, limitedResponseText } = require('./externalApiConnectors');

const KOSIS_CARD_TABLES = {
  approval: {
    orgId: '435',
    tblId: 'DT_435001N_001',
    objL1: 'ALL',
    itmId: 'ALL',
    prdSe: 'M',
    newEstPrdCnt: '6',
    provider_label: '(사)한국여신전문금융업협회 · KOSIS',
    description: '한국표준산업분류별 월간 국내 카드승인금액 실적'
  },
  sido_sales: {
    orgId: '142',
    tblId: 'DT_BR11_C001',
    objL1: 'ALL',
    objL2: 'ALL',
    objL3: '16142T2524',
    itmId: 'T001',
    prdSe: 'Y',
    newEstPrdCnt: '1',
    provider_label: '중소벤처기업부 기업생멸/소상공인 매출통계 · KOSIS',
    description: '전국 시·도 및 산업중분류별 소상공인 연간 매출액'
  },
  payment_share: {
    orgId: '142',
    tblId: 'DT_3ME0146',
    objL1: 'ALL',
    objL2: 'ALL',
    itmId: 'ALL',
    prdSe: 'Y',
    newEstPrdCnt: '1',
    provider_label: '중소벤처기업부 소상공인실태조사 · KOSIS',
    description: '시·도 및 산업중분류별 고객 결제방법(신용·체크카드/간편결제/현금) 구성비'
  }
};

function parseCsv(input) {
  const rows = [];
  let cells = [], cur = '', inQuotes = false;
  function finishRow() {
    cells.push(cur.trim());
    if (cells.some(Boolean)) rows.push(cells);
    if (rows.length > 2001) throw new ApiError('INVALID_INPUT', '1회 업로드 건수는 1~2,000건입니다. 파일을 나누어 업로드하세요.');
    cells = []; cur = '';
  }
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"' && input[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"' && !cur.trim()) inQuotes = true;
    else if (ch === ',') { cells.push(cur.trim()); cur = ''; }
    else if (ch === '\n' || ch === '\r') { finishRow(); if (ch === '\r' && input[i + 1] === '\n') i++; }
    else cur += ch;
  }
  if (inQuotes) throw new ApiError('INVALID_INPUT', 'CSV의 닫히지 않은 따옴표를 확인하세요.');
  finishRow();
  return rows;
}

function formatQuarter(code) {
  const s = String(code || '');
  return /^\d{5}$/.test(s) ? `${s.slice(0, 4)}년 ${s.slice(4)}분기` : (s || null);
}

function createCardSalesService({ connectors, env = process.env, fetchImpl = (...args) => fetch(...args), dbFile = process.env.CARD_SALES_DB || path.join(__dirname, '../../.runtime/card_sales.sqlite'), timeout = 12000 } = {}) {
  let database;
  function db() {
    if (database) return database;
    if (dbFile !== ':memory:') fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    database = new DatabaseSync(dbFile);
    database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS card_sales_records (
        id TEXT PRIMARY KEY,
        region TEXT NOT NULL,
        district TEXT NOT NULL,
        industry TEXT NOT NULL,
        period TEXT NOT NULL,
        sales_amount REAL,
        sales_count INTEGER,
        card_share REAL,
        source TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );`);
    return database;
  }

  async function kosisCard(p = {}) {
    const type = p.type || 'approval';
    const preset = KOSIS_CARD_TABLES[type];
    if (!preset) throw new ApiError('INVALID_INPUT', '카드매출 통계 종류를 확인하세요.');
    const raw = await connectors.kosis({
      orgId: preset.orgId,
      tblId: preset.tblId,
      objL1: preset.objL1,
      ...(preset.objL2 ? { objL2: preset.objL2 } : {}),
      ...(preset.objL3 ? { objL3: preset.objL3 } : {}),
      itmId: preset.itmId,
      prdSe: preset.prdSe,
      newEstPrdCnt: preset.newEstPrdCnt
    });
    const sidoFilter = typeof p.sido === 'string' ? p.sido.trim() : '';
    const kw = typeof p.keyword === 'string' ? p.keyword.trim().toLowerCase() : '';
    let records = raw.records;
    if (sidoFilter) {
      const short = sidoFilter.replace(/(특별자치시|특별자치도|특별시|광역시|도)$/, '');
      records = records.filter(r => r.classifications.some(c => c.name === sidoFilter || c.name === short || c.name?.startsWith(short)));
    }
    if (kw) {
      records = records.filter(r => [r.item_name, ...r.classifications.map(c => c.name)].some(s => String(s || '').toLowerCase().includes(kw)));
    }
    return {
      type,
      provider_label: preset.provider_label,
      description: preset.description,
      mode: raw.mode,
      collected_at: raw.collected_at,
      source_url: raw.source_url,
      total_records: records.length,
      records: records.slice(0, 500),
      notice: '공식 통계기관 응답 원본이며, 개별 점포의 실제 매출을 보증하지 않습니다.'
    };
  }

  async function seoulCard(p = {}) {
    const configuredKey = connectors.extraKey?.('SEOUL_DATA_API_KEY') || (env.SEOUL_DATA_API_KEY || '').trim();
    const useSample = Boolean(p.useSample) && !configuredKey;
    if (!configuredKey && !useSample) {
      throw new ApiError('NOT_CONFIGURED', '서울 열린데이터광장 인증키(SEOUL_DATA_API_KEY)가 설정되지 않았습니다. 관리자에서 키를 등록하거나 [서울 공식 샘플 5건 실시간 조회]를 선택하세요.', 503);
    }
    const key = configuredKey || 'sample';
    const start = Math.max(1, Math.min(500000, Math.trunc(Number(p.start) || 1)));
    const maxSpan = useSample ? 4 : 199;
    const end = Math.max(start, Math.min(start + maxSpan, Math.trunc(Number(p.end) || (useSample ? start + 4 : start + 49))));
    const quarter = p.quarter && /^\d{5}$/.test(String(p.quarter).trim()) ? `/${String(p.quarter).trim()}` : '';
    const endpoint = `http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/VwsmTrdarSelngQq/${start}/${end}${quarter}`;
    let res;
    try {
      res = await fetchImpl(endpoint, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeout) });
    } catch {
      throw new ApiError('UPSTREAM_UNAVAILABLE', '서울 열린데이터광장 상권 추정매출 서버에 연결할 수 없습니다.', 502);
    }
    if (!res.ok) throw new ApiError('PROVIDER_REJECTED', `서울 상권 추정매출 응답 오류 (${res.status})`, 502);
    let json;
    try { json = JSON.parse(await limitedResponseText(res)); } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError('INVALID_RESPONSE', '서울 열린데이터광장이 JSON 응답을 반환하지 않았습니다.', 502);
    }
    const root = json?.VwsmTrdarSelngQq;
    const code = root?.RESULT?.CODE || json?.RESULT?.CODE;
    if (!root || (code && code !== 'INFO-000')) {
      if (code === 'INFO-200') return { mode: useSample ? 'SAMPLE_LIVE' : 'LIVE', total_count: 0, items: [], collected_at: new Date().toISOString(), source_url: 'https://data.seoul.go.kr/dataList/OA-15572/S/1/datasetView.do' };
      throw new ApiError('PROVIDER_REJECTED', '서울 열린데이터광장 인증키 또는 조회 범위(샘플 키는 1~5건)를 확인하세요.', 502);
    }
    const kw = typeof p.keyword === 'string' ? p.keyword.trim().toLowerCase() : '';
    const rows = Array.isArray(root.row) ? root.row : [];
    const items = rows.map(r => {
      const amount = number(r.THSMON_SELNG_AMT);
      const count = number(r.THSMON_SELNG_CO);
      return {
        quarter_code: r.STDR_YYQU_CD || null,
        quarter_label: formatQuarter(r.STDR_YYQU_CD),
        district_type: r.TRDAR_SE_CD_NM || null,
        district_code: r.TRDAR_CD || null,
        district_name: r.TRDAR_CD_NM || null,
        industry_code: r.SVC_INDUTY_CD || null,
        industry_name: r.SVC_INDUTY_CD_NM || null,
        sales_amount: amount,
        sales_count: count,
        avg_ticket: amount != null && count > 0 ? Math.round(amount / count) : null,
        weekday_amount: number(r.MDWK_SELNG_AMT),
        weekend_amount: number(r.WKEND_SELNG_AMT),
        by_day: {
          월: number(r.MON_SELNG_AMT), 화: number(r.TUES_SELNG_AMT), 수: number(r.WED_SELNG_AMT),
          목: number(r.THUR_SELNG_AMT), 금: number(r.FRI_SELNG_AMT), 토: number(r.SAT_SELNG_AMT), 일: number(r.SUN_SELNG_AMT)
        },
        by_time: {
          '00~06시': number(r.TMZON_00_06_SELNG_AMT), '06~11시': number(r.TMZON_06_11_SELNG_AMT),
          '11~14시': number(r.TMZON_11_14_SELNG_AMT), '14~17시': number(r.TMZON_14_17_SELNG_AMT),
          '17~21시': number(r.TMZON_17_21_SELNG_AMT), '21~24시': number(r.TMZON_21_24_SELNG_AMT)
        },
        by_gender: { 남성: number(r.ML_SELNG_AMT), 여성: number(r.FML_SELNG_AMT) },
        by_age: {
          '10대': number(r.AGRDE_10_SELNG_AMT), '20대': number(r.AGRDE_20_SELNG_AMT), '30대': number(r.AGRDE_30_SELNG_AMT),
          '40대': number(r.AGRDE_40_SELNG_AMT), '50대': number(r.AGRDE_50_SELNG_AMT), '60대+': number(r.AGRDE_60_ABOVE_SELNG_AMT)
        }
      };
    }).filter(item => !kw || [item.district_name, item.industry_name, item.district_type].some(s => String(s || '').toLowerCase().includes(kw)));

    return {
      mode: useSample ? 'SAMPLE_LIVE' : 'LIVE',
      seoul_key_configured: Boolean(configuredKey),
      total_count: number(root.list_total_count),
      start,
      end,
      collected_at: new Date().toISOString(),
      source_url: 'https://data.seoul.go.kr/dataList/OA-15572/S/1/datasetView.do',
      items,
      notice: useSample
        ? '서울 열린데이터광장 공식 sample 키 실시간 응답(최대 5건)입니다. SEOUL_DATA_API_KEY(무료 즉시 발급)를 설정하면 전체 48만+ 상권 레코드를 200건 단위로 조회합니다.'
        : '서울시 상권분석서비스(카드사 가맹점 기반 추정매출) 실제 응답입니다.'
    };
  }

  function importDataset(p = {}) {
    const source = typeof p.source === 'string' && p.source.trim() ? p.source.trim().slice(0, 100) : '관리자 업로드 데이터셋';
    let rows = [];
    if (Array.isArray(p.rows)) {
      rows = p.rows;
    } else if (typeof p.csv === 'string' && p.csv.trim()) {
      const lines = parseCsv(p.csv.replace(/^\uFEFF/, ''));
      if (lines.length < 2) throw new ApiError('INVALID_INPUT', '헤더와 1행 이상의 데이터가 포함된 CSV를 입력하세요.');
      const headers = lines[0].map(h => h.toLowerCase());
      const idx = names => headers.findIndex(h => names.some(n => h.includes(n)));
      const iRegion = idx(['시도', '시군구', '지역', 'region']);
      const iDistrict = idx(['상권', '행정동', '읍면동', 'district', 'dong']);
      const iIndustry = idx(['업종', '산업', 'industry']);
      const iPeriod = idx(['기준', '년월', '분기', '연도', 'period', 'date']);
      const iAmount = headers.findIndex(h => !/건수|count|비중|비율|share/.test(h) && ['매출', '승인금액', '금액', 'amount', 'sales'].some(n => h.includes(n)));
      const iCount = idx(['건수', '승인건수', '결제건수', 'count']);
      if (iAmount === -1 || (iRegion === -1 && iDistrict === -1) || iIndustry === -1) {
        throw new ApiError('INVALID_INPUT', 'CSV 헤더에 지역(또는 상권명), 업종, 매출금액 컬럼이 필요합니다.');
      }
      rows = lines.slice(1).map(c => {
        return {
          region: iRegion >= 0 ? c[iRegion] : '미지정',
          district: iDistrict >= 0 ? c[iDistrict] : (iRegion >= 0 ? c[iRegion] : '미지정'),
          industry: c[iIndustry],
          period: iPeriod >= 0 ? c[iPeriod] : '미지정',
          sales_amount: c[iAmount],
          sales_count: iCount >= 0 ? c[iCount] : null
        };
      });
    } else {
      throw new ApiError('INVALID_INPUT', '업로드할 CSV 텍스트 또는 rows 배열을 전달하세요.');
    }
    if (!rows.length || rows.length > 2000) throw new ApiError('INVALID_INPUT', '1회 업로드 건수는 1~2,000건입니다.');
    if (rows.some(r => !r || typeof r !== 'object' || Array.isArray(r))) throw new ApiError('INVALID_INPUT', '매출 자료의 각 행은 객체여야 합니다.');
    const now = new Date().toISOString();
    const stmt = db().prepare('INSERT INTO card_sales_records (id, region, district, industry, period, sales_amount, sales_count, card_share, source, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    let inserted = 0;
    db().exec('BEGIN');
    try {
      for (const [index, r] of rows.entries()) {
        const amount = number(r.sales_amount);
        if (amount == null) throw new ApiError('INVALID_INPUT', `${index + 1}번째 데이터 행의 매출금액을 확인하세요. 자료는 저장되지 않았습니다.`);
        const count = number(r.sales_count);
        stmt.run(
          randomBytes(12).toString('hex'),
          String(r.region || '전국').trim().slice(0, 80),
          String(r.district || r.region || '상권').trim().slice(0, 120),
          String(r.industry || '전체').trim().slice(0, 100),
          String(r.period || '미지정').trim().slice(0, 40),
          amount,
          count != null ? Math.trunc(count) : null,
          number(r.card_share),
          source,
          now
        );
        inserted++;
      }
      db().exec('COMMIT');
    } catch (err) {
      db().exec('ROLLBACK');
      throw err;
    }
    if (!inserted) throw new ApiError('INVALID_INPUT', '유효한 숫자 매출금액이 있는 행이 없습니다.');
    return { inserted, total: db().prepare('SELECT count(*) AS n FROM card_sales_records').get().n, imported_at: now };
  }

  function listDatasets(q = {}) {
    const kw = typeof q.keyword === 'string' ? `%${q.keyword.trim()}%` : '%';
    const items = db().prepare(`
      SELECT id, region, district, industry, period, sales_amount, sales_count, card_share, source, imported_at
      FROM card_sales_records
      WHERE region LIKE ? OR district LIKE ? OR industry LIKE ?
      ORDER BY imported_at DESC, sales_amount DESC
      LIMIT 200
    `).all(kw, kw, kw);
    const count = db().prepare('SELECT count(*) AS n FROM card_sales_records').get().n;
    return {
      total_count: count,
      seoul_key_configured: Boolean(connectors.extraKey?.('SEOUL_DATA_API_KEY') || (env.SEOUL_DATA_API_KEY || '').trim()),
      kosis_configured: connectors.status().some(p => p.id === 'kosis' && p.configured),
      items
    };
  }

  function clearDatasets() {
    db().exec('DELETE FROM card_sales_records');
    return { total_count: 0 };
  }

  return { kosisCard, seoulCard, importDataset, listDatasets, clearDatasets, close() { database?.close(); database = null; } };
}

module.exports = { createCardSalesService, KOSIS_CARD_TABLES };
