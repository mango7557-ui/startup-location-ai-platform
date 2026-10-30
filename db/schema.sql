-- ============================================================================
-- 전국 업종별 창업 입지 추천 플랫폼 (창업입지 AI)
-- PostgreSQL 15+ & PostGIS 3+ 데이터베이스 스키마
-- 설계 원칙:
--   1. 모든 통계·점포 데이터는 출처(source_id), 기준연도(base_year), 관측기간(observation_period),
--      공표일(published_at), 수집일(collected_at), 품질상태(quality_status)를 함께 저장한다.
--   2. 폐업률과 생존율은 정의와 기준이 다르므로 컬럼을 명확히 분리하고 혼용하지 않는다.
--   3. 결측 데이터는 NULL로 유지하며 임의 추정값으로 채우지 않는다.
--   4. 사업자 상태 이력은 최초 수집 시점 이후부터 기록하며 과거 이력을 임의 소급 생성하지 않는다.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ----------------------------------------------------------------------------
-- 1. data_sources (외부 데이터 출처, 이용 조건, 갱신 주기 관리)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_sources (
    source_id            VARCHAR(50) PRIMARY KEY,
    provider_name       VARCHAR(120) NOT NULL,           -- 제공기관 (예: 소상공인시장진흥공단, 통계청 KOSIS, 국세청)
    dataset_name        VARCHAR(200) NOT NULL,           -- 데이터셋/API 명칭
    official_url        TEXT NOT NULL,                   -- 공식 안내 URL
    api_endpoint        TEXT,                            -- 호출 엔드포인트
    update_cycle        VARCHAR(60) NOT NULL,            -- 갱신 주기 (분기별, 연 1회, 실시간 등)
    Spatial_granularity VARCHAR(60) NOT NULL,            -- 제공 지역 단위 (전국/시도/시군구/읍면동/좌표)
    terms_of_use        TEXT NOT NULL,                   -- 이용 약관 및 재배포 조건
    daily_quota_limit   INTEGER DEFAULT 10000,           -- 일일 호출 한도
    last_verified_at    TIMESTAMPTZ,                     -- 마지막 연결 정상 확인 시각
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2. industry_codes (표준 업종 코드 관리 - 상권정보 대/중/소분류 ↔ 표준산업분류 매핑)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS industry_codes (
    industry_code       VARCHAR(20) PRIMARY KEY,         -- 내부 표준 업종 코드 (예: IND_CAFE)
    industry_name       VARCHAR(100) NOT NULL,           -- 표시 업종명 (예: 커피전문점/카페)
    category_large      VARCHAR(60) NOT NULL,            -- 대분류 (음식, 소매, 생활서비스, 교육/여가 등)
    category_middle     VARCHAR(60) NOT NULL,            -- 중분류
    semas_code          VARCHAR(20),                     -- 소상공인시장진흥공단 상권업종 소분류 코드 (예: I21201)
    kosis_ksic_code     VARCHAR(20),                     -- 통계청 표준산업분류(KSIC) 매핑 코드 (예: I5622)
    typical_area_pyeong NUMERIC(5,1),                    -- 기준 매장 면적(평)
    keywords            TEXT[],                          -- 검색 유의어 배열
    is_active           BOOLEAN DEFAULT TRUE,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3. region_boundaries (전국 행정구역 코드 및 PostGIS 공간 경계)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS region_boundaries (
    region_code         VARCHAR(10) PRIMARY KEY,         -- 행정표준코드 (법정동/행정동 10자리 또는 시군구 5자리)
    sido_name           VARCHAR(40) NOT NULL,            -- 시·도 명 (예: 서울특별시)
    sigungu_name        VARCHAR(60),                     -- 시·군·구 명 (예: 강남구)
    emd_name            VARCHAR(60),                     -- 읍·면·동 명 (예: 역삼1동)
    region_level         VARCHAR(20) NOT NULL CHECK (region_level IN ('SIDO', 'SIGUNGU', 'EMD', 'COMMERCIAL_ZONE')),
    center_lat          DOUBLE PRECISION NOT NULL,
    center_lng          DOUBLE PRECISION NOT NULL,
    center_geom         GEOGRAPHY(POINT, 4326),          -- 중심점 좌표
    boundary_geom       GEOGRAPHY(MULTIPOLYGON, 4326),   -- 행정구역/상권 다각형 경계
    source_id           VARCHAR(50) REFERENCES data_sources(source_id),
    base_year           INTEGER NOT NULL,
    collected_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_region_boundaries_geom ON region_boundaries USING GIST (center_geom);
CREATE INDEX IF NOT EXISTS idx_region_boundaries_poly ON region_boundaries USING GIST (boundary_geom);
CREATE INDEX IF NOT EXISTS idx_region_boundaries_names ON region_boundaries (sido_name, sigungu_name, emd_name);

-- ----------------------------------------------------------------------------
-- 4. stores (전국 상가·점포 마스터 테이블)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stores (
    store_id            VARCHAR(40) PRIMARY KEY,         -- 상가업소번호 (공공데이터 원본 ID)
    store_name          VARCHAR(150) NOT NULL,           -- 상호명
    branch_name         VARCHAR(100),                    -- 지점명
    industry_code       VARCHAR(20) NOT NULL REFERENCES industry_codes(industry_code),
    semas_raw_code      VARCHAR(20),                     -- 원본 상권업종소분류코드
    region_code         VARCHAR(10) REFERENCES region_boundaries(region_code),
    road_address        TEXT NOT NULL,                   -- 도로명주소
    jibun_address       TEXT,                            -- 지번주소
    lat                 DOUBLE PRECISION NOT NULL,
    lng                 DOUBLE PRECISION NOT NULL,
    geom                GEOGRAPHY(POINT, 4326) NOT NULL, -- PostGIS 공간 검색용 포인트
    floor_info          VARCHAR(30),                     -- 층정보
    store_type          VARCHAR(30) DEFAULT 'GENERAL',   -- GENERAL(일반), TAKEOUT(테이크아웃), LARGE(대형)
    biz_reg_no_masked   VARCHAR(20),                     -- 마스킹된 사업자번호 (선택적 검증용, 개인정보 보호)
    source_id           VARCHAR(50) NOT NULL REFERENCES data_sources(source_id),
    base_year           INTEGER NOT NULL,
    observation_period  VARCHAR(40) NOT NULL,            -- 예: '2025-Q4'
    published_at        DATE,
    collected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    quality_status      VARCHAR(20) NOT NULL DEFAULT 'VERIFIED'
                        CHECK (quality_status IN ('VERIFIED', 'PARTIAL', 'STALE', 'DUPLICATE_SUSPECT'))
);

CREATE INDEX IF NOT EXISTS idx_stores_geom ON stores USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_stores_industry_region ON stores (industry_code, region_code);

-- ----------------------------------------------------------------------------
-- 5. store_status_history (점포 상태 및 확인 가능한 폐업 이력)
-- 주의: 최초 수집 시점 이후 관측된 이력만 기록하며, 과거 폐업 이력을 소급 추정하지 않음
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS store_status_history (
    history_id          BIGSERIAL PRIMARY KEY,
    store_id            VARCHAR(40) NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
    observed_date       DATE NOT NULL,                   -- 상태 확인 기준일
    status_code         VARCHAR(30) NOT NULL             -- ACTIVE(계속사업자/영업중), SUSPENDED(휴업), CLOSED(폐업), UNKNOWN(미확인)
                        CHECK (status_code IN ('ACTIVE', 'SUSPENDED', 'CLOSED', 'UNKNOWN')),
    confirmed_closed_on DATE,                            -- 국세청 상태조회 등으로 실제 확인된 폐업일자 (미확인 시 NULL)
    verification_method VARCHAR(40) NOT NULL,            -- SEMAS_QUARTERLY_DIFF(상가정보 분기 비교) | NTS_BIZ_STATUS(국세청 상태조회)
    source_id           VARCHAR(50) NOT NULL REFERENCES data_sources(source_id),
    collected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_store_status_store_date ON store_status_history (store_id, observed_date DESC);

-- ----------------------------------------------------------------------------
-- 6. industry_stats (업종·지역·기간별 공식 생멸·생존·폐업 통계)
-- 주의: 생존율(신생 기업 중 일정 기간 후 생존 비율)과 폐업률(해당 연도 활동 기업 대비 소멸 비율)을 엄격히 구분
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS industry_stats (
    stat_id                 BIGSERIAL PRIMARY KEY,
    industry_code           VARCHAR(20) NOT NULL REFERENCES industry_codes(industry_code),
    region_code             VARCHAR(10) NOT NULL REFERENCES region_boundaries(region_code),
    region_granularity      VARCHAR(20) NOT NULL CHECK (region_granularity IN ('NATIONAL', 'SIDO', 'SIGUNGU', 'COMMERCIAL_ZONE')),
    industry_granularity    VARCHAR(30) NOT NULL,        -- KSIC_LARGE(대분류) | KSIC_MIDDLE(중분류) | SEMAS_SMALL(소분류)
    -- 생존율 지표 (통계청 기업생멸행정통계 기준: 신생기업의 N년 후 생존 비율, %)
    survival_rate_1yr       NUMERIC(5,2),                -- 1년 생존율 (%) - 미확보 시 NULL
    survival_rate_3yr       NUMERIC(5,2),                -- 3년 생존율 (%) - 미확보 시 NULL
    survival_rate_5yr       NUMERIC(5,2),                -- 5년 생존율 (%) - 미확보 시 NULL
    -- 폐업/소멸 지표 (연간 활동사업체 대비 폐업/소멸 사업체 비율, %)
    annual_closure_rate     NUMERIC(5,2),                -- 연간 폐업(소멸)률 (%) - 생존율의 단순 역수가 아님
    new_entry_rate          NUMERIC(5,2),                -- 연간 신생률 (%)
    active_biz_count        INTEGER,                     -- 기준 기간 활동 사업체 수
    closed_biz_count        INTEGER,                     -- 기준 기간 폐업(소멸) 사업체 수
    avg_operating_years     NUMERIC(4,1),                -- 평균 영업 기간(년) - 확보 시만 기록
    -- 통계 메타데이터 (필수)
    metric_definition       TEXT NOT NULL,               -- 생존율/폐업률 산출 공식 및 정의 설명
    source_id               VARCHAR(50) NOT NULL REFERENCES data_sources(source_id),
    base_year               INTEGER NOT NULL,            -- 통계 기준연도 (예: 2024)
    observation_period      VARCHAR(50) NOT NULL,        -- 관측기간 (예: '2024년 연간 (2019~2024 코호트)')
    published_at            DATE NOT NULL,               -- 통계 공표일
    collected_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    quality_status          VARCHAR(20) NOT NULL DEFAULT 'OFFICIAL'
                            CHECK (quality_status IN ('OFFICIAL', 'PARTIAL_COVERAGE', 'LOW_SAMPLE_WARNING')),
    UNIQUE (industry_code, region_code, base_year, observation_period)
);

-- ----------------------------------------------------------------------------
-- 7. region_stats (지역별 인구·가구·사업체·상권 수요 및 임대비용 지표)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS region_stats (
    region_stat_id          BIGSERIAL PRIMARY KEY,
    region_code             VARCHAR(10) NOT NULL REFERENCES region_boundaries(region_code),
    district_type           VARCHAR(30) NOT NULL         -- RESIDENTIAL(주거형), OFFICE(업무형), MIXED(혼합형), UNIVERSITY(대학/역세권), COMMERCIAL(중심상업)
                            CHECK (district_type IN ('RESIDENTIAL', 'OFFICE', 'MIXED', 'UNIVERSITY', 'COMMERCIAL')),
    resident_population     INTEGER,                     -- 주민등록 인구 수 (명)
    household_count         INTEGER,                     -- 가구 수 (세대)
    worker_population       INTEGER,                     -- 종사자(직장) 인구 수 (명)
    floating_pop_daily      INTEGER,                     -- 일평균 유동인구 (명, 공공 상권 데이터 확보 시만 기록, 미확보 시 NULL)
    age_20_39_ratio         NUMERIC(5,2),                -- 20~39세 인구 비중 (%)
    age_40_59_ratio         NUMERIC(5,2),                -- 40~59세 인구 비중 (%)
    total_biz_count         INTEGER,                     -- 전체 사업체 수
    -- 비용 지표 (한국부동산원/지자체 통상 상가 임대 시세 기준, 만원)
    avg_monthly_rent_per_py NUMERIC(8,2),                -- 평당 월평균 임대료 (만원/평, 미확보 시 NULL)
    avg_deposit_per_py      NUMERIC(8,2),                -- 평당 평균 보증금 (만원/평, 미확보 시 NULL)
    estimated_interior_per_py NUMERIC(8,2),              -- 평당 평균 초기 인테리어/시설비 (만원/평)
    source_id               VARCHAR(50) NOT NULL REFERENCES data_sources(source_id),
    base_year               INTEGER NOT NULL,
    observation_period      VARCHAR(50) NOT NULL,
    published_at            DATE NOT NULL,
    collected_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    quality_status          VARCHAR(20) NOT NULL DEFAULT 'OFFICIAL'
                            CHECK (quality_status IN ('OFFICIAL', 'PARTIAL_COVERAGE', 'MISSING_COST_DATA'))
);

-- ----------------------------------------------------------------------------
-- 8. recommendation_results (사용자 조건별 입지 추천 산출 이력 및 분석 근거)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recommendation_results (
    result_id               UUID PRIMARY KEY,
    industry_code           VARCHAR(20) NOT NULL REFERENCES industry_codes(industry_code),
    sido_name               VARCHAR(40) NOT NULL,
    sigungu_name            VARCHAR(60),
    radius_meters           INTEGER NOT NULL DEFAULT 500,
    budget_limit_manwon     INTEGER,                     -- 초기 투자 예산 한도 (만원)
    rent_limit_manwon       INTEGER,                     -- 월 임대료 한도 (만원)
    store_type              VARCHAR(30) NOT NULL,
    weights_used            JSONB NOT NULL,              -- 적용된 가중치 (예: {"survival":0.40,"competition":0.25,"demand":0.20,"cost":0.15})
    ranked_candidates       JSONB NOT NULL,              -- 추천 후보 상권 TOP 10 및 항목별 점수/신뢰도/근거
    comparability_check     JSONB NOT NULL,              -- 지역 단위 및 기준 기간 비교 가능성 검증 결과
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 9. api_sync_logs (외부 공공데이터 API 수집·갱신·오류 이력 로그)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_sync_logs (
    log_id                  BIGSERIAL PRIMARY KEY,
    source_id               VARCHAR(50) NOT NULL REFERENCES data_sources(source_id),
    job_type                VARCHAR(60) NOT NULL,        -- INITIAL_LOAD | SCHEDULED_SYNC | MANUAL_VERIFY | BIZ_STATUS_CHECK
    status                  VARCHAR(20) NOT NULL CHECK (status IN ('SUCCESS', 'PARTIAL_ERROR', 'FAILED', 'RATE_LIMITED')),
    records_fetched         INTEGER DEFAULT 0,
    records_upserted        INTEGER DEFAULT 0,
    duplicates_removed      INTEGER DEFAULT 0,
    http_status_code        INTEGER,
    error_message           TEXT,                        -- 인증키는 절대 로그에 기록하지 않음
    started_at              TIMESTAMPTZ NOT NULL,
    finished_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
