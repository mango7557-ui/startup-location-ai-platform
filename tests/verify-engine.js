/**
 * 창업입지 AI - 추천 알고리즘 및 핵심 원칙 자동 검증 테스트 (tests/verify-engine.js)
 */

const assert = require('assert');
const {
  runRecommendationAnalysis,
  compareCandidateZones
} = require('../server/services/recommendationEngine');
const {
  getApiKeySecurityStatus,
  verifyBusinessRegistrationNumber
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

  console.log('3. [국세청 사업자등록정보 상태조회 보조 검증 및 보안 격리 확인]');
  const sec = getApiKeySecurityStatus();
  assert.strictEqual(sec.frontend_key_exposure, false);
  const bizCheck = await verifyBusinessRegistrationNumber('120-81-47521');
  assert.strictEqual(bizCheck.valid_format, true);
  console.log(`   -> 사업자번호 검증 응답: ${bizCheck.b_no_masked} (${bizCheck.b_stt})`);

  console.log('\n모든 추천 엔진 및 데이터 무결성 검증 테스트를 통과했습니다.');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
