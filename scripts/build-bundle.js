/**
 * 창업입지 AI - 정적 프리뷰 및 GitHub Pages 공유 링크 번들 생성기 (scripts/build-bundle.js)
 * 실행: npm run build
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function buildBundle() {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');
  const koreaRegionsCode = fs
    .readFileSync(path.join(ROOT, 'server/data/koreaRegionsFull.js'), 'utf8')
    .replace('module.exports =', 'window.__KOREA_REGIONS__ =');
  const storeCode = fs
    .readFileSync(path.join(ROOT, 'server/data/publicDatasetStore.js'), 'utf8')
    .replace(
      "const { FULL_REGIONS_TREE, buildRegionalZoneCandidates } = require('./koreaRegionsFull');",
      'const { FULL_REGIONS_TREE, buildRegionalZoneCandidates } = window.__KOREA_REGIONS__;'
    )
    .replace('module.exports =', 'window.__STORE__ =');
  const engineCode = fs
    .readFileSync(path.join(ROOT, 'server/services/recommendationEngine.js'), 'utf8')
    .replace(
      /const \{[\s\S]*?\} = require\('\.\.\/data\/publicDatasetStore'\);/,
      'const { DATA_SOURCES, INDUSTRY_CODES, REGIONS_TREE, buildRegionalZoneCandidates, INDUSTRY_BASE_SURVIVAL_STATS, COMMERCIAL_ZONES } = window.__STORE__;'
    )
    .replace('module.exports =', 'window.__ENGINE__ =');
  const connectorCode = fs
    .readFileSync(path.join(ROOT, 'server/services/externalApiConnectors.js'), 'utf8')
    .replace(
      /const \{[\s\S]*?\} = require\('\.\.\/data\/publicDatasetStore'\);/,
      'const { DATA_SOURCES, INITIAL_SYNC_LOGS, COMMERCIAL_ZONES, INDUSTRY_CODES } = window.__STORE__;'
    )
    .replace(/process\.env\./g, '(window.__ENV__ || {}).')
    .replace('module.exports =', 'window.__CONNECTORS__ =');
  const schemaSql = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8');
  const appJs = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');

  const fetchShim = `
window.__ENV__ = {};
window.__SCHEMA_SQL__ = ${JSON.stringify(schemaSql)};
window.__ORIG_FETCH__ = window.fetch.bind(window);
window.fetch = async function(url, options = {}) {
  try {
    if (typeof url === 'string' && url.startsWith('/api/')) {
      const S = window.__STORE__;
      const E = window.__ENGINE__;
      const C = window.__CONNECTORS__;
      const body = options.body ? JSON.parse(options.body) : {};
      const mkRes = (obj) => ({ ok: true, status: 200, json: async () => obj });
      if (url.startsWith('/api/meta')) {
        return mkRes({
          industries: S.INDUSTRY_CODES,
          regions: S.REGIONS_TREE,
          default_weights: E.DEFAULT_WEIGHTS,
          data_sources: S.DATA_SOURCES,
          total_commercial_zones: S.COMMERCIAL_ZONES.length
        });
      }
      if (url.startsWith('/api/recommend')) {
        return mkRes(E.runRecommendationAnalysis(body));
      }
      if (url.startsWith('/api/compare')) {
        return mkRes(E.compareCandidateZones(body.zoneIds || [], body.queryParams || {}));
      }
      if (url.startsWith('/api/nts/verify')) {
        return mkRes(await C.verifyBusinessRegistrationNumber(body.bizNo));
      }
      if (url.startsWith('/api/external/keys')) {
        return mkRes(C.updateRuntimeApiKeys(body));
      }
      if (url.startsWith('/api/external/test')) {
        return mkRes(await C.runExternalApiDiagnostic(body.apiId || 'ALL'));
      }
      if (url.startsWith('/api/external/kakao')) {
        return mkRes(await C.searchKakaoLocationOrAddress(body));
      }
      if (url.startsWith('/api/external/semas')) {
        return mkRes(await C.fetchSemasStoresInRadius(body));
      }
      if (url.startsWith('/api/external/kosis')) {
        return mkRes(await C.fetchKosisEnterpriseSurvivalStats(body));
      }
      if (url.startsWith('/api/external/region')) {
        return mkRes(await C.fetchDataGoKrRegionStats(body));
      }
      if (url.startsWith('/api/admin/overview')) {
        return mkRes({
          security_status: C.getApiKeySecurityStatus(),
          data_sources: S.DATA_SOURCES,
          sync_logs: C.getSyncLogs(),
          industry_codes: S.INDUSTRY_CODES,
          quality_summary: {
            total_zones: 1308,
            official_verified_zones: 1180,
            partial_coverage_zones: 128,
            duplicate_cleaning_policy: '상가업소번호(store_id) 및 도로명주소+상호명+층정보 해시 기준 중복 제거'
          },
          schema_sql: window.__SCHEMA_SQL__
        });
      }
      if (url.startsWith('/api/admin/sync')) {
        return mkRes(C.triggerDataSyncJob(body.sourceId));
      }
    }
  } catch (e) { console.error(e); }
  return window.__ORIG_FETCH__(url, options);
};
`;

  const bundled = html
    .replace('<link rel="stylesheet" href="/styles.css" />', '<style>' + css + '</style>')
    .replace(
      '<script src="/app.js"></script>',
      '<script>' +
        koreaRegionsCode +
        '\n' +
        storeCode +
        '\n' +
        engineCode +
        '\n' +
        connectorCode +
        '\n' +
        fetchShim +
        '\n' +
        appJs +
        '</script>'
    );

  fs.writeFileSync(path.join(ROOT, 'public/preview.html'), bundled, 'utf8');
  fs.writeFileSync(path.join(ROOT, 'index.html'), bundled, 'utf8');
  console.log('[build-bundle] public/preview.html 및 index.html 생성이 완료되었습니다.');
}

buildBundle();
