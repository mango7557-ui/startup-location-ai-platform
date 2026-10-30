-- ============================================================================
-- 창업입지 AI - 초기 기준 데이터 시드 (db/seed.sql)
-- 공공데이터포털·KOSIS·한국부동산원 기준 출처 및 표준 업종 코드
-- ============================================================================

INSERT INTO data_sources (
    source_id, provider_name, dataset_name, official_url, api_endpoint,
    update_cycle, Spatial_granularity, terms_of_use, daily_quota_limit, last_verified_at, is_active
) VALUES
(
    'SRC_SEMAS_STORE',
    '소상공인시장진흥공단',
    '상가(상권)정보 OpenAPI',
    'https://www.data.go.kr/data/15012005/openapi.do',
    'https://apis.data.go.kr/B553077/api/open/sdsc2',
    '분기별 (연 4회)',
    '개별 점포 좌표 (위·경도) 및 행정동/법정동',
    '공공누리 제1유형 (출처표시 시 상업적 이용 가능)',
    10000,
    '2026-10-30 08:00:00+09',
    TRUE
),
(
    'SRC_KOSIS_SURVIVAL',
    '통계청 (KOSIS 국가통계포털)',
    '기업생멸행정통계 및 일자리행정통계 (산업·지역별 활동·신생·소멸 및 1·3·5년 생존율)',
    'https://kosis.kr/openapi/index/index.jsp',
    'https://kosis.kr/openapi/Param/statisticsParameterData.do',
    '연 1회 (매년 12월 공표)',
    '전국 / 시·도 / 시·군·구 (산업중분류·대분류)',
    '출처 및 기준연도 명시 필수, 생존율과 폐업(소멸)률 정의 구분 표기',
    10000,
    '2026-10-30 08:05:00+09',
    TRUE
),
(
    'SRC_KOSIS_POP_BIZ',
    '통계청·행정안전부 (KOSIS)',
    '주민등록인구현황 및 전국사업체조사 (인구·가구·종사자 수)',
    'https://kosis.kr/openapi/index/index.jsp',
    'https://kosis.kr/openapi/Param/statisticsParameterData.do',
    '월별(인구) / 연 1회(사업체)',
    '읍·면·동 및 시·군·구',
    '공공누리 제1유형 (출처 및 기준시점 명시)',
    10000,
    '2026-10-30 08:10:00+09',
    TRUE
),
(
    'SRC_NTS_BIZ_STATUS',
    '국세청',
    '사업자등록정보 진위확인 및 상태조회 서비스',
    'https://www.data.go.kr/data/15081808/openapi.do',
    'https://api.odcloud.kr/api/nts-businessman/v1/status',
    '실시간 조회 (단건/100건 배치)',
    '개별 사업자등록번호 단위',
    '사업자등록번호를 알고 있는 대상의 현재 상태(계속/휴업/폐업) 확인 전용. 전국 과거 폐업 이력 일괄 추출 불가.',
    100000,
    '2026-10-30 08:15:00+09',
    TRUE
),
(
    'SRC_REB_RENT',
    '한국부동산원·지자체 상권분석서비스',
    '상업용부동산 임대동향조사 (표본 상권 임대료·보증금 지표)',
    'https://www.data.go.kr/',
    'https://www.reb.or.kr/r-one/openapi',
    '분기별 (연 4회)',
    '주요 상권 단위 (비표본 지역은 결측 처리)',
    '출처 표시 필수, 비표본 상권은 임의 추정 금지',
    5000,
    '2026-10-30 08:20:00+09',
    TRUE
)
ON CONFLICT (source_id) DO NOTHING;

INSERT INTO industry_codes (
    industry_code, industry_name, category_large, category_middle,
    semas_code, kosis_ksic_code, typical_area_pyeong, keywords
) VALUES
('IND_CAFE',      '커피전문점·카페',     '음식점업',   '비알코올 음료점업', 'I21201', 'I5622', 15.0, ARRAY['커피숍', '카페', '에스프레소', '디저트카페', '테이크아웃커피']),
('IND_KOREAN',    '한식 일반음식점',     '음식점업',   '한식 음식점업',     'I20101', 'I5611', 25.0, ARRAY['한식', '백반', '국밥', '고기집', '삼겹살', '식당']),
('IND_CHICKEN',   '치킨·호프 전문점',    '음식점업',   '기타 간이음식점업', 'I21006', 'I5619', 18.0, ARRAY['치킨', '통닭', '호프', '맥주', '배달치킨']),
('IND_BAKERY',    '제과·베이커리',       '음식점업',   '제과점업',          'I21001', 'I5619', 18.0, ARRAY['빵집', '베이커리', '제과점', '케이크']),
('IND_CONV',      '편의점',              '소매업',     '체인화 편의점',     'G20405', 'G4712', 20.0, ARRAY['편의점', '24시마트', 'CVS']),
('IND_BEAUTY',    '미용실·헤어샵',       '생활서비스', '두발 미용업',       'S20701', 'S9611', 15.0, ARRAY['미용실', '헤어샵', '바버샵', '네일']),
('IND_FITNESS',   '피트니스·필라테스',   '여가·스포츠','체력단련시설 운영업','R10307', 'R9113', 45.0, ARRAY['헬스장', '피트니스', '필라테스', '요가', 'PT샵']),
('IND_ACADEMY',   '보습·입시·외국어학원','교육서비스', '일반 교습학원',     'P10501', 'P8550', 35.0, ARRAY['학원', '교습소', '영어학원', '수학학원', '공부방'])
ON CONFLICT (industry_code) DO NOTHING;
