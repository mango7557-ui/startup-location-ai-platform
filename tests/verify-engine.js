/**
 * 창업입지 AI - 추천 알고리즘 및 5대 외부 API 연동 자동 검증 테스트 (tests/verify-engine.js)
 */

const assert = require('assert');
const {
  runRecommendationAnalysis,
  compareCandidateZones
} = require('../server/services/recommendationEngine');
const {
  OFFICIAL_API_CATALOG,
  getApiKeySecurityStatus,
  verifyBusinessRegistrationNumber,
  runExternalApiDiagnostic
} = require('../server/services/externalApiConnectors');

async function runTests() {
  console.log('1. [기획서 2장 예시 검증] 업종: 커피숍 / 지역: 서울특별시 강남구 / 예산: 1억 원 이하');
  const gangnamResult = runRecommendationAnalysis({
    industry: '커피숍',
    sido: '서울특별시',
    sigungu: '강남구',
    budget: 10000,
    rent: 350,
    radius: 500,
    storeType: 'GENERAL'
  });

  assert.strictEqual(gangnamResult.query_summary.industry_code, 'IND_CAFE');
  assert.strictEqual(gangnamResult.top_recommendations.length, 10, '추천 상권 TOP 10이 반환되어야 합니다.');
  console.log(`   -> 추천 1위: ${gangnamResult.top_recommendations[0].zone_name} (종합 ${gangnamResult.top_recommendations[0].total_score}점)`);

  console.log('2. [결측 데이터 임의 숫자 생성 금지 및 신뢰도 표시 원칙 검증]');
  const segokZone = compareCandidateZones(['ZONE_GN_01', 'ZONE_GN_12'], {
    industry: 'IND_CAFE'
  });
  const partialCandidate = segokZone.candidates.find((c) => c.zone_id === 'ZONE_GN_12');
  assert.strictEqual(partialCandidate.demand_stats.floating_pop_daily, null, '미확보 유동인구는 null로 유지되어야 합니다.');
  assert.strictEqual(partialCandidate.survival_closure_stats.survival_rate_5yr, null, '미확보 5년 생존율은 null로 유지되어야 합니다.');
  assert.ok(partialCandidate.reliability.missing_metrics.length >= 2, '미확보 지표 안내가 포함되어야 합니다.');
  console.log(`   -> 결측 상권 신뢰도 등급: ${partialCandidate.reliability.label}`);

  console.log('3. [5대 공식 외부 API 카탈로그 및 통합 정규화 파이프라인 검증]');
  assert.strictEqual(OFFICIAL_API_CATALOG.length, 5, '5대 핵심 외부 API 카탈로그가 모두 등록되어야 합니다.');
  const sec = getApiKeySecurityStatus();
  assert.strictEqual(sec.frontend_key_exposure, false);

  const diag = await runExternalApiDiagnostic('ALL');
  assert.ok(diag.diagnostics.semas_store.items.length > 0, '소상공인 상가정보 API 정규화 결과가 반환되어야 합니다.');
  assert.strictEqual(diag.diagnostics.nts_biz_status.valid_format, true, '국세청 상태조회 API 검증이 작동해야 합니다.');
  assert.ok(diag.diagnostics.kosis_stats.normalized_records.length > 0, 'KOSIS 기업생멸통계 정규화 결과가 반환되어야 합니다.');
  assert.ok(diag.diagnostics.data_go_kr_region.normalized_region_stat.region_code, '공공데이터포털 지역통계가 반환되어야 합니다.');
  assert.ok(diag.diagnostics.kakao_local.documents.length > 0, '카카오 로컬 검색 결과가 반환되어야 합니다.');

  console.log('   -> 1) 상가·상권정보 API 정규화 건수:', diag.diagnostics.semas_store.items.length);
  console.log('   -> 2) 국세청 사업자등록 상태조회:', diag.diagnostics.nts_biz_status.b_no_masked, diag.diagnostics.nts_biz_status.b_stt);
  console.log('   -> 3) KOSIS 기업생멸통계 지표 수:', diag.diagnostics.kosis_stats.normalized_records.length);
  console.log('   -> 4) 공공데이터포털 지역통계 행정동:', diag.diagnostics.data_go_kr_region.normalized_region_stat.emd_name);
  console.log('   -> 5) 카카오 로컬 검색 1순위:', diag.diagnostics.kakao_local.documents[0].place_name);

  console.log('\n모든 추천 엔진 및 5대 외부 API 연동 테스트를 통과했습니다.');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
