'use strict';
const { runRecommendationAnalysis } = require('./recommendationEngine');
const { INDUSTRY_CODES, REGIONS_TREE } = require('../data/publicDatasetStore');
function demoAnalysis(input = {}) {
  const industry = INDUSTRY_CODES.find(i => i.industry_code === input.industry);
  const region = REGIONS_TREE.find(s => s.sido_name === input.sido);
  const district = region?.sigungu_list.find(s => s.sigungu_name === input.sigungu);
  if (!industry || !district || input.emd && !district.emd_list.includes(input.emd)) throw new Error('INVALID_DEMO_SELECTION');
  const p = { ...input, industry: industry.industry_code, radius: Math.max(100, Math.min(2000, Number(input.radius) || 500)) };
  const weightKeys = ['wSurvival', 'wCompetition', 'wDemand', 'wCost'];
  if (weightKeys.some(k => input[k] != null && (!Number.isFinite(Number(input[k])) || Number(input[k]) < 0))) throw new Error('INVALID_WEIGHTS');
  if (weightKeys.every(k => input[k] != null) && weightKeys.every(k => Number(input[k]) === 0)) throw new Error('INVALID_WEIGHTS');
  const result = runRecommendationAnalysis(p);
  return { mode: 'DEMO', generated_at: result.generated_at, query: result.query_summary, weights: result.weights_config.applied,
    notice: '모든 점수·점포·인구·비용은 기능 체험용 가상 데이터입니다. 실제 공식 통계·입지 추천으로 사용할 수 없습니다.',
    candidates: result.top_recommendations.map(c => ({ id: c.zone_id, rank: c.rank, name: c.zone_name.replace(/\s*\(일부 통계 미확보 검증용\)/, ''),
      region: `${c.sido_name} ${c.sigungu_name}`, emd: c.emd_name, type: c.district_type_label, lat: c.lat, lng: c.lng,
      score: c.total_score, scores: c.pillar_scores, weights: c.weights_applied,
      stores: c.competition_stats.same_industry_store_count, population: c.demand_stats.resident_population,
      workers: c.demand_stats.worker_population, rent: c.cost_stats.estimated_monthly_rent_manwon,
      startup: c.cost_stats.estimated_total_startup_cost_manwon,
      survival: [c.survival_closure_stats.survival_rate_1yr, c.survival_closure_stats.survival_rate_3yr, c.survival_closure_stats.survival_rate_5yr],
      closure: c.survival_closure_stats.annual_closure_rate, missing: c.reliability.missing_metrics,
      source: '가상 시뮬레이션', quality: 'DEMO', observed_at: null })) };
}
module.exports = { demoAnalysis };
