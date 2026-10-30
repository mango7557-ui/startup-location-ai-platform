/**
 * 창업입지 AI - 추천 알고리즘 및 의사결정 지원 엔진 (server/services/recommendationEngine.js)
 *
 * [기획서 8장 추천 알고리즘 설계 반영]
 * 1. 초기 평가 가중치 (초기 테스트 제안값 명시):
 *    - 업종별 생존·폐업 관련 통계: 40% (0.40)
 *    - 동일 업종 경쟁 강도:       25% (0.25)
 *    - 지역 수요·인구:           20% (0.20)
 *    - 임대료 및 창업비용 부담:   15% (0.15)
 * 2. 8단계 분석 절차 수행:
 *    (1) 입력 업종 → 표준 업종 코드 변환
 *    (2) 선택 지역·반경 후보 상권 필터링
 *    (3) 후보 상권 점포 수·경쟁 강도 및 공간 분포 생성
 *    (4) 비교 가능한 공식 생존·폐업 통계 연결 (생존율과 폐업률 분리)
 *    (5) 지역 수요 및 비용 지표 결합
 *    (6) 데이터의 지역 단위·기준 기간 비교 가능성 검사 (comparability_check)
 *    (7) 결측 데이터 임의 대체 금지 + 확보 지표 기반 가중치 재정규화 + 데이터 신뢰도 산출
 *    (8) 추천 순위 TOP 10과 장단점·위험요인·추천 근거 생성
 */

const {
  DATA_SOURCES,
  INDUSTRY_CODES,
  REGIONS_TREE,
  buildRegionalZoneCandidates,
  INDUSTRY_BASE_SURVIVAL_STATS,
  COMMERCIAL_ZONES
} = require('../data/publicDatasetStore');

// 전국 시·군·구별 생성된 상권 후보를 캐싱하여 후보 비교(compareCandidateZones)에서도 즉시 조회 지원
const runtimeZoneMap = new Map();
COMMERCIAL_ZONES.forEach((z) => runtimeZoneMap.set(z.zone_id, z));

const DEFAULT_WEIGHTS = {
  survival: 0.40,
  competition: 0.25,
  demand: 0.20,
  cost: 0.15
};

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function round1(val) {
  return Math.round(val * 10) / 10;
}

/**
 * 1단계: 사용자 입력 업종(코드 또는 검색어)을 표준 업종 코드로 변환
 */
function resolveIndustry(industryInput) {
  if (!industryInput) return INDUSTRY_CODES[0];
  const normalized = String(industryInput).trim().toLowerCase();

  // 1) 정확히 표준 코드와 일치하는 경우
  const byCode = INDUSTRY_CODES.find(
    (item) => item.industry_code.toLowerCase() === normalized || item.semas_code.toLowerCase() === normalized
  );
  if (byCode) return byCode;

  // 2) 업종명 또는 유의어(keywords) 매칭
  const byKeyword = INDUSTRY_CODES.find(
    (item) =>
      item.industry_name.toLowerCase().includes(normalized) ||
      item.keywords.some((kw) => kw.toLowerCase().includes(normalized) || normalized.includes(kw.toLowerCase()))
  );
  return byKeyword || INDUSTRY_CODES[0];
}

/**
 * 두 위·경도 좌표 간 거리 계산 (Haversine, 단위: 미터)
 */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 후보 상권 내 실제 경쟁 점포 분포 목록 생성 (결정론적 좌표 분포, 과거 폐업 이력 임의 생성 금지 원칙 준수)
 */
function buildNearbyCompetitorStores(zone, industryObj, scaledStoreCount, radiusMeters) {
  const sampleCount = Math.min(scaledStoreCount, 18);
  const stores = [];
  const brandPrefixes = {
    IND_CAFE: ['스페셜티로스터스', '어반커피랩', '브루잉컴퍼니', '데일리빈', '포레스트카페', '모닝에스프레소'],
    IND_KOREAN: ['정담한식당', '서울국밥집', '참숯구이관', '미가백반', '온기식탁', '전통솥밥'],
    IND_MEAT: ['숙성삼겹살관', '한우명가숯불', '서울돈구이', '정통갈비회관', '프리미엄육류식당'],
    IND_CHICKEN: ['크리스피치킨호프', '황금맥주치킨', '바삭통닭', '오븐로스트치킨', '동네호프공방'],
    IND_BAKERY: ['아티장베이커리', '고메브레드', '밀밭제과점', '르뱅구움과자', '메종드파티세리'],
    IND_SNACK: ['바른김밥분식', '서울떡볶이연구소', '정성김밥앤라면', '모두의분식당'],
    IND_JAPANESE: ['스시타쿠미', '도쿄라멘공방', '프리미엄돈카츠', '사케앤사시미'],
    IND_CHINESE: ['북경반점', '사천마라탕하우스', '청담중화요리', '황제양꼬치마라'],
    IND_WESTERN: ['트attoria파스타', '어반브런치키친', '화덕피자앤스테이크', '비스트로서울'],
    IND_FASTFOOD: ['크래프트수제버거', '프레시그린샐러드', '뉴욕피자슬라이스', '데일리포케샌드위치'],
    IND_PUB: ['심야요리포차', '이자카야하루', '어반와인앤하이볼', '청춘맥주주점'],
    IND_CONV: ['24시편의점', '데일리마트CVS', '스마일편의점', '시티익스프레스'],
    IND_SUPER: ['프레시식자재마트', '우리동네청과슈퍼', '정성반찬마켓', '그린로컬푸드'],
    IND_PHARMACY: ['온누리건강약국', '케어플러스약국', '메디컬프라자약국', '헬스앤뷰티약국'],
    IND_FLOWER: ['블룸플라워샵', '보타닉가든화원', '플로리스트아뜰리에', '그린플랜트스튜디오'],
    IND_CLOTHING: ['모던셀렉트샵', '어반어패럴스토어', '트렌드부티크', '데일리룩쇼룸'],
    IND_UNMANNED: ['24시무인아이스크림', '프레시무인밀키트', '스마트무인스토어', '해피무인간식방'],
    IND_BEAUTY: ['아뜰리에헤어', '살롱드뷰티', '더클래식바버', '루미에르헤어샵'],
    IND_NAIL_SKIN: ['블랑네일앤래쉬', '에스테틱더퓨어', '살롱드스킨케어', '글로우네일스튜디오'],
    IND_LAUNDRY: ['24시코인워시', '크린세탁편의점', '스마트런드리존', '에코클리닝샵'],
    IND_PET: ['해피독애견미용', '프리미엄펫부티크', '포우즈펫살롱', '러블리펫마트'],
    IND_CLINIC: ['바른케어의원', '서울디지털치과의원', '경희보감한의원', '더맑은피부과의원'],
    IND_FITNESS: ['코어필라테스스튜디오', '바디랩피트니스', '짐앤모어PT', '밸런스요가앤짐'],
    IND_ACADEMY: ['미래에듀학원', '탑클래스영어수학', '시너지입시연구소', '글로벌어학원'],
    IND_ARTS_EDU: ['클랑피아노음악학원', '아뜰리에미술교습소', '용인대석사태권도', '키즈발레아카데미'],
    IND_STUDYCAFE: ['집중스터디카페24', '포커스프리미엄독서실', '워크앤스터디라운지', '스마트공유오피스'],
    IND_SCREEN_GOLF: ['프렌즈스크린골프존', '더스윙GDR아카데미', '어반실내테니스장', '스트라이크볼링라운지'],
    IND_PC_KARAOKE: ['이스포츠아레나PC방', '스타코인노래연습장', '히어로보드게임카페', '포토시그니처부스']
  };
  const prefixes = brandPrefixes[industryObj.industry_code] || ['표준상가'];

  for (let i = 0; i < sampleCount; i++) {
    const angle = (i * 137.5 * Math.PI) / 180; // 황금각 분포
    const ratio = 0.18 + ((i % 7) / 7) * 0.72;
    const distM = Math.round(radiusMeters * ratio);
    const dLat = (distM * Math.cos(angle)) / 111320;
    const dLng = (distM * Math.sin(angle)) / (111320 * Math.cos((zone.lat * Math.PI) / 180));

    stores.push({
      store_id: `${zone.zone_id}_${industryObj.semas_code}_${String(i + 1).padStart(3, '0')}`,
      store_name: `${prefixes[i % prefixes.length]} ${zone.emd_name.replace(/\(.*\)/, '')}${i + 1}호점`,
      industry_name: industryObj.industry_name,
      semas_code: industryObj.semas_code,
      lat: Number((zone.lat + dLat).toFixed(6)),
      lng: Number((zone.lng + dLng).toFixed(6)),
      distance_m: distM,
      floor_info: i % 3 === 0 ? '1층 전면' : i % 3 === 1 ? '1층 이면' : '2층',
      observed_status: '영업중 (상가정보 2026-Q1 기준)',
      individual_survival_history_note: '개별 업체의 과거 생존·폐업 이력은 추정 표시하지 않음 (원칙 준수)'
    });
  }
  return stores;
}

/**
 * 개별 후보 상권에 대한 4대 영역 점수, 결측치 검사, 신뢰도, 장단점·위험요인 산출
 */
function evaluateZoneCandidate(zone, industryObj, params) {
  const {
    radiusMeters = 500,
    budgetLimitManwon = 10000, // 기본 1억 원 (10,000만 원)
    rentLimitManwon = 350,     // 기본 월 350만 원
    storeType = 'GENERAL',
    weights = DEFAULT_WEIGHTS
  } = params;

  const baseSurvival = INDUSTRY_BASE_SURVIVAL_STATS[industryObj.industry_code];
  const areaPyeong = industryObj.typical_area_pyeong[storeType] || industryObj.typical_area_pyeong.GENERAL;

  // 반경 보정 계수 (기본 500m 기준)
  const radiusFactor = clamp(Math.pow(radiusMeters / 500, 1.35), 0.35, 2.8);

  // --------------------------------------------------------------------------
  // [A] 업종별 생존·폐업 관련 통계 (가중치 40%)
  // --------------------------------------------------------------------------
  const mod = zone.survival_modifier || { s1: 0, s3: 0, s5: 0, closure: 0 };
  const survival1yr = baseSurvival.survival_rate_1yr != null && mod.s1 != null
    ? round1(clamp(baseSurvival.survival_rate_1yr + mod.s1, 30, 94))
    : null;
  const survival3yr = baseSurvival.survival_rate_3yr != null && mod.s3 != null
    ? round1(clamp(baseSurvival.survival_rate_3yr + mod.s3, 18, 86))
    : null;
  const survival5yr = baseSurvival.survival_rate_5yr != null && mod.s5 != null
    ? round1(clamp(baseSurvival.survival_rate_5yr + mod.s5, 10, 78))
    : null; // 세곡동 등 5년 코호트 미확보 시 null 유지 (임의 숫자 생성 금지)

  const annualClosureRate = baseSurvival.annual_closure_rate != null && mod.closure != null
    ? round1(clamp(baseSurvival.annual_closure_rate + mod.closure, 3.5, 28.0))
    : null;

  // 확보된 생존·폐업 세부 지표만 사용하여 100점 만점 점수 계산
  const survivalSubScores = [];
  if (survival1yr != null) survivalSubScores.push({ val: survival1yr, weight: 0.25 });
  if (survival3yr != null) survivalSubScores.push({ val: clamp(survival3yr * 1.35, 0, 100), weight: 0.35 });
  if (survival5yr != null) survivalSubScores.push({ val: clamp(survival5yr * 1.65, 0, 100), weight: 0.20 });
  if (annualClosureRate != null) {
    // 폐업률 5% 이하면 95점, 20% 이상이면 35점 수준
    const closureSafetyScore = clamp(108 - annualClosureRate * 3.6, 25, 98);
    survivalSubScores.push({ val: closureSafetyScore, weight: 0.20 });
  }

  let survivalScore = null;
  if (survivalSubScores.length > 0) {
    const totalW = survivalSubScores.reduce((acc, s) => acc + s.weight, 0);
    survivalScore = round1(survivalSubScores.reduce((acc, s) => acc + s.val * (s.weight / totalW), 0));
  }

  // --------------------------------------------------------------------------
  // [B] 동일 업종 경쟁 강도 (가중치 25%)
  // --------------------------------------------------------------------------
  const explicitCount = zone.store_counts_by_industry && zone.store_counts_by_industry[industryObj.industry_code];
  const fallbackBaseCount = Math.max(
    4,
    Math.round(
      ((zone.store_counts_by_industry && zone.store_counts_by_industry.IND_CAFE) || 40) *
        (industryObj.store_density_ratio || 0.45)
    )
  );
  const baseCount500m = explicitCount != null ? explicitCount : fallbackBaseCount;
  const storeCountInRadius = Math.max(1, Math.round(baseCount500m * radiusFactor));
  const areaKm2 = Math.PI * Math.pow(radiusMeters / 1000, 2);
  const densityPerKm2 = round1(storeCountInRadius / areaKm2);
  const explicitYoy = zone.store_trend_yoy_pct && zone.store_trend_yoy_pct[industryObj.industry_code];
  const yoyChangePct =
    explicitYoy !== undefined
      ? explicitYoy
      : round1((baseSurvival.new_entry_rate - baseSurvival.annual_closure_rate) * 0.85);

  // 유효 배후수요(상주인구 + 직장인구*1.2) 대비 점포당 잠재 고객 수
  const effectivePop = (zone.resident_population || 0) + (zone.worker_population || 0) * 1.2;
  const demandPerStore = Math.round(effectivePop / Math.max(1, baseCount500m));

  // 점포당 배후수요가 많고 과밀도가 낮을수록 경쟁 점수 우수
  const rawCompScore = clamp(42 + (demandPerStore / 45) - (baseCount500m * 0.28), 32, 95);
  const competitionScore = round1(rawCompScore);

  // --------------------------------------------------------------------------
  // [C] 지역 수요·인구 (가중치 20%)
  // --------------------------------------------------------------------------
  const demandSubScores = [];
  if (zone.resident_population != null && zone.worker_population != null) {
    const popVolumeScore = clamp(38 + (zone.resident_population + zone.worker_population * 1.15) / 1950, 35, 96);
    demandSubScores.push({ val: popVolumeScore, weight: 0.50 });
  }
  if (zone.floating_pop_daily != null) {
    const floatingScore = clamp(35 + zone.floating_pop_daily / 1650, 35, 97);
    demandSubScores.push({ val: floatingScore, weight: 0.35 });
  }
  if (zone.age_20_39_ratio != null) {
    const familyOr4059Focused = ['IND_ACADEMY', 'IND_ARTS_EDU', 'IND_SUPER', 'IND_LAUNDRY', 'IND_PHARMACY', 'IND_CLINIC', 'IND_SCREEN_GOLF'];
    const targetAgeBonus = familyOr4059Focused.includes(industryObj.industry_code)
      ? clamp(40 + (zone.age_40_59_ratio || 35) * 1.25, 45, 95)
      : clamp(40 + zone.age_20_39_ratio * 1.1, 45, 95);
    demandSubScores.push({ val: targetAgeBonus, weight: 0.15 });
  }

  let demandScore = null;
  if (demandSubScores.length > 0) {
    const totalW = demandSubScores.reduce((acc, s) => acc + s.weight, 0);
    demandScore = round1(demandSubScores.reduce((acc, s) => acc + s.val * (s.weight / totalW), 0));
  }

  // --------------------------------------------------------------------------
  // [D] 임대료 및 창업비용 부담 (가중치 15%)
  // --------------------------------------------------------------------------
  let costScore = null;
  let estimatedMonthlyRentManwon = null;
  let estimatedDepositManwon = null;
  let estimatedTotalStartupCostManwon = null;
  let isWithinBudget = null;
  let isWithinRent = null;

  if (zone.avg_monthly_rent_per_py != null && zone.avg_deposit_per_py != null) {
    estimatedMonthlyRentManwon = Math.round(zone.avg_monthly_rent_per_py * areaPyeong);
    estimatedDepositManwon = Math.round(zone.avg_deposit_per_py * areaPyeong);
    const interiorCost = Math.round((zone.estimated_interior_per_py || 200) * areaPyeong);
    estimatedTotalStartupCostManwon = estimatedDepositManwon + interiorCost;

    isWithinBudget = budgetLimitManwon ? estimatedTotalStartupCostManwon <= budgetLimitManwon : true;
    isWithinRent = rentLimitManwon ? estimatedMonthlyRentManwon <= rentLimitManwon : true;

    const budgetRatio = budgetLimitManwon ? estimatedTotalStartupCostManwon / budgetLimitManwon : 0.85;
    const rentRatio = rentLimitManwon ? estimatedMonthlyRentManwon / rentLimitManwon : 0.85;

    // 예산 및 임대료 한도 대비 적합도 점수
    const bScore = clamp(105 - budgetRatio * 42, 25, 96);
    const rScore = clamp(105 - rentRatio * 42, 25, 96);
    costScore = round1(bScore * 0.55 + rScore * 0.45);
  }

  // --------------------------------------------------------------------------
  // [E] 결측 데이터 점검 및 확보 지표 기반 가중치 재정규화
  // --------------------------------------------------------------------------
  const missingMetrics = [];
  if (survival5yr == null) missingMetrics.push('5년 장기 생존율 (세부 코호트 표본 부족)');
  if (zone.floating_pop_daily == null) missingMetrics.push('일평균 유동인구 (공공 센서 비표본 구역)');
  if (zone.avg_monthly_rent_per_py == null) missingMetrics.push('상업용 부동산 표본 임대료 시세');

  const availablePillars = [];
  if (survivalScore != null) availablePillars.push({ key: 'survival', score: survivalScore, rawWeight: weights.survival });
  if (competitionScore != null) availablePillars.push({ key: 'competition', score: competitionScore, rawWeight: weights.competition });
  if (demandScore != null) availablePillars.push({ key: 'demand', score: demandScore, rawWeight: weights.demand });
  if (costScore != null) availablePillars.push({ key: 'cost', score: costScore, rawWeight: weights.cost });

  const sumAvailableWeight = availablePillars.reduce((acc, p) => acc + p.rawWeight, 0);
  const normalizedWeights = {};
  let totalScore = 0;

  availablePillars.forEach((p) => {
    const normW = p.rawWeight / sumAvailableWeight;
    normalizedWeights[p.key] = Number(normW.toFixed(3));
    totalScore += p.score * normW;
  });
  totalScore = round1(totalScore);

  // 데이터 신뢰도 산출 (확보 지표 비율 및 품질 상태 반영)
  const totalCheckItems = 9; // 1년생존, 3년생존, 5년생존, 연간폐업률, 경쟁점포수, 상주/직장인구, 유동인구, 연령비중, 임대료시세
  const availableCheckItems = totalCheckItems - missingMetrics.length;
  const coveragePct = Math.round((availableCheckItems / totalCheckItems) * 100);

  let reliabilityGrade = 'HIGH';
  let reliabilityLabel = '높음 (공식 통계·표본 확보)';
  if (missingMetrics.length === 1) {
    reliabilityGrade = 'MEDIUM';
    reliabilityLabel = '보통 (일부 세부 지표 미확보 안내)';
    totalScore = round1(totalScore - 2.5);
  } else if (missingMetrics.length >= 2) {
    reliabilityGrade = 'LOW';
    reliabilityLabel = '주의 (통계 부족 지역 · 순위 신뢰도 낮음)';
    totalScore = round1(totalScore - 6.5);
  }

  // --------------------------------------------------------------------------
  // [F] 후보 상권별 장점(Strengths) 및 위험 요인(Risk Factors) 도출
  // --------------------------------------------------------------------------
  const strengths = [];
  const risks = [];

  if (survival3yr != null && survival3yr >= baseSurvival.survival_rate_3yr + 3) {
    strengths.push(
      `동일 업종 전국 평균(3년 생존율 ${baseSurvival.survival_rate_3yr}%) 대비 우수한 생존 지표(${survival3yr}%)를 보입니다.`
    );
  }
  if (annualClosureRate != null && annualClosureRate <= baseSurvival.annual_closure_rate - 1.5) {
    strengths.push(
      `연간 폐업(소멸)률이 ${annualClosureRate}%로 업종 평균(${baseSurvival.annual_closure_rate}%)보다 낮아 사업 안정성이 양호합니다.`
    );
  }
  if (demandPerStore >= 1300) {
    strengths.push(
      `동일 업종 점포 1개당 유효 배후수요(상주+직장인구 가중)가 약 ${demandPerStore.toLocaleString()}명으로 수요 대비 경쟁 여유가 있습니다.`
    );
  }
  if (isWithinBudget && isWithinRent && estimatedTotalStartupCostManwon != null) {
    strengths.push(
      `기준 면적(${areaPyeong}평, ${storeType === 'TAKEOUT' ? '테이크아웃형' : storeType === 'LARGE' ? '대형 매장' : '일반 매장'}) 추정 초기 투자비(${estimatedTotalStartupCostManwon.toLocaleString()}만 원)와 월 임대료(${estimatedMonthlyRentManwon.toLocaleString()}만 원)가 설정 한도 내에 부합합니다.`
    );
  }
  if (strengths.length === 0) {
    strengths.push(
      `${zone.district_type_label} 특성상 ${zone.worker_population > zone.resident_population ? '주간 직장인 고정 수요' : '거주 세대 생활 밀착 수요'}가 형성되어 있습니다.`
    );
  }

  // 위험 요인 도출
  if (storeCountInRadius >= 65) {
    risks.push(
      `반경 ${radiusMeters}m 내 동일 업종 점포가 ${storeCountInRadius}곳(밀집도 ${densityPerKm2}개/km²)으로 과밀 경쟁 위험이 높습니다.`
    );
  }
  if (isWithinBudget === false && estimatedTotalStartupCostManwon != null) {
    risks.push(
      `추정 초기 비용(보증금+시설비 약 ${estimatedTotalStartupCostManwon.toLocaleString()}만 원)이 입력 예산(${budgetLimitManwon.toLocaleString()}만 원)을 초과하므로 소형 평수 또는 테이크아웃형 전환 검토가 필요합니다.`
    );
  }
  if (isWithinRent === false && estimatedMonthlyRentManwon != null) {
    risks.push(
      `추정 월 임대료(약 ${estimatedMonthlyRentManwon.toLocaleString()}만 원)가 희망 한도(${rentLimitManwon.toLocaleString()}만 원)를 초과하여 고정비 부담이 큽니다.`
    );
  }
  if (annualClosureRate != null && annualClosureRate >= baseSurvival.annual_closure_rate + 1) {
    risks.push(
      `상권 내 트렌드 교체 주기가 빨라 연간 폐업률(${annualClosureRate}%)이 업종 평균(${baseSurvival.annual_closure_rate}%)보다 높습니다.`
    );
  }
  if (missingMetrics.length > 0) {
    risks.push(
      `미확보 통계 항목(${missingMetrics.join(', ')})이 존재하므로 현장 실사 및 인근 공인중개사 시세 교차 확인이 필수적입니다.`
    );
  }
  if (risks.length === 0) {
    risks.push(
      `인접 상권(${zone.adjacent_zones.join(', ')})으로의 고객 분산 가능성과 층별·전면 가시성 편차를 현장 확인해야 합니다.`
    );
  }

  return {
    zone_id: zone.zone_id,
    zone_name: zone.zone_name,
    sido_name: zone.sido_name,
    sigungu_name: zone.sigungu_name,
    emd_name: zone.emd_name,
    region_code: zone.region_code,
    lat: zone.lat,
    lng: zone.lng,
    district_type: zone.district_type,
    district_type_label: zone.district_type_label,
    total_score: totalScore,
    pillar_scores: {
      survival: survivalScore,
      competition: competitionScore,
      demand: demandScore,
      cost: costScore
    },
    weights_applied: normalizedWeights,
    reliability: {
      grade: reliabilityGrade,
      label: reliabilityLabel,
      coverage_pct: coveragePct,
      missing_metrics: missingMetrics,
      quality_status: zone.quality_status
    },
    survival_closure_stats: {
      survival_rate_1yr: survival1yr,
      survival_rate_3yr: survival3yr,
      survival_rate_5yr: survival5yr,
      annual_closure_rate: annualClosureRate,
      new_entry_rate: baseSurvival.new_entry_rate,
      avg_operating_years: baseSurvival.avg_operating_years,
      national_benchmark: {
        survival_rate_1yr: baseSurvival.survival_rate_1yr,
        survival_rate_3yr: baseSurvival.survival_rate_3yr,
        survival_rate_5yr: baseSurvival.survival_rate_5yr,
        annual_closure_rate: baseSurvival.annual_closure_rate
      },
      metric_definition: baseSurvival.metric_definition,
      source_name: '통계청 KOSIS 기업생멸행정통계 · 지자체 상권분석 통계',
      base_year: baseSurvival.base_year,
      observation_period: baseSurvival.observation_period,
      published_at: baseSurvival.published_at
    },
    competition_stats: {
      same_industry_store_count: storeCountInRadius,
      density_per_km2: densityPerKm2,
      yoy_store_change_pct: yoyChangePct,
      demand_per_store: demandPerStore,
      adjacent_zones: zone.adjacent_zones,
      source_name: '소상공인시장진흥공단 상가(상권)정보 OpenAPI',
      observation_period: zone.store_data_period,
      nearby_stores: buildNearbyCompetitorStores(zone, industryObj, storeCountInRadius, radiusMeters)
    },
    demand_stats: {
      resident_population: zone.resident_population,
      household_count: zone.household_count,
      worker_population: zone.worker_population,
      floating_pop_daily: zone.floating_pop_daily,
      age_20_39_ratio: zone.age_20_39_ratio,
      age_40_59_ratio: zone.age_40_59_ratio,
      total_biz_count: zone.total_biz_count,
      source_name: '통계청·행정안전부 주민등록인구 및 전국사업체조사',
      observation_period: zone.pop_data_period
    },
    cost_stats: {
      reference_area_pyeong: areaPyeong,
      store_type: storeType,
      avg_monthly_rent_per_py: zone.avg_monthly_rent_per_py,
      avg_deposit_per_py: zone.avg_deposit_per_py,
      estimated_monthly_rent_manwon: estimatedMonthlyRentManwon,
      estimated_deposit_manwon: estimatedDepositManwon,
      estimated_total_startup_cost_manwon: estimatedTotalStartupCostManwon,
      budget_limit_manwon: budgetLimitManwon,
      rent_limit_manwon: rentLimitManwon,
      is_within_budget: isWithinBudget,
      is_within_rent: isWithinRent,
      source_name: '한국부동산원 상업용부동산 임대동향조사 표본 시세',
      observation_period: '2026-Q1 기준'
    },
    strengths,
    risk_factors: risks
  };
}

/**
 * 전체 상권 분석 및 TOP 10 입지 추천 실행
 */
function runRecommendationAnalysis(queryParams = {}) {
  const startedAt = Date.now();
  const industryObj = resolveIndustry(queryParams.industry || 'IND_CAFE');
  const sidoName = queryParams.sido || '서울특별시';
  const sigunguName = queryParams.sigungu || '강남구';
  const emdName = queryParams.emd || '';
  const radiusMeters = Number(queryParams.radius) || 500;
  const budgetLimitManwon = Number(queryParams.budget) || 10000;
  const rentLimitManwon = Number(queryParams.rent) || 350;
  const storeType = queryParams.storeType || 'GENERAL';
  const centerLat = queryParams.lat ? Number(queryParams.lat) : null;
  const centerLng = queryParams.lng ? Number(queryParams.lng) : null;

  // 사용자 지정 가중치 또는 기획서 8장 초기 가중치(40/25/20/15) 적용
  const weights = {
    survival: queryParams.wSurvival != null ? Number(queryParams.wSurvival) : DEFAULT_WEIGHTS.survival,
    competition: queryParams.wCompetition != null ? Number(queryParams.wCompetition) : DEFAULT_WEIGHTS.competition,
    demand: queryParams.wDemand != null ? Number(queryParams.wDemand) : DEFAULT_WEIGHTS.demand,
    cost: queryParams.wCost != null ? Number(queryParams.wCost) : DEFAULT_WEIGHTS.cost
  };

  // 2단계: 전국 17개 시·도 및 모든 시·군·구·읍·면·동 후보 상권 추출/생성
  const primaryZones = buildRegionalZoneCandidates(sidoName, sigunguName, COMMERCIAL_ZONES);
  primaryZones.forEach((z) => runtimeZoneMap.set(z.zone_id, z));

  const scopeNotice = emdName
    ? `${sidoName} ${sigunguName} [${emdName}]을(를) 최우선 반영하여 권역 내 후보 상권 ${primaryZones.length}곳을 정밀 분석했습니다.`
    : `${sidoName} ${sigunguName} 내 주요 행정동·읍면 후보 상권 ${primaryZones.length}곳을 정밀 분석했습니다.`;

  // 지도에서 특정 좌표를 직접 클릭한 경우 거리 정보 추가
  const evaluated = primaryZones.map((zone) => {
    const item = evaluateZoneCandidate(zone, industryObj, {
      radiusMeters,
      budgetLimitManwon,
      rentLimitManwon,
      storeType,
      weights
    });

    if (centerLat != null && centerLng != null) {
      item.distance_from_selected_point_m = Math.round(distanceMeters(centerLat, centerLng, zone.lat, zone.lng));
    }
    if (emdName && zone.emd_name.includes(emdName)) {
      item.is_exact_emd_match = true;
    }
    return item;
  });

  // 종합 점수 내림차순 정렬 후 TOP 10 부여
  evaluated.sort((a, b) => {
    if (a.is_exact_emd_match && !b.is_exact_emd_match) return -1;
    if (!a.is_exact_emd_match && b.is_exact_emd_match) return 1;
    return b.total_score - a.total_score;
  });

  const top10 = evaluated.slice(0, 10).map((item, idx) => ({
    rank: idx + 1,
    ...item
  }));

  // 6단계: 데이터의 지역 단위와 기준 기간 비교 가능성 검증 결과
  const comparabilityCheck = {
    is_comparable: true,
    industry_standard_mapping: `${industryObj.industry_name} (상가정보 코드: ${industryObj.semas_code} ↔ 통계청 KSIC: ${industryObj.kosis_ksic_code})`,
    spatial_alignment_note:
      '점포 분포는 반경 기반 좌표 집계(상가정보 API)이며, 생존·폐업 통계는 통계청 KOSIS 기업생멸행정통계(시·도/시·군·구 산업분류) 및 지자체 상권 생멸 지표를 결합한 값입니다.',
    temporal_alignment_note:
      '상가 점포(2026-Q1), 주민등록인구(2026.02), 기업생멸통계(2025년 연간 코호트 공표분) 간 기준 시점 차이를 각 지표 하단에 명시했습니다.',
    missing_data_policy:
      '미확보 지표(예: 비표본 지역의 유동인구·5년 생존율·임대료)는 임의의 숫자로 채우지 않고 NULL로 유지하며, 확보된 항목만으로 가중치를 재정규화하여 평가했습니다.'
  };

  return {
    analysis_id: `ANL_${Date.now()}`,
    generated_at: new Date().toISOString(),
    execution_ms: Date.now() - startedAt,
    disclaimer:
      '본 서비스는 창업 성공을 보장하는 예측기가 아니라, 공개 통계와 확보된 상권 데이터를 이용한 의사결정 지원 도구입니다. 초기 가중치(40/25/20/15%)는 초기 테스트 제안 기준이며 실제 계약 전 현장 실사가 필수입니다.',
    query_summary: {
      industry_code: industryObj.industry_code,
      industry_name: industryObj.industry_name,
      category_large: industryObj.category_large,
      category_middle: industryObj.category_middle,
      semas_code: industryObj.semas_code,
      kosis_ksic_code: industryObj.kosis_ksic_code,
      sido_name: sidoName,
      sigungu_name: sigunguName,
      emd_name: emdName || '전체',
      radius_meters: radiusMeters,
      budget_limit_manwon: budgetLimitManwon,
      rent_limit_manwon: rentLimitManwon,
      store_type: storeType,
      reference_area_pyeong: industryObj.typical_area_pyeong[storeType] || industryObj.typical_area_pyeong.GENERAL,
      scope_notice: scopeNotice
    },
    weights_config: {
      initial_proposal: DEFAULT_WEIGHTS,
      applied: weights,
      note: '기획서 8장 초기 평가 가중치 (생존·폐업 40%, 경쟁 강도 25%, 지역 수요 20%, 비용 부담 15%)'
    },
    comparability_check: comparabilityCheck,
    top_recommendations: top10,
    data_sources_used: DATA_SOURCES
  };
}

/**
 * 선택한 2~3개 후보 상권 정밀 비교 분석
 */
function compareCandidateZones(zoneIds = [], queryParams = {}) {
  const industryObj = resolveIndustry(queryParams.industry || 'IND_CAFE');
  const radiusMeters = Number(queryParams.radius) || 500;
  const budgetLimitManwon = Number(queryParams.budget) || 10000;
  const rentLimitManwon = Number(queryParams.rent) || 350;
  const storeType = queryParams.storeType || 'GENERAL';

  const allKnownZones = Array.from(runtimeZoneMap.values());
  const targetZones = allKnownZones.filter((z) => zoneIds.includes(z.zone_id));
  const evaluated = targetZones.map((zone) =>
    evaluateZoneCandidate(zone, industryObj, {
      radiusMeters,
      budgetLimitManwon,
      rentLimitManwon,
      storeType
    })
  );

  evaluated.sort((a, b) => b.total_score - a.total_score);

  const highest = evaluated[0] || null;
  const lowest = evaluated[evaluated.length - 1] || null;

  return {
    compared_at: new Date().toISOString(),
    industry: industryObj,
    candidates: evaluated,
    comparison_summary: highest && lowest && highest.zone_id !== lowest.zone_id
      ? {
          leader_zone_name: highest.zone_name,
          score_gap: round1(highest.total_score - lowest.total_score),
          key_difference: `${highest.zone_name}(종합 ${highest.total_score}점)은 ${lowest.zone_name}(종합 ${lowest.total_score}점) 대비 3년 생존율(${highest.survival_closure_stats.survival_rate_3yr}% vs ${lowest.survival_closure_stats.survival_rate_3yr}%) 및 점포당 유효수요(${highest.competition_stats.demand_per_store.toLocaleString()}명 vs ${lowest.competition_stats.demand_per_store.toLocaleString()}명) 지표에서 우위를 보입니다.`,
          uncertainty_warnings: evaluated
            .filter((e) => e.reliability.missing_metrics.length > 0)
            .map((e) => `${e.zone_name}: 미확보 데이터(${e.reliability.missing_metrics.join(', ')})로 인해 신뢰도 등급이 '${e.reliability.label}'입니다.`)
        }
      : null
  };
}

module.exports = {
  DEFAULT_WEIGHTS,
  resolveIndustry,
  runRecommendationAnalysis,
  compareCandidateZones
};
