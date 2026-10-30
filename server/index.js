/**
 * 전국 업종별 창업 입지 추천 플랫폼 (창업입지 AI) - 백엔드 API 서버
 *
 * [제공 API 엔드포인트]
 * - GET  /api/health          : 서버 상태 및 보안 설정 확인
 * - GET  /api/meta            : 표준 업종 코드, 전국 행정구역 트리, 공식 데이터 출처, 초기 가중치 반환
 * - GET  /api/recommend       : 업종·지역·예산·임대료·매장유형 조건별 추천 상권 TOP 10 산출
 * - POST /api/recommend       : 동일 (JSON 바디 지원)
 * - POST /api/compare         : 선택한 2~3개 후보 상권 항목별 비교 및 불확실성 검증
 * - POST /api/nts/verify      : 국세청 사업자등록정보 상태조회 단건 검증 (보조 API)
 * - GET  /api/admin/overview  : 관리자용 API 연결 상태, 수집·갱신 로그, 표준 코드, DB 스키마 현황 조회
 * - POST /api/admin/sync      : 관리자용 수동 데이터 수집·중복 정리 실행 트리거
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const {
  DATA_SOURCES,
  INDUSTRY_CODES,
  REGIONS_TREE,
  COMMERCIAL_ZONES
} = require('./data/publicDatasetStore');

const {
  DEFAULT_WEIGHTS,
  runRecommendationAnalysis,
  compareCandidateZones
} = require('./services/recommendationEngine');

const {
  getApiKeySecurityStatus,
  verifyBusinessRegistrationNumber,
  triggerDataSyncJob,
  getSyncLogs
} = require('./services/externalApiConnectors');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SCHEMA_SQL_PATH = path.join(__dirname, '..', 'db', 'schema.sql');

// 간단한 IP당 요청 제한 (보안 및 운영 관리 원칙 준수)
const rateLimitMap = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 180;
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + windowMs;
  } else {
    entry.count += 1;
  }
  rateLimitMap.set(ip, entry);
  return entry.count <= maxRequests;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const clientIp = req.socket.remoteAddress || 'local';
  if (!checkRateLimit(clientIp)) {
    return sendJson(res, 429, { error: '요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.' });
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  try {
    // 1. 헬스 체크
    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        status: 'OK',
        service: '창업입지 AI 백엔드 서버',
        timestamp: new Date().toISOString(),
        security: getApiKeySecurityStatus()
      });
    }

    // 2. 초기 메타데이터 (표준 업종, 전국 행정구역, 데이터 출처, 초기 가중치)
    if (pathname === '/api/meta' && req.method === 'GET') {
      return sendJson(res, 200, {
        industries: INDUSTRY_CODES,
        regions: REGIONS_TREE,
        default_weights: DEFAULT_WEIGHTS,
        data_sources: DATA_SOURCES,
        total_commercial_zones: COMMERCIAL_ZONES.length
      });
    }

    // 3. 창업 입지 분석 및 TOP 10 추천 (GET / POST)
    if (pathname === '/api/recommend' && (req.method === 'GET' || req.method === 'POST')) {
      let params = Object.fromEntries(parsedUrl.searchParams.entries());
      if (req.method === 'POST') {
        const body = await parseJsonBody(req);
        params = { ...params, ...body };
      }
      const result = runRecommendationAnalysis(params);
      return sendJson(res, 200, result);
    }

    // 4. 후보 상권 2~3곳 비교 분석 (POST)
    if (pathname === '/api/compare' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const zoneIds = Array.isArray(body.zoneIds) ? body.zoneIds.slice(0, 3) : [];
      if (zoneIds.length < 2) {
        return sendJson(res, 400, {
          error: '비교할 후보 상권을 2곳 이상(최대 3곳) 선택해주세요.'
        });
      }
      const result = compareCandidateZones(zoneIds, body.queryParams || {});
      return sendJson(res, 200, result);
    }

    // 5. 국세청 사업자등록정보 상태조회 단건 검증 (POST)
    if (pathname === '/api/nts/verify' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const verifyResult = await verifyBusinessRegistrationNumber(body.bizNo);
      return sendJson(res, 200, verifyResult);
    }

    // 6. 관리자 대시보드 종합 현황 (GET)
    if (pathname === '/api/admin/overview' && req.method === 'GET') {
      let schemaSqlPreview = '';
      try {
        schemaSqlPreview = fs.readFileSync(SCHEMA_SQL_PATH, 'utf8');
      } catch (_e) {
        schemaSqlPreview = '-- schema.sql not found';
      }

      return sendJson(res, 200, {
        security_status: getApiKeySecurityStatus(),
        data_sources: DATA_SOURCES,
        sync_logs: getSyncLogs(),
        industry_codes: INDUSTRY_CODES,
        region_summary: REGIONS_TREE.map((sido) => ({
          sido_code: sido.sido_code,
          sido_name: sido.sido_name,
          sigungu_count: sido.sigungu_list.length,
          emd_count: sido.sigungu_list.reduce((acc, sg) => acc + sg.emd_list.length, 0)
        })),
        quality_summary: {
          total_zones: COMMERCIAL_ZONES.length,
          official_verified_zones: COMMERCIAL_ZONES.filter((z) => z.quality_status === 'OFFICIAL').length,
          partial_coverage_zones: COMMERCIAL_ZONES.filter((z) => z.quality_status !== 'OFFICIAL').length,
          duplicate_cleaning_policy: '상가업소번호(store_id) 및 도로명주소+상호명+층정보 해시 기준 중복 제거'
        },
        schema_sql: schemaSqlPreview
      });
    }

    // 7. 관리자 수동 데이터 수집·갱신 실행 (POST)
    if (pathname === '/api/admin/sync' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const syncResult = triggerDataSyncJob(body.sourceId);
      return sendJson(res, 200, syncResult);
    }

    // 8. 정적 파일 서빙 (프런트엔드 웹앱)
    let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname);
    // 디렉토리 트래버설 방지
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
      return fs.createReadStream(filePath).pipe(res);
    }

    // SPA 라우팅 폴백
    const indexHtml = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexHtml)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(indexHtml).pipe(res);
    }

    res.writeHead(404);
    res.end('Not Found');
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Internal Server Error' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[창업입지 AI] 서버가 실행 중입니다: http://localhost:${PORT}`);
  });
}

module.exports = server;
