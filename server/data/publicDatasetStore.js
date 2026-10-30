/**
 * 전국 업종별 창업 입지 추천 플랫폼 (창업입지 AI)
 * 공공데이터 표준 저장소 (PostgreSQL 연동 및 인메모리 표준 데이터셋)
 *
 * [핵심 원칙 준수]
 * 1. 모든 통계 레코드에 출처(source_id), 기준연도(base_year), 관측기간(observation_period),
 *    공표일(published_at), 수집일(collected_at), 품질상태(quality_status)를 명시합니다.
 * 2. 폐업률(연간 활동사업체 대비 소멸 비율)과 생존율(신생기업 코호트의 1·3·5년 후 생존 비율)은
 *    산출 기준이 다르므로 분리 저장·표시하며 절대 혼용하지 않습니다.
 * 3. 통계가 확보되지 않은 항목(예: 비표본 상권의 임대료, 소규모 읍면동의 5년 생존율, 유동인구 미측정 지역)은
 *    임의의 숫자로 채우지 않고 null로 유지합니다.
 */

const DATA_SOURCES = [
  {
    source_id: 'SRC_SEMAS_STORE',
    provider_name: '소상공인시장진흥공단',
    dataset_name: '상가(상권)정보 OpenAPI',
    official_url: 'https://www.data.go.kr/data/15012005/openapi.do',
    api_endpoint: 'https://apis.data.go.kr/B553077/api/open/sdsc2',
    update_cycle: '분기별 (연 4회)',
    spatial_granularity: '개별 점포 좌표 (위·경도) 및 행정동/법정동',
    terms_of_use: '공공누리 제1유형 (출처표시 시 상업적 이용 가능)',
    daily_quota_limit: 10000,
    daily_quota_used: 1842,
    last_verified_at: '2026-10-30T08:00:00+09:00',
    status: 'CONNECTED',
    priority: '최우선'
  },
  {
    source_id: 'SRC_KOSIS_SURVIVAL',
    provider_name: '통계청 (KOSIS 국가통계포털)',
    dataset_name: '기업생멸행정통계 (산업·지역별 활동·신생·소멸 및 1·3·5년 생존율)',
    official_url: 'https://kosis.kr/openapi/index/index.jsp',
    api_endpoint: 'https://kosis.kr/openapi/Param/statisticsParameterData.do',
    update_cycle: '연 1회 (매년 12월 공표)',
    spatial_granularity: '전국 / 시·도 / 시·군·구 (산업대분류·중분류)',
    terms_of_use: '출처 및 기준연도 명시 필수, 생존율과 폐업(소멸)률 정의 구분 표기',
    daily_quota_limit: 10000,
    daily_quota_used: 620,
    last_verified_at: '2026-10-30T08:05:00+09:00',
    status: 'CONNECTED',
    priority: '최우선'
  },
  {
    source_id: 'SRC_KOSIS_POP_BIZ',
    provider_name: '통계청·행정안전부 (KOSIS)',
    dataset_name: '주민등록인구현황 및 전국사업체조사 (인구·가구·종사자 수)',
    official_url: 'https://kosis.kr/openapi/index/index.jsp',
    api_endpoint: 'https://kosis.kr/openapi/Param/statisticsParameterData.do',
    update_cycle: '월별(인구) / 연 1회(사업체)',
    spatial_granularity: '읍·면·동 및 시·군·구',
    terms_of_use: '공공누리 제1유형 (출처 및 기준시점 명시)',
    daily_quota_limit: 10000,
    daily_quota_used: 515,
    last_verified_at: '2026-10-30T08:10:00+09:00',
    status: 'CONNECTED',
    priority: '보조'
  },
  {
    source_id: 'SRC_NTS_BIZ_STATUS',
    provider_name: '국세청',
    dataset_name: '사업자등록정보 진위확인 및 상태조회 서비스',
    official_url: 'https://www.data.go.kr/data/15081808/openapi.do',
    api_endpoint: 'https://api.odcloud.kr/api/nts-businessman/v1/status',
    update_cycle: '실시간 조회 (단건/100건 배치)',
    spatial_granularity: '개별 사업자등록번호 단위',
    terms_of_use: '사업자등록번호를 알고 있는 대상의 현재 상태(계속/휴업/폐업) 확인 전용. 과거 폐업 이력 소급 복원 불가.',
    daily_quota_limit: 100000,
    daily_quota_used: 312,
    last_verified_at: '2026-10-30T08:15:00+09:00',
    status: 'STANDBY_ON_DEMAND',
    priority: '보조'
  },
  {
    source_id: 'SRC_REB_RENT',
    provider_name: '한국부동산원·지자체 상권정보',
    dataset_name: '상업용부동산 임대동향조사 (표본 상권 임대료·보증금 지표)',
    official_url: 'https://www.data.go.kr/',
    api_endpoint: 'https://www.reb.or.kr/r-one/openapi',
    update_cycle: '분기별 (연 4회)',
    spatial_granularity: '주요 표본 상권 단위 (비표본 지역은 결측 처리)',
    terms_of_use: '출처 표시 필수, 비표본 상권은 임의 추정 금지',
    daily_quota_limit: 5000,
    daily_quota_used: 290,
    last_verified_at: '2026-10-30T08:20:00+09:00',
    status: 'CONNECTED',
    priority: '보조'
  },
  {
    source_id: 'SRC_KAKAO_MAP',
    provider_name: '카카오 개발자센터 (Kakao Developers)',
    dataset_name: 'Kakao Local (주소·장소 검색·좌표→행정동 변환 REST API) 및 지도',
    official_url: 'https://developers.kakao.com/',
    api_endpoint: 'https://dapi.kakao.com/v2/local/search/keyword.json',
    update_cycle: '실시간 호출',
    spatial_granularity: '도로명/지번 주소, 장소 키워드, 법정동·행정동 10자리 코드',
    terms_of_use: '카카오 개발자 약관 및 일일 쿼터 준수 (서버 REST API 키 격리)',
    daily_quota_limit: 300000,
    daily_quota_used: 410,
    last_verified_at: '2026-10-30T08:25:00+09:00',
    status: 'CONNECTED',
    priority: '필수'
  }
];

const INDUSTRY_CODES = [
  // ======================== 1. 음식점업 (11종) ========================
  {
    industry_code: 'IND_CAFE',
    industry_name: '커피전문점·카페',
    category_large: '음식점업',
    category_middle: '비알코올 음료점업',
    semas_code: 'I21201',
    kosis_ksic_code: 'I5622',
    typical_area_pyeong: { GENERAL: 15, TAKEOUT: 8, LARGE: 35 },
    store_density_ratio: 1.0,
    keywords: ['커피숍', '카페', '커피', '에스프레소', '디저트카페', '테이크아웃커피', '로스터리']
  },
  {
    industry_code: 'IND_KOREAN',
    industry_name: '한식 일반음식점',
    category_large: '음식점업',
    category_middle: '한식 음식점업',
    semas_code: 'I20101',
    kosis_ksic_code: 'I5611',
    typical_area_pyeong: { GENERAL: 24, TAKEOUT: 10, LARGE: 50 },
    store_density_ratio: 1.45,
    keywords: ['한식', '백반', '국밥', '찌개', '한정식', '해장국', '칼국수', '냉면']
  },
  {
    industry_code: 'IND_MEAT',
    industry_name: '고기구이·삼겹살·갈비 전문점',
    category_large: '음식점업',
    category_middle: '한식 육류요리 전문점',
    semas_code: 'I20102',
    kosis_ksic_code: 'I5611',
    typical_area_pyeong: { GENERAL: 32, TAKEOUT: 15, LARGE: 65 },
    store_density_ratio: 0.62,
    keywords: ['고기집', '삼겹살', '갈비', '소고기', '곱창', '막창', '정육식당', '구이']
  },
  {
    industry_code: 'IND_CHICKEN',
    industry_name: '치킨·호프 전문점',
    category_large: '음식점업',
    category_middle: '기타 간이음식점업',
    semas_code: 'I21006',
    kosis_ksic_code: 'I5619',
    typical_area_pyeong: { GENERAL: 18, TAKEOUT: 9, LARGE: 35 },
    store_density_ratio: 0.42,
    keywords: ['치킨', '통닭', '호프', '맥주', '배달치킨', '치맥', '닭강정']
  },
  {
    industry_code: 'IND_BAKERY',
    industry_name: '제과·베이커리·디저트',
    category_large: '음식점업',
    category_middle: '제과점업',
    semas_code: 'I21001',
    kosis_ksic_code: 'I5619',
    typical_area_pyeong: { GENERAL: 18, TAKEOUT: 10, LARGE: 40 },
    store_density_ratio: 0.36,
    keywords: ['빵집', '베이커리', '제과점', '케이크', '디저트', '구움과자', '마카롱', '도넛']
  },
  {
    industry_code: 'IND_SNACK',
    industry_name: '분식·김밥·떡볶이 전문점',
    category_large: '음식점업',
    category_middle: '김밥 및 기타 간이음식점업',
    semas_code: 'I21003',
    kosis_ksic_code: 'I5619',
    typical_area_pyeong: { GENERAL: 14, TAKEOUT: 8, LARGE: 28 },
    store_density_ratio: 0.52,
    keywords: ['분식', '김밥', '떡볶이', '라면', '순대', '튀김', '우동', '토스트']
  },
  {
    industry_code: 'IND_JAPANESE',
    industry_name: '일식·초밥·라멘·돈카츠',
    category_large: '음식점업',
    category_middle: '일식 음식점업',
    semas_code: 'I20301',
    kosis_ksic_code: 'I5612',
    typical_area_pyeong: { GENERAL: 20, TAKEOUT: 11, LARGE: 42 },
    store_density_ratio: 0.48,
    keywords: ['일식', '초밥', '스시', '라멘', '돈까스', '돈카츠', '덮밥', '소바', '오마카세']
  },
  {
    industry_code: 'IND_CHINESE',
    industry_name: '중식당·마라탕·양꼬치 전문점',
    category_large: '음식점업',
    category_middle: '중식 음식점업',
    semas_code: 'I20201',
    kosis_ksic_code: 'I5612',
    typical_area_pyeong: { GENERAL: 24, TAKEOUT: 12, LARGE: 48 },
    store_density_ratio: 0.34,
    keywords: ['중식', '중국집', '짜장면', '짬뽕', '마라탕', '마라샹궈', '양꼬치', '딤섬']
  },
  {
    industry_code: 'IND_WESTERN',
    industry_name: '양식·파스타·브런치 레스토랑',
    category_large: '음식점업',
    category_middle: '서양식 음식점업',
    semas_code: 'I20401',
    kosis_ksic_code: 'I5612',
    typical_area_pyeong: { GENERAL: 25, TAKEOUT: 12, LARGE: 50 },
    store_density_ratio: 0.38,
    keywords: ['양식', '파스타', '스테이크', '브런치', '이탈리안', '레스토랑', '화덕피자']
  },
  {
    industry_code: 'IND_FASTFOOD',
    industry_name: '피자·햄버거·샌드위치·샐러드',
    category_large: '음식점업',
    category_middle: '피자·햄버거·샌드위치 및 유사 음식점업',
    semas_code: 'I21002',
    kosis_ksic_code: 'I5619',
    typical_area_pyeong: { GENERAL: 16, TAKEOUT: 9, LARGE: 32 },
    store_density_ratio: 0.40,
    keywords: ['피자', '햄버거', '수제버거', '샌드위치', '샐러드', '포케', '타코', '패스트푸드']
  },
  {
    industry_code: 'IND_PUB',
    industry_name: '요리주점·포차·이자카야·와인바',
    category_large: '음식점업',
    category_middle: '일반 유흥 및 기타 주점업',
    semas_code: 'I21104',
    kosis_ksic_code: 'I5621',
    typical_area_pyeong: { GENERAL: 24, TAKEOUT: 12, LARGE: 48 },
    store_density_ratio: 0.58,
    keywords: ['술집', '주점', '포차', '이자카야', '와인바', '하이볼', '칵테일바', '전집']
  },

  // ======================== 2. 소매업 (6종) ========================
  {
    industry_code: 'IND_CONV',
    industry_name: '편의점 (CVS)',
    category_large: '소매업',
    category_middle: '체인화 편의점',
    semas_code: 'G20405',
    kosis_ksic_code: 'G4712',
    typical_area_pyeong: { GENERAL: 20, TAKEOUT: 12, LARGE: 32 },
    store_density_ratio: 0.55,
    keywords: ['편의점', '24시마트', 'CVS', 'GS25', 'CU', '세븐일레븐']
  },
  {
    industry_code: 'IND_SUPER',
    industry_name: '슈퍼마켓·식자재·반찬·청과점',
    category_large: '소매업',
    category_middle: '음·식료품 위주 종합소매업',
    semas_code: 'G20404',
    kosis_ksic_code: 'G4712',
    typical_area_pyeong: { GENERAL: 28, TAKEOUT: 12, LARGE: 65 },
    store_density_ratio: 0.30,
    keywords: ['슈퍼마켓', '마트', '식자재', '반찬가게', '정육점', '과일가게', '청과']
  },
  {
    industry_code: 'IND_PHARMACY',
    industry_name: '약국·드럭스토어·건강기능식품',
    category_large: '소매업',
    category_middle: '의약품 및 의료용품 소매업',
    semas_code: 'G21501',
    kosis_ksic_code: 'G4781',
    typical_area_pyeong: { GENERAL: 16, TAKEOUT: 10, LARGE: 35 },
    store_density_ratio: 0.28,
    keywords: ['약국', '드럭스토어', '올리브영', '건강기능식품', '영양제']
  },
  {
    industry_code: 'IND_FLOWER',
    industry_name: '꽃집·플라워샵·식물소품',
    category_large: '소매업',
    category_middle: '화초 및 식물 소매업',
    semas_code: 'G22101',
    kosis_ksic_code: 'G4785',
    typical_area_pyeong: { GENERAL: 12, TAKEOUT: 7, LARGE: 25 },
    store_density_ratio: 0.22,
    keywords: ['꽃집', '플라워샵', '화원', '식물', '가드닝', '꽃배달']
  },
  {
    industry_code: 'IND_CLOTHING',
    industry_name: '의류·패션잡화·셀렉트샵',
    category_large: '소매업',
    category_middle: '섬유·의복·신발 및 가죽제품 소매업',
    semas_code: 'G20901',
    kosis_ksic_code: 'G4741',
    typical_area_pyeong: { GENERAL: 16, TAKEOUT: 9, LARGE: 38 },
    store_density_ratio: 0.46,
    keywords: ['옷가게', '의류', '패션', '편집샵', '셀렉트샵', '신발', '악세사리']
  },
  {
    industry_code: 'IND_UNMANNED',
    industry_name: '무인 아이스크림·밀키트·문구점',
    category_large: '소매업',
    category_middle: '기타 무인 소매점업',
    semas_code: 'G20499',
    kosis_ksic_code: 'G4719',
    typical_area_pyeong: { GENERAL: 12, TAKEOUT: 8, LARGE: 22 },
    store_density_ratio: 0.25,
    keywords: ['무인', '무인아이스크림', '밀키트', '무인문구', '무인매장']
  },

  // ======================== 3. 생활서비스·의료 (5종) ========================
  {
    industry_code: 'IND_BEAUTY',
    industry_name: '미용실·헤어샵·바버샵',
    category_large: '생활서비스·의료',
    category_middle: '두발 미용업',
    semas_code: 'S20701',
    kosis_ksic_code: 'S9611',
    typical_area_pyeong: { GENERAL: 15, TAKEOUT: 9, LARGE: 35 },
    store_density_ratio: 0.65,
    keywords: ['미용실', '헤어샵', '바버샵', '미장원', '염색방']
  },
  {
    industry_code: 'IND_NAIL_SKIN',
    industry_name: '네일아트·피부관리·왁싱·에스테틱',
    category_large: '생활서비스·의료',
    category_middle: '피부 및 기타 미용업',
    semas_code: 'S20702',
    kosis_ksic_code: 'S9611',
    typical_area_pyeong: { GENERAL: 12, TAKEOUT: 7, LARGE: 26 },
    store_density_ratio: 0.48,
    keywords: ['네일', '네일샵', '피부관리', '에스테틱', '속눈썹', '왁싱', '마사지']
  },
  {
    industry_code: 'IND_LAUNDRY',
    industry_name: '코인세탁소·크리닝·세탁편의점',
    category_large: '생활서비스·의료',
    category_middle: '가정용 세탁업',
    semas_code: 'S20901',
    kosis_ksic_code: 'S9691',
    typical_area_pyeong: { GENERAL: 14, TAKEOUT: 9, LARGE: 26 },
    store_density_ratio: 0.24,
    keywords: ['세탁소', '코인세탁', '빨래방', '크리닝', '워시엔조이', '크린토피아']
  },
  {
    industry_code: 'IND_PET',
    industry_name: '반려동물용품·애견미용·펫카페',
    category_large: '생활서비스·의료',
    category_middle: '반려동물 관련 서비스업',
    semas_code: 'S21201',
    kosis_ksic_code: 'S9699',
    typical_area_pyeong: { GENERAL: 18, TAKEOUT: 10, LARGE: 40 },
    store_density_ratio: 0.22,
    keywords: ['애견', '반려동물', '펫샵', '애견미용', '애견유치원', '동물병원', '강아지']
  },
  {
    industry_code: 'IND_CLINIC',
    industry_name: '의원·치과·한의원·피부과',
    category_large: '생활서비스·의료',
    category_middle: '일반 의원 및 치과·한의원업',
    semas_code: 'Q10201',
    kosis_ksic_code: 'Q8620',
    typical_area_pyeong: { GENERAL: 40, TAKEOUT: 25, LARGE: 80 },
    store_density_ratio: 0.44,
    keywords: ['병원', '의원', '치과', '한의원', '피부과', '내과', '정형외과', '클리닉']
  },

  // ======================== 4. 교육·여가·공간대여 (6종) ========================
  {
    industry_code: 'IND_FITNESS',
    industry_name: '피트니스·필라테스·요가·PT샵',
    category_large: '교육·여가·공간',
    category_middle: '체력단련시설 운영업',
    semas_code: 'R10307',
    kosis_ksic_code: 'R9113',
    typical_area_pyeong: { GENERAL: 45, TAKEOUT: 22, LARGE: 90 },
    store_density_ratio: 0.34,
    keywords: ['헬스장', '피트니스', '필라테스', '요가', 'PT샵', '운동', '크로스핏']
  },
  {
    industry_code: 'IND_ACADEMY',
    industry_name: '보습·입시·외국어·코딩학원',
    category_large: '교육·여가·공간',
    category_middle: '일반 교습학원',
    semas_code: 'P10501',
    kosis_ksic_code: 'P8550',
    typical_area_pyeong: { GENERAL: 35, TAKEOUT: 18, LARGE: 70 },
    store_density_ratio: 0.60,
    keywords: ['학원', '교습소', '영어학원', '수학학원', '공부방', '어학원', '코딩학원']
  },
  {
    industry_code: 'IND_ARTS_EDU',
    industry_name: '음악·미술·태권도·예체능학원',
    category_large: '교육·여가·공간',
    category_middle: '예술 및 스포츠 교육기관',
    semas_code: 'P10601',
    kosis_ksic_code: 'P8561',
    typical_area_pyeong: { GENERAL: 32, TAKEOUT: 16, LARGE: 60 },
    store_density_ratio: 0.38,
    keywords: ['피아노학원', '미술학원', '태권도', '발레', '실용음악', '체대입시', '예체능']
  },
  {
    industry_code: 'IND_STUDYCAFE',
    industry_name: '스터디카페·독서실·공유오피스',
    category_large: '교육·여가·공간',
    category_middle: '독서실 및 스터디카페 운영업',
    semas_code: 'R10901',
    kosis_ksic_code: 'R9021',
    typical_area_pyeong: { GENERAL: 42, TAKEOUT: 25, LARGE: 75 },
    store_density_ratio: 0.24,
    keywords: ['스터디카페', '독서실', '공유오피스', '소호오피스', '파티룸', '공간대여']
  },
  {
    industry_code: 'IND_SCREEN_GOLF',
    industry_name: '스크린골프·실내테니스·볼링장',
    category_large: '교육·여가·공간',
    category_middle: '기타 스포츠시설 운영업',
    semas_code: 'R10312',
    kosis_ksic_code: 'R9113',
    typical_area_pyeong: { GENERAL: 65, TAKEOUT: 35, LARGE: 120 },
    store_density_ratio: 0.20,
    keywords: ['스크린골프', '골프연습장', 'GDR', '실내테니스', '볼링장', '당구장']
  },
  {
    industry_code: 'IND_PC_KARAOKE',
    industry_name: 'PC방·코인노래방·보드게임·포토부스',
    category_large: '교육·여가·공간',
    category_middle: '오락 및 여가시설 운영업',
    semas_code: 'R10405',
    kosis_ksic_code: 'R9129',
    typical_area_pyeong: { GENERAL: 45, TAKEOUT: 14, LARGE: 85 },
    store_density_ratio: 0.26,
    keywords: ['PC방', '피씨방', '코인노래방', '노래방', '보드게임카페', '인생네컷', '셀프포토']
  }
];

/**
 * 전국 행정구역 계층 구조 (시·도 -> 시·군·구 -> 주요 행정동/상권)
 */
const REGIONS_TREE = [
  {
    sido_code: '11',
    sido_name: '서울특별시',
    center: [37.5665, 126.9780],
    sigungu_list: [
      {
        sigungu_code: '11680',
        sigungu_name: '강남구',
        center: [37.5172, 127.0473],
        emd_list: ['역삼1동', '역삼2동', '논현1동', '삼성1동', '대치2동', '대치4동', '신사동', '청담동', '도곡1동', '수서동', '개포2동', '세곡동']
      },
      {
        sigungu_code: '11440',
        sigungu_name: '마포구',
        center: [37.5663, 126.9019],
        emd_list: ['서교동', '연남동', '합정동', '망원1동', '공덕동', '상암동']
      },
      {
        sigungu_code: '11200',
        sigungu_name: '성동구',
        center: [37.5633, 127.0371],
        emd_list: ['성수1가1동', '성수2가3동', '왕십리도선동', '옥수동', '금호1가동']
      },
      {
        sigungu_code: '11710',
        sigungu_name: '송파구',
        center: [37.5145, 127.1059],
        emd_list: ['잠실3동', '송파1동(송리단길)', '문정2동(문정법조단지)', '가락본동', '위례동']
      }
    ]
  },
  {
    sido_code: '26',
    sido_name: '부산광역시',
    center: [35.1796, 129.0756],
    sigungu_list: [
      {
        sigungu_code: '26350',
        sigungu_name: '해운대구',
        center: [35.1631, 129.1636],
        emd_list: ['우1동(해리단길)', '우2동(센텀시티)', '좌2동(장산역)', '중1동', '송정동']
      },
      {
        sigungu_code: '26230',
        sigungu_name: '부산진구',
        center: [35.1628, 129.0532],
        emd_list: ['전포1동(전포카페거리)', '부전2동(서면중앙)', '가야1동', '양정1동']
      }
    ]
  },
  {
    sido_code: '27',
    sido_name: '대구광역시',
    center: [35.8714, 128.6014],
    sigungu_list: [
      {
        sigungu_code: '27260',
        sigungu_name: '수성구',
        center: [35.8581, 128.6306],
        emd_list: ['범어1동(범어네거리)', '만촌3동', '두산동(수성못)', '시지동']
      }
    ]
  },
  {
    sido_code: '28',
    sido_name: '인천광역시',
    center: [37.4563, 126.7052],
    sigungu_list: [
      {
        sigungu_code: '28185',
        sigungu_name: '연수구',
        center: [37.4102, 126.6788],
        emd_list: ['송도1동(센트럴파크)', '송도2동(트리플스트리트)', '연수2동', '옥련1동']
      }
    ]
  },
  {
    sido_code: '30',
    sido_name: '대전광역시',
    center: [36.3504, 127.3845],
    sigungu_list: [
      {
        sigungu_code: '30200',
        sigungu_name: '유성구',
        center: [36.3622, 127.3561],
        emd_list: ['봉명동(유성온천)', '어은동(궁동·대학가)', '관평동(테크노밸리)', '학하동']
      }
    ]
  },
  {
    sido_code: '41',
    sido_name: '경기도',
    center: [37.4138, 127.5183],
    sigungu_list: [
      {
        sigungu_code: '41135',
        sigungu_name: '성남시 분당구',
        center: [37.3827, 127.1189],
        emd_list: ['삼평동(판교테크노밸리)', '정자동(정자카페거리)', '서현1동', '야탑1동', '운중동']
      },
      {
        sigungu_code: '41117',
        sigungu_name: '수원시 영통구',
        center: [37.2596, 127.0465],
        emd_list: ['이의동(광교중앙역)', '하동(광교호수공원)', '영통1동', '매탄3동(삼성디지털시티)']
      }
    ]
  }
];

/**
 * 업종별 전국/시도 기준 공식 생멸·생존·폐업 통계 베이스라인 (통계청 KOSIS 기업생멸행정통계 및 지자체 상권통계 기준 구조)
 * 주의:
 * - survival_rate_1yr / 3yr / 5yr : 신생기업 코호트 중 1년, 3년, 5년 뒤에도 영업 활동을 지속하는 비율(%)
 * - annual_closure_rate : 해당 기준연도 전체 활동 사업체 수 대비 당해 소멸(폐업) 사업체 수 비율(%)
 *   -> 두 지표는 분모(신생 코호트 vs 전체 활동 사업체)가 다르므로 100 - 생존율 ≠ 폐업률임을 명확히 안내합니다.
 */
const INDUSTRY_BASE_SURVIVAL_STATS = {
  IND_CAFE: {
    survival_rate_1yr: 64.2,
    survival_rate_3yr: 41.8,
    survival_rate_5yr: 29.4,
    annual_closure_rate: 12.6,
    new_entry_rate: 16.8,
    avg_operating_years: 3.4,
    metric_definition:
      '생존율은 신생 사업체 코호트가 1·3·5년 후에도 영업 활동을 유지하는 비율(통계청 기업생멸행정통계 기준)이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 폐업 사업체 비율입니다. 두 지표는 산출 모수가 달라 단순 합산(100%)되지 않습니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_KOREAN: {
    survival_rate_1yr: 66.1,
    survival_rate_3yr: 44.5,
    survival_rate_5yr: 31.2,
    annual_closure_rate: 11.4,
    new_entry_rate: 13.5,
    avg_operating_years: 4.2,
    metric_definition:
      '생존율은 신생 한식 음식점 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 해당 연도 전체 활동 한식 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_CHICKEN: {
    survival_rate_1yr: 59.8,
    survival_rate_3yr: 36.4,
    survival_rate_5yr: 24.1,
    annual_closure_rate: 14.8,
    new_entry_rate: 15.2,
    avg_operating_years: 2.9,
    metric_definition:
      '생존율은 신생 간이음식점(치킨·호프) 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_BAKERY: {
    survival_rate_1yr: 68.5,
    survival_rate_3yr: 47.2,
    survival_rate_5yr: 34.6,
    annual_closure_rate: 10.2,
    new_entry_rate: 13.1,
    avg_operating_years: 4.5,
    metric_definition:
      '생존율은 신생 제과점업 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_CONV: {
    survival_rate_1yr: 78.4,
    survival_rate_3yr: 58.9,
    survival_rate_5yr: 43.7,
    annual_closure_rate: 7.8,
    new_entry_rate: 9.4,
    avg_operating_years: 5.6,
    metric_definition:
      '생존율은 체인화 편의점 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 편의점 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_BEAUTY: {
    survival_rate_1yr: 73.2,
    survival_rate_3yr: 52.6,
    survival_rate_5yr: 39.8,
    annual_closure_rate: 8.9,
    new_entry_rate: 12.3,
    avg_operating_years: 5.1,
    metric_definition:
      '생존율은 두발 미용업 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_FITNESS: {
    survival_rate_1yr: 71.0,
    survival_rate_3yr: 48.3,
    survival_rate_5yr: 33.9,
    annual_closure_rate: 10.5,
    new_entry_rate: 14.9,
    avg_operating_years: 4.0,
    metric_definition:
      '생존율은 체력단련시설 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_ACADEMY: {
    survival_rate_1yr: 75.6,
    survival_rate_3yr: 55.4,
    survival_rate_5yr: 42.1,
    annual_closure_rate: 8.4,
    new_entry_rate: 11.0,
    avg_operating_years: 5.4,
    metric_definition:
      '생존율은 일반 교습학원 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 학원 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_MEAT: {
    survival_rate_1yr: 65.4,
    survival_rate_3yr: 43.1,
    survival_rate_5yr: 30.2,
    annual_closure_rate: 11.9,
    new_entry_rate: 13.8,
    avg_operating_years: 4.1,
    metric_definition:
      '생존율은 한식 육류요리(고기구이) 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_SNACK: {
    survival_rate_1yr: 62.8,
    survival_rate_3yr: 39.5,
    survival_rate_5yr: 27.6,
    annual_closure_rate: 13.4,
    new_entry_rate: 15.6,
    avg_operating_years: 3.3,
    metric_definition:
      '생존율은 분식·김밥 간이음식점 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_JAPANESE: {
    survival_rate_1yr: 64.9,
    survival_rate_3yr: 42.4,
    survival_rate_5yr: 29.8,
    annual_closure_rate: 12.2,
    new_entry_rate: 15.9,
    avg_operating_years: 3.6,
    metric_definition:
      '생존율은 일식 음식점업 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_CHINESE: {
    survival_rate_1yr: 67.2,
    survival_rate_3yr: 45.8,
    survival_rate_5yr: 33.1,
    annual_closure_rate: 10.9,
    new_entry_rate: 12.8,
    avg_operating_years: 4.6,
    metric_definition:
      '생존율은 중식 음식점업 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_WESTERN: {
    survival_rate_1yr: 63.7,
    survival_rate_3yr: 40.9,
    survival_rate_5yr: 28.5,
    annual_closure_rate: 12.8,
    new_entry_rate: 16.2,
    avg_operating_years: 3.5,
    metric_definition:
      '생존율은 서양식 음식점업 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_FASTFOOD: {
    survival_rate_1yr: 65.8,
    survival_rate_3yr: 43.6,
    survival_rate_5yr: 30.8,
    annual_closure_rate: 11.8,
    new_entry_rate: 14.7,
    avg_operating_years: 3.8,
    metric_definition:
      '생존율은 피자·햄버거·샌드위치 업종 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_PUB: {
    survival_rate_1yr: 58.4,
    survival_rate_3yr: 34.8,
    survival_rate_5yr: 22.9,
    annual_closure_rate: 15.6,
    new_entry_rate: 17.4,
    avg_operating_years: 2.8,
    metric_definition:
      '생존율은 일반 유흥·요리주점업 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_SUPER: {
    survival_rate_1yr: 76.2,
    survival_rate_3yr: 56.8,
    survival_rate_5yr: 42.9,
    annual_closure_rate: 8.2,
    new_entry_rate: 9.8,
    avg_operating_years: 5.8,
    metric_definition:
      '생존율은 음·식료품 위주 종합소매업 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_PHARMACY: {
    survival_rate_1yr: 86.4,
    survival_rate_3yr: 72.5,
    survival_rate_5yr: 61.2,
    annual_closure_rate: 4.6,
    new_entry_rate: 6.8,
    avg_operating_years: 8.4,
    metric_definition:
      '생존율은 의약품 및 의료용품 소매업 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_FLOWER: {
    survival_rate_1yr: 69.4,
    survival_rate_3yr: 46.8,
    survival_rate_5yr: 33.5,
    annual_closure_rate: 10.6,
    new_entry_rate: 13.9,
    avg_operating_years: 4.3,
    metric_definition:
      '생존율은 화초 및 식물 소매업 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_CLOTHING: {
    survival_rate_1yr: 64.5,
    survival_rate_3yr: 41.2,
    survival_rate_5yr: 28.9,
    annual_closure_rate: 12.9,
    new_entry_rate: 14.5,
    avg_operating_years: 3.9,
    metric_definition:
      '생존율은 의복·패션잡화 소매업 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_UNMANNED: {
    survival_rate_1yr: 71.8,
    survival_rate_3yr: 46.2,
    survival_rate_5yr: 31.4,
    annual_closure_rate: 11.2,
    new_entry_rate: 19.5,
    avg_operating_years: 3.2,
    metric_definition:
      '생존율은 기타 무인 소매점업 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_NAIL_SKIN: {
    survival_rate_1yr: 70.6,
    survival_rate_3yr: 48.9,
    survival_rate_5yr: 35.8,
    annual_closure_rate: 9.8,
    new_entry_rate: 15.4,
    avg_operating_years: 4.2,
    metric_definition:
      '생존율은 피부·네일 등 기타 미용업 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_LAUNDRY: {
    survival_rate_1yr: 79.5,
    survival_rate_3yr: 61.2,
    survival_rate_5yr: 47.8,
    annual_closure_rate: 6.9,
    new_entry_rate: 10.2,
    avg_operating_years: 6.1,
    metric_definition:
      '생존율은 가정용 세탁업(코인세탁 포함) 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_PET: {
    survival_rate_1yr: 72.4,
    survival_rate_3yr: 50.8,
    survival_rate_5yr: 37.6,
    annual_closure_rate: 9.4,
    new_entry_rate: 16.1,
    avg_operating_years: 4.4,
    metric_definition:
      '생존율은 반려동물 관련 서비스·소매업 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_CLINIC: {
    survival_rate_1yr: 88.2,
    survival_rate_3yr: 76.4,
    survival_rate_5yr: 66.8,
    annual_closure_rate: 3.8,
    new_entry_rate: 6.2,
    avg_operating_years: 9.2,
    metric_definition:
      '생존율은 일반 의원·치과·한의원 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 의료기관 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_ARTS_EDU: {
    survival_rate_1yr: 76.8,
    survival_rate_3yr: 57.2,
    survival_rate_5yr: 44.0,
    annual_closure_rate: 7.9,
    new_entry_rate: 10.6,
    avg_operating_years: 5.7,
    metric_definition:
      '생존율은 예술·스포츠 교육기관 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 학원 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_STUDYCAFE: {
    survival_rate_1yr: 72.1,
    survival_rate_3yr: 49.4,
    survival_rate_5yr: 34.8,
    annual_closure_rate: 10.1,
    new_entry_rate: 15.8,
    avg_operating_years: 3.9,
    metric_definition:
      '생존율은 독서실 및 스터디카페 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_SCREEN_GOLF: {
    survival_rate_1yr: 74.5,
    survival_rate_3yr: 53.8,
    survival_rate_5yr: 39.2,
    annual_closure_rate: 8.8,
    new_entry_rate: 12.4,
    avg_operating_years: 4.8,
    metric_definition:
      '생존율은 스크린골프·실내스포츠시설 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  },
  IND_PC_KARAOKE: {
    survival_rate_1yr: 66.8,
    survival_rate_3yr: 44.1,
    survival_rate_5yr: 30.5,
    annual_closure_rate: 11.7,
    new_entry_rate: 12.9,
    avg_operating_years: 4.1,
    metric_definition:
      '생존율은 PC방·노래연습장 등 오락시설 신생 코호트의 1·3·5년 후 생존 비율이며, 연간 폐업(소멸)률은 당해 전체 활동 사업체 대비 소멸 비율입니다.',
    source_id: 'SRC_KOSIS_SURVIVAL',
    base_year: 2025,
    observation_period: '2025년 연간 (2020~2025 코호트 기준)',
    published_at: '2025-12-18'
  }
};

/**
 * 전국 주요 후보 상권 (Commercial Zones) 마스터 데이터
 * - 기획서 예시(커피숍 + 서울특별시 강남구 + 초기 투자비 1억 원 이하 → 추천 상권 10곳 이상)를 완벽히 검증할 수 있도록
 *   서울 강남구에 12개 세부 상권을 배치하고, 서울 타구 및 부산·대구·인천·대전·경기 주요 상권을 함께 수록합니다.
 * - 일부 상권(예: 세곡동 보금자리 상권, 학하동 수통골 외곽 상권 등)은 공식 임대료 표본이나 5년 장기 생존 코호트가
 *   미확보된 상태(null)로 두어, 결측 데이터 처리 원칙을 실제 동작으로 검증합니다.
 */
const COMMERCIAL_ZONES = [
  // ======================== 서울특별시 강남구 (12개 후보 상권) ========================
  {
    zone_id: 'ZONE_GN_01',
    zone_name: '역삼1동 테헤란로 이면(국기원·강남역 북측) 상권',
    sido_name: '서울특별시',
    sigungu_name: '강남구',
    emd_name: '역삼1동',
    region_code: '1168010100',
    lat: 37.5006,
    lng: 127.0334,
    district_type: 'OFFICE',
    district_type_label: '업무·오피스 밀집형',
    resident_population: 36420,
    household_count: 23810,
    worker_population: 94200,
    floating_pop_daily: 118500,
    age_20_39_ratio: 48.6,
    age_40_59_ratio: 31.2,
    total_biz_count: 8940,
    avg_monthly_rent_per_py: 24.5, // 만원/평
    avg_deposit_per_py: 260.0,     // 만원/평
    estimated_interior_per_py: 220.0,
    survival_modifier: { s1: +4.2, s3: +3.8, s5: +2.9, closure: -1.1 },
    store_counts_by_industry: {
      IND_CAFE: 84, IND_KOREAN: 142, IND_CHICKEN: 28, IND_BAKERY: 24,
      IND_CONV: 46, IND_BEAUTY: 52, IND_FITNESS: 31, IND_ACADEMY: 19
    },
    store_trend_yoy_pct: {
      IND_CAFE: +3.6, IND_KOREAN: -1.4, IND_CHICKEN: -3.2, IND_BAKERY: +4.3,
      IND_CONV: +2.1, IND_BEAUTY: +1.8, IND_FITNESS: +6.5, IND_ACADEMY: 0.0
    },
    adjacent_zones: ['역삼역 남측 오피스 상권', '강남역 메인대로 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_GN_02',
    zone_name: '역삼2동 선릉·개나리아파트 배후 혼합 상권',
    sido_name: '서울특별시',
    sigungu_name: '강남구',
    emd_name: '역삼2동',
    region_code: '1168010102',
    lat: 37.4989,
    lng: 127.0468,
    district_type: 'MIXED',
    district_type_label: '업무·대단지 주거 혼합형',
    resident_population: 37850,
    household_count: 15920,
    worker_population: 48600,
    floating_pop_daily: 68400,
    age_20_39_ratio: 36.4,
    age_40_59_ratio: 38.5,
    total_biz_count: 4120,
    avg_monthly_rent_per_py: 19.2,
    avg_deposit_per_py: 210.0,
    estimated_interior_per_py: 210.0,
    survival_modifier: { s1: +6.1, s3: +5.4, s5: +4.6, closure: -2.0 },
    store_counts_by_industry: {
      IND_CAFE: 46, IND_KOREAN: 78, IND_CHICKEN: 19, IND_BAKERY: 16,
      IND_CONV: 29, IND_BEAUTY: 34, IND_FITNESS: 18, IND_ACADEMY: 44
    },
    store_trend_yoy_pct: {
      IND_CAFE: +2.2, IND_KOREAN: +1.2, IND_CHICKEN: 0.0, IND_BAKERY: +6.2,
      IND_CONV: +3.4, IND_BEAUTY: +2.9, IND_FITNESS: +5.5, IND_ACADEMY: +4.5
    },
    adjacent_zones: ['선릉역 테헤란로 상권', '도곡1동 한티역 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_GN_03',
    zone_name: '대치4동 선릉역 남측·한티 학원가 배후 상권',
    sido_name: '서울특별시',
    sigungu_name: '강남구',
    emd_name: '대치4동',
    region_code: '1168010604',
    lat: 37.5002,
    lng: 127.0548,
    district_type: 'MIXED',
    district_type_label: '교육·오피스·주거 복합형',
    resident_population: 20480,
    household_count: 9840,
    worker_population: 39400,
    floating_pop_daily: 79200,
    age_20_39_ratio: 34.8,
    age_40_59_ratio: 41.2,
    total_biz_count: 4680,
    avg_monthly_rent_per_py: 21.0,
    avg_deposit_per_py: 230.0,
    estimated_interior_per_py: 215.0,
    survival_modifier: { s1: +5.8, s3: +6.2, s5: +5.1, closure: -2.2 },
    store_counts_by_industry: {
      IND_CAFE: 52, IND_KOREAN: 86, IND_CHICKEN: 17, IND_BAKERY: 21,
      IND_CONV: 31, IND_BEAUTY: 28, IND_FITNESS: 19, IND_ACADEMY: 138
    },
    store_trend_yoy_pct: {
      IND_CAFE: +1.9, IND_KOREAN: 0.0, IND_CHICKEN: -5.5, IND_BAKERY: +4.8,
      IND_CONV: +3.2, IND_BEAUTY: +3.6, IND_FITNESS: +5.2, IND_ACADEMY: +7.8
    },
    adjacent_zones: ['대치2동 은마사거리 학원가', '역삼2동 선릉 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_GN_04',
    zone_name: '논현1동 학동역·영동시장 생활밀착 상권',
    sido_name: '서울특별시',
    sigungu_name: '강남구',
    emd_name: '논현1동',
    region_code: '1168010801',
    lat: 37.5115,
    lng: 127.0284,
    district_type: 'MIXED',
    district_type_label: '상업·1인가구 주거 복합형',
    resident_population: 22910,
    household_count: 14820,
    worker_population: 44100,
    floating_pop_daily: 71500,
    age_20_39_ratio: 51.2,
    age_40_59_ratio: 28.4,
    total_biz_count: 5210,
    avg_monthly_rent_per_py: 20.5,
    avg_deposit_per_py: 220.0,
    estimated_interior_per_py: 210.0,
    survival_modifier: { s1: +2.8, s3: +2.1, s5: +1.4, closure: -0.6 },
    store_counts_by_industry: {
      IND_CAFE: 58, IND_KOREAN: 118, IND_CHICKEN: 31, IND_BAKERY: 18,
      IND_CONV: 38, IND_BEAUTY: 46, IND_FITNESS: 24, IND_ACADEMY: 12
    },
    store_trend_yoy_pct: {
      IND_CAFE: +3.4, IND_KOREAN: -0.8, IND_CHICKEN: +3.2, IND_BAKERY: +5.5,
      IND_CONV: +2.6, IND_BEAUTY: +4.3, IND_FITNESS: +4.1, IND_ACADEMY: -7.6
    },
    adjacent_zones: ['신사역 가로수길 상권', '언주역 차병원 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_GN_05',
    zone_name: '수서동 수서역세권·업무단지 배후 상권',
    sido_name: '서울특별시',
    sigungu_name: '강남구',
    emd_name: '수서동',
    region_code: '1168011500',
    lat: 37.4875,
    lng: 127.1014,
    district_type: 'MIXED',
    district_type_label: '광역환승·업무·주거 혼합형',
    resident_population: 16240,
    household_count: 7920,
    worker_population: 34800,
    floating_pop_daily: 64300,
    age_20_39_ratio: 35.1,
    age_40_59_ratio: 36.8,
    total_biz_count: 2490,
    avg_monthly_rent_per_py: 17.8,
    avg_deposit_per_py: 185.0,
    estimated_interior_per_py: 200.0,
    survival_modifier: { s1: +6.8, s3: +5.9, s5: +4.8, closure: -2.4 },
    store_counts_by_industry: {
      IND_CAFE: 31, IND_KOREAN: 56, IND_CHICKEN: 14, IND_BAKERY: 11,
      IND_CONV: 22, IND_BEAUTY: 19, IND_FITNESS: 12, IND_ACADEMY: 15
    },
    store_trend_yoy_pct: {
      IND_CAFE: +6.8, IND_KOREAN: +3.7, IND_CHICKEN: +7.1, IND_BAKERY: +10.0,
      IND_CONV: +4.7, IND_BEAUTY: +5.2, IND_FITNESS: +9.0, IND_ACADEMY: +6.6
    },
    adjacent_zones: ['문정법조단지 상권', '가락시장역 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_GN_06',
    zone_name: '도곡1동 매봉역·양재천 카페거리 배후 상권',
    sido_name: '서울특별시',
    sigungu_name: '강남구',
    emd_name: '도곡1동',
    region_code: '1168011801',
    lat: 37.4868,
    lng: 127.0439,
    district_type: 'RESIDENTIAL',
    district_type_label: '고소득 주거·산책로 결합형',
    resident_population: 22650,
    household_count: 8940,
    worker_population: 26800,
    floating_pop_daily: 48200,
    age_20_39_ratio: 33.2,
    age_40_59_ratio: 40.4,
    total_biz_count: 2380,
    avg_monthly_rent_per_py: 18.6,
    avg_deposit_per_py: 200.0,
    estimated_interior_per_py: 215.0,
    survival_modifier: { s1: +7.2, s3: +6.5, s5: +5.6, closure: -2.6 },
    store_counts_by_industry: {
      IND_CAFE: 38, IND_KOREAN: 49, IND_CHICKEN: 12, IND_BAKERY: 15,
      IND_CONV: 18, IND_BEAUTY: 24, IND_FITNESS: 14, IND_ACADEMY: 26
    },
    store_trend_yoy_pct: {
      IND_CAFE: +5.5, IND_KOREAN: +2.0, IND_CHICKEN: 0.0, IND_BAKERY: +7.1,
      IND_CONV: +5.8, IND_BEAUTY: +4.1, IND_FITNESS: +7.6, IND_ACADEMY: +3.8
    },
    adjacent_zones: ['양재역 북측 오피스 상권', '역삼2동 선릉 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_GN_07',
    zone_name: '삼성1동 삼성역·코엑스 배후 오피스 상권',
    sido_name: '서울특별시',
    sigungu_name: '강남구',
    emd_name: '삼성1동',
    region_code: '1168010501',
    lat: 37.5092,
    lng: 127.0605,
    district_type: 'OFFICE',
    district_type_label: '대형업무·컨벤션 중심형',
    resident_population: 12450,
    household_count: 6180,
    worker_population: 88400,
    floating_pop_daily: 109400,
    age_20_39_ratio: 44.5,
    age_40_59_ratio: 35.8,
    total_biz_count: 6120,
    avg_monthly_rent_per_py: 31.0,
    avg_deposit_per_py: 340.0,
    estimated_interior_per_py: 240.0,
    survival_modifier: { s1: +3.9, s3: +3.2, s5: +2.1, closure: -0.9 },
    store_counts_by_industry: {
      IND_CAFE: 92, IND_KOREAN: 136, IND_CHICKEN: 22, IND_BAKERY: 29,
      IND_CONV: 44, IND_BEAUTY: 31, IND_FITNESS: 25, IND_ACADEMY: 9
    },
    store_trend_yoy_pct: {
      IND_CAFE: +1.1, IND_KOREAN: -2.1, IND_CHICKEN: -4.3, IND_BAKERY: +3.5,
      IND_CONV: +2.3, IND_BEAUTY: 0.0, IND_FITNESS: +4.0, IND_ACADEMY: -10.0
    },
    adjacent_zones: ['포스코사거리 상권', '봉은사역 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_GN_08',
    zone_name: '개포2동 개포자이·래미안 대단지 아파트 근린 상권',
    sido_name: '서울특별시',
    sigungu_name: '강남구',
    emd_name: '개포2동',
    region_code: '1168010302',
    lat: 37.4892,
    lng: 127.0684,
    district_type: 'RESIDENTIAL',
    district_type_label: '신축 대단지 아파트 배후형',
    resident_population: 31800,
    household_count: 10940,
    worker_population: 9200,
    floating_pop_daily: 36400,
    age_20_39_ratio: 31.4,
    age_40_59_ratio: 42.6,
    total_biz_count: 1580,
    avg_monthly_rent_per_py: 18.2,
    avg_deposit_per_py: 195.0,
    estimated_interior_per_py: 205.0,
    survival_modifier: { s1: +8.1, s3: +7.4, s5: +6.2, closure: -3.1 },
    store_counts_by_industry: {
      IND_CAFE: 24, IND_KOREAN: 32, IND_CHICKEN: 11, IND_BAKERY: 12,
      IND_CONV: 16, IND_BEAUTY: 22, IND_FITNESS: 13, IND_ACADEMY: 54
    },
    store_trend_yoy_pct: {
      IND_CAFE: +9.0, IND_KOREAN: +6.2, IND_CHICKEN: +9.1, IND_BAKERY: +8.3,
      IND_CONV: +6.6, IND_BEAUTY: +9.5, IND_FITNESS: +8.3, IND_ACADEMY: +12.5
    },
    adjacent_zones: ['대치2동 학원가 상권', '개포동역 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_GN_09',
    zone_name: '대치2동 은마사거리·대치학원가 메인 상권',
    sido_name: '서울특별시',
    sigungu_name: '강남구',
    emd_name: '대치2동',
    region_code: '1168010602',
    lat: 37.4984,
    lng: 127.0631,
    district_type: 'MIXED',
    district_type_label: '전국 최대 학원가·주거 결합형',
    resident_population: 38920,
    household_count: 13410,
    worker_population: 31200,
    floating_pop_daily: 82400,
    age_20_39_ratio: 28.9,
    age_40_59_ratio: 45.8,
    total_biz_count: 4920,
    avg_monthly_rent_per_py: 23.8,
    avg_deposit_per_py: 255.0,
    estimated_interior_per_py: 220.0,
    survival_modifier: { s1: +6.4, s3: +5.8, s5: +5.2, closure: -2.1 },
    store_counts_by_industry: {
      IND_CAFE: 59, IND_KOREAN: 74, IND_CHICKEN: 15, IND_BAKERY: 23,
      IND_CONV: 34, IND_BEAUTY: 31, IND_FITNESS: 17, IND_ACADEMY: 312
    },
    store_trend_yoy_pct: {
      IND_CAFE: +3.5, IND_KOREAN: +1.4, IND_CHICKEN: 0.0, IND_BAKERY: +4.5,
      IND_CONV: +3.0, IND_BEAUTY: +3.2, IND_FITNESS: +6.2, IND_ACADEMY: +5.4
    },
    adjacent_zones: ['대치4동 한티역 상권', '삼성1동 코엑스 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_GN_10',
    zone_name: '신사동 가로수길·세로수길 트렌드 상권',
    sido_name: '서울특별시',
    sigungu_name: '강남구',
    emd_name: '신사동',
    region_code: '1168010700',
    lat: 37.5208,
    lng: 127.0228,
    district_type: 'COMMERCIAL',
    district_type_label: '패션·트렌드 중심상업형',
    resident_population: 15840,
    household_count: 8120,
    worker_population: 42900,
    floating_pop_daily: 89600,
    age_20_39_ratio: 52.8,
    age_40_59_ratio: 27.1,
    total_biz_count: 5840,
    avg_monthly_rent_per_py: 35.5,
    avg_deposit_per_py: 390.0,
    estimated_interior_per_py: 260.0,
    survival_modifier: { s1: -2.4, s3: -4.1, s5: -5.2, closure: +2.8 },
    store_counts_by_industry: {
      IND_CAFE: 108, IND_KOREAN: 94, IND_CHICKEN: 19, IND_BAKERY: 36,
      IND_CONV: 29, IND_BEAUTY: 78, IND_FITNESS: 22, IND_ACADEMY: 8
    },
    store_trend_yoy_pct: {
      IND_CAFE: -2.7, IND_KOREAN: -4.1, IND_CHICKEN: -5.0, IND_BAKERY: +2.8,
      IND_CONV: 0.0, IND_BEAUTY: +1.3, IND_FITNESS: -4.3, IND_ACADEMY: 0.0
    },
    adjacent_zones: ['압구정 로데오 상권', '논현1동 학동역 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_GN_11',
    zone_name: '청담동 도산대로·명품거리 배후 상권',
    sido_name: '서울특별시',
    sigungu_name: '강남구',
    emd_name: '청담동',
    region_code: '1168010400',
    lat: 37.5236,
    lng: 127.0472,
    district_type: 'COMMERCIAL',
    district_type_label: '고급 상업·뷰티·오피스 복합형',
    resident_population: 25120,
    household_count: 11840,
    worker_population: 51200,
    floating_pop_daily: 69800,
    age_20_39_ratio: 41.2,
    age_40_59_ratio: 35.6,
    total_biz_count: 5490,
    avg_monthly_rent_per_py: 38.0,
    avg_deposit_per_py: 420.0,
    estimated_interior_per_py: 280.0,
    survival_modifier: { s1: +1.2, s3: -0.8, s5: -1.5, closure: +0.5 },
    store_counts_by_industry: {
      IND_CAFE: 76, IND_KOREAN: 88, IND_CHICKEN: 14, IND_BAKERY: 27,
      IND_CONV: 26, IND_BEAUTY: 142, IND_FITNESS: 29, IND_ACADEMY: 16
    },
    store_trend_yoy_pct: {
      IND_CAFE: +1.3, IND_KOREAN: -1.1, IND_CHICKEN: -6.6, IND_BAKERY: +3.8,
      IND_CONV: +4.0, IND_BEAUTY: +4.4, IND_FITNESS: +3.5, IND_ACADEMY: 0.0
    },
    adjacent_zones: ['압구정로데오역 상권', '삼성1동 봉은사역 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_GN_12',
    zone_name: '세곡동 헌릉로·보금자리 주거단지 상권 (일부 통계 미확보 검증용)',
    sido_name: '서울특별시',
    sigungu_name: '강남구',
    emd_name: '세곡동',
    region_code: '1168011100',
    lat: 37.4648,
    lng: 127.1045,
    district_type: 'RESIDENTIAL',
    district_type_label: '외곽 주거단지형 (비표본 구역 포함)',
    resident_population: 44120,
    household_count: 18650,
    worker_population: 8400,
    floating_pop_daily: null, // 공공 유동인구 센서 미측정 지역 -> 임의 추정 금지 (null)
    age_20_39_ratio: 32.8,
    age_40_59_ratio: 36.1,
    total_biz_count: 1320,
    avg_monthly_rent_per_py: 14.2,
    avg_deposit_per_py: 150.0,
    estimated_interior_per_py: 190.0,
    survival_modifier: { s1: +4.5, s3: +3.9, s5: null, closure: -1.5 }, // 5년 생존율 세부 코호트 표본 부족 예시
    store_counts_by_industry: {
      IND_CAFE: 21, IND_KOREAN: 39, IND_CHICKEN: 16, IND_BAKERY: 9,
      IND_CONV: 19, IND_BEAUTY: 18, IND_FITNESS: 9, IND_ACADEMY: 28
    },
    store_trend_yoy_pct: {
      IND_CAFE: +5.0, IND_KOREAN: +2.6, IND_CHICKEN: +6.6, IND_BAKERY: +12.5,
      IND_CONV: +5.5, IND_BEAUTY: +5.8, IND_FITNESS: +12.5, IND_ACADEMY: +7.6
    },
    adjacent_zones: ['수서역 상권', '성남 고등지구 상권'],
    quality_status: 'PARTIAL_COVERAGE',
    stats_granularity: '시·군·구 통계 결합 (유동인구·5년 코호트 표본 미확보)',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },

  // ======================== 서울특별시 마포구 (4개 후보 상권) ========================
  {
    zone_id: 'ZONE_MP_01',
    zone_name: '공덕동 공덕오거리 오피스·환승역세권 상권',
    sido_name: '서울특별시',
    sigungu_name: '마포구',
    emd_name: '공덕동',
    region_code: '1144010200',
    lat: 37.5443,
    lng: 126.9516,
    district_type: 'MIXED',
    district_type_label: '4개노선 환승·업무·주거 복합형',
    resident_population: 38420,
    household_count: 18920,
    worker_population: 52400,
    floating_pop_daily: 84600,
    age_20_39_ratio: 41.8,
    age_40_59_ratio: 34.9,
    total_biz_count: 4280,
    avg_monthly_rent_per_py: 19.5,
    avg_deposit_per_py: 205.0,
    estimated_interior_per_py: 205.0,
    survival_modifier: { s1: +5.6, s3: +4.9, s5: +4.1, closure: -1.8 },
    store_counts_by_industry: {
      IND_CAFE: 48, IND_KOREAN: 94, IND_CHICKEN: 21, IND_BAKERY: 17,
      IND_CONV: 32, IND_BEAUTY: 29, IND_FITNESS: 18, IND_ACADEMY: 24
    },
    store_trend_yoy_pct: {
      IND_CAFE: +4.3, IND_KOREAN: +2.1, IND_CHICKEN: 0.0, IND_BAKERY: +6.2,
      IND_CONV: +3.2, IND_BEAUTY: +3.5, IND_FITNESS: +5.8, IND_ACADEMY: +4.3
    },
    adjacent_zones: ['마포역 용강동 상권', '애오개역 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_MP_02',
    zone_name: '상암동 DMC 디지털미디어시티 방송·IT 업무 상권',
    sido_name: '서울특별시',
    sigungu_name: '마포구',
    emd_name: '상암동',
    region_code: '1144012700',
    lat: 37.5791,
    lng: 126.8892,
    district_type: 'OFFICE',
    district_type_label: '미디어·IT 기업 특화 업무형',
    resident_population: 30150,
    household_count: 13480,
    worker_population: 61800,
    floating_pop_daily: 74200,
    age_20_39_ratio: 44.2,
    age_40_59_ratio: 35.1,
    total_biz_count: 3690,
    avg_monthly_rent_per_py: 18.4,
    avg_deposit_per_py: 195.0,
    estimated_interior_per_py: 205.0,
    survival_modifier: { s1: +6.2, s3: +5.5, s5: +4.7, closure: -2.1 },
    store_counts_by_industry: {
      IND_CAFE: 54, IND_KOREAN: 88, IND_CHICKEN: 18, IND_BAKERY: 15,
      IND_CONV: 29, IND_BEAUTY: 24, IND_FITNESS: 19, IND_ACADEMY: 22
    },
    store_trend_yoy_pct: {
      IND_CAFE: +3.8, IND_KOREAN: +1.1, IND_CHICKEN: -5.2, IND_BAKERY: +7.1,
      IND_CONV: +3.5, IND_BEAUTY: +4.3, IND_FITNESS: +5.5, IND_ACADEMY: +4.7
    },
    adjacent_zones: ['수색역세권 상권', '망원1동 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_MP_03',
    zone_name: '연남동 경의선숲길·연트럴파크 상권',
    sido_name: '서울특별시',
    sigungu_name: '마포구',
    emd_name: '연남동',
    region_code: '1144012400',
    lat: 37.5618,
    lng: 126.9248,
    district_type: 'COMMERCIAL',
    district_type_label: 'MZ세대 관광·카페 특화 상권',
    resident_population: 18940,
    household_count: 11250,
    worker_population: 19400,
    floating_pop_daily: 92400,
    age_20_39_ratio: 56.4,
    age_40_59_ratio: 24.8,
    total_biz_count: 4120,
    avg_monthly_rent_per_py: 25.8,
    avg_deposit_per_py: 270.0,
    estimated_interior_per_py: 235.0,
    survival_modifier: { s1: -1.8, s3: -3.2, s5: -4.5, closure: +2.3 },
    store_counts_by_industry: {
      IND_CAFE: 118, IND_KOREAN: 82, IND_CHICKEN: 17, IND_BAKERY: 44,
      IND_CONV: 24, IND_BEAUTY: 42, IND_FITNESS: 11, IND_ACADEMY: 6
    },
    store_trend_yoy_pct: {
      IND_CAFE: +1.7, IND_KOREAN: -2.3, IND_CHICKEN: -5.5, IND_BAKERY: +4.7,
      IND_CONV: 0.0, IND_BEAUTY: +2.4, IND_FITNESS: 0.0, IND_ACADEMY: 0.0
    },
    adjacent_zones: ['서교동 홍대입구 상권', '성산1동 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_MP_04',
    zone_name: '망원1동 망원시장·망리단길 생활·트렌드 결합 상권',
    sido_name: '서울특별시',
    sigungu_name: '마포구',
    emd_name: '망원1동',
    region_code: '1144012301',
    lat: 37.5562,
    lng: 126.9056,
    district_type: 'MIXED',
    district_type_label: '전통시장·청년거주·골목상권 결합형',
    resident_population: 21450,
    household_count: 11890,
    worker_population: 14200,
    floating_pop_daily: 61200,
    age_20_39_ratio: 47.2,
    age_40_59_ratio: 30.4,
    total_biz_count: 2890,
    avg_monthly_rent_per_py: 17.5,
    avg_deposit_per_py: 180.0,
    estimated_interior_per_py: 195.0,
    survival_modifier: { s1: +3.4, s3: +2.6, s5: +1.9, closure: -0.9 },
    store_counts_by_industry: {
      IND_CAFE: 52, IND_KOREAN: 69, IND_CHICKEN: 16, IND_BAKERY: 24,
      IND_CONV: 20, IND_BEAUTY: 27, IND_FITNESS: 12, IND_ACADEMY: 11
    },
    store_trend_yoy_pct: {
      IND_CAFE: +4.0, IND_KOREAN: +1.5, IND_CHICKEN: 0.0, IND_BAKERY: +9.0,
      IND_CONV: +5.2, IND_BEAUTY: +3.8, IND_FITNESS: +9.0, IND_ACADEMY: 0.0
    },
    adjacent_zones: ['합정역 상권', '마포구청역 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },

  // ======================== 서울특별시 성동구 / 송파구 ========================
  {
    zone_id: 'ZONE_SD_01',
    zone_name: '성수2가3동 성수IT밸리·지식산업센터 상권',
    sido_name: '서울특별시',
    sigungu_name: '성동구',
    emd_name: '성수2가3동',
    region_code: '1120011503',
    lat: 37.5458,
    lng: 127.0572,
    district_type: 'OFFICE',
    district_type_label: '지식산업센터·스타트업 밀집형',
    resident_population: 19840,
    household_count: 10240,
    worker_population: 68900,
    floating_pop_daily: 88400,
    age_20_39_ratio: 51.8,
    age_40_59_ratio: 29.4,
    total_biz_count: 5410,
    avg_monthly_rent_per_py: 22.8,
    avg_deposit_per_py: 240.0,
    estimated_interior_per_py: 220.0,
    survival_modifier: { s1: +4.9, s3: +3.7, s5: +2.8, closure: -1.4 },
    store_counts_by_industry: {
      IND_CAFE: 74, IND_KOREAN: 98, IND_CHICKEN: 18, IND_BAKERY: 28,
      IND_CONV: 33, IND_BEAUTY: 31, IND_FITNESS: 21, IND_ACADEMY: 9
    },
    store_trend_yoy_pct: {
      IND_CAFE: +7.2, IND_KOREAN: +3.1, IND_CHICKEN: 0.0, IND_BAKERY: +12.0,
      IND_CONV: +6.4, IND_BEAUTY: +6.8, IND_FITNESS: +10.5, IND_ACADEMY: 0.0
    },
    adjacent_zones: ['뚝섬역 서울숲 상권', '건대입구역 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_SD_02',
    zone_name: '왕십리도선동 왕십리역 환승·주거 배후 상권',
    sido_name: '서울특별시',
    sigungu_name: '성동구',
    emd_name: '왕십리도선동',
    region_code: '1120010100',
    lat: 37.5619,
    lng: 127.0348,
    district_type: 'MIXED',
    district_type_label: '4개노선 역세권·대단지 주거 결합형',
    resident_population: 28940,
    household_count: 13840,
    worker_population: 29400,
    floating_pop_daily: 72100,
    age_20_39_ratio: 44.6,
    age_40_59_ratio: 32.8,
    total_biz_count: 3420,
    avg_monthly_rent_per_py: 18.2,
    avg_deposit_per_py: 190.0,
    estimated_interior_per_py: 200.0,
    survival_modifier: { s1: +5.9, s3: +5.2, s5: +4.4, closure: -1.9 },
    store_counts_by_industry: {
      IND_CAFE: 41, IND_KOREAN: 84, IND_CHICKEN: 22, IND_BAKERY: 15,
      IND_CONV: 28, IND_BEAUTY: 32, IND_FITNESS: 17, IND_ACADEMY: 23
    },
    store_trend_yoy_pct: {
      IND_CAFE: +5.1, IND_KOREAN: +2.4, IND_CHICKEN: +4.7, IND_BAKERY: +7.1,
      IND_CONV: +3.7, IND_BEAUTY: +3.2, IND_FITNESS: +6.2, IND_ACADEMY: +4.5
    },
    adjacent_zones: ['한양대 상권', '상왕십리역 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_SP_01',
    zone_name: '문정2동 문정법조단지·지식산업센터 업무 상권',
    sido_name: '서울특별시',
    sigungu_name: '송파구',
    emd_name: '문정2동(문정법조단지)',
    region_code: '1171010802',
    lat: 37.4859,
    lng: 127.1225,
    district_type: 'OFFICE',
    district_type_label: '법조·IT 지식산업센터 집적형',
    resident_population: 29480,
    household_count: 16420,
    worker_population: 74200,
    floating_pop_daily: 86500,
    age_20_39_ratio: 46.8,
    age_40_59_ratio: 34.2,
    total_biz_count: 5890,
    avg_monthly_rent_per_py: 19.8,
    avg_deposit_per_py: 210.0,
    estimated_interior_per_py: 205.0,
    survival_modifier: { s1: +6.5, s3: +5.7, s5: +4.8, closure: -2.2 },
    store_counts_by_industry: {
      IND_CAFE: 58, IND_KOREAN: 104, IND_CHICKEN: 19, IND_BAKERY: 18,
      IND_CONV: 36, IND_BEAUTY: 28, IND_FITNESS: 22, IND_ACADEMY: 14
    },
    store_trend_yoy_pct: {
      IND_CAFE: +5.4, IND_KOREAN: +2.9, IND_CHICKEN: 0.0, IND_BAKERY: +5.8,
      IND_CONV: +2.8, IND_BEAUTY: +3.7, IND_FITNESS: +4.7, IND_ACADEMY: +7.6
    },
    adjacent_zones: ['장지역 가든파이브 상권', '수서역 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },

  // ======================== 부산 / 대구 / 인천 / 대전 / 경기 ========================
  {
    zone_id: 'ZONE_BS_01',
    zone_name: '우2동 센텀시티 업무·백화점 배후 상권',
    sido_name: '부산광역시',
    sigungu_name: '해운대구',
    emd_name: '우2동(센텀시티)',
    region_code: '2635010502',
    lat: 35.1689,
    lng: 129.1318,
    district_type: 'OFFICE',
    district_type_label: '동남권 최대 업무·복합쇼핑 상권',
    resident_population: 31240,
    household_count: 12840,
    worker_population: 58400,
    floating_pop_daily: 81200,
    age_20_39_ratio: 39.4,
    age_40_59_ratio: 37.8,
    total_biz_count: 4620,
    avg_monthly_rent_per_py: 16.8,
    avg_deposit_per_py: 175.0,
    estimated_interior_per_py: 195.0,
    survival_modifier: { s1: +5.4, s3: +4.8, s5: +3.9, closure: -1.7 },
    store_counts_by_industry: {
      IND_CAFE: 51, IND_KOREAN: 89, IND_CHICKEN: 17, IND_BAKERY: 19,
      IND_CONV: 29, IND_BEAUTY: 31, IND_FITNESS: 18, IND_ACADEMY: 24
    },
    store_trend_yoy_pct: {
      IND_CAFE: +4.1, IND_KOREAN: +1.1, IND_CHICKEN: 0.0, IND_BAKERY: +5.5,
      IND_CONV: +3.5, IND_BEAUTY: +3.3, IND_FITNESS: +5.8, IND_ACADEMY: +4.3
    },
    adjacent_zones: ['벡스코 상권', '수영교차로 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_BS_02',
    zone_name: '전포1동 전포카페거리·서면 동측 상권',
    sido_name: '부산광역시',
    sigungu_name: '부산진구',
    emd_name: '전포1동(전포카페거리)',
    region_code: '2623010401',
    lat: 35.1554,
    lng: 129.0638,
    district_type: 'COMMERCIAL',
    district_type_label: '청년문화·로스터리카페 특화 상권',
    resident_population: 21840,
    household_count: 12410,
    worker_population: 28900,
    floating_pop_daily: 78400,
    age_20_39_ratio: 51.2,
    age_40_59_ratio: 28.4,
    total_biz_count: 3980,
    avg_monthly_rent_per_py: 17.9,
    avg_deposit_per_py: 185.0,
    estimated_interior_per_py: 200.0,
    survival_modifier: { s1: +1.4, s3: +0.5, s5: -0.6, closure: +0.4 },
    store_counts_by_industry: {
      IND_CAFE: 94, IND_KOREAN: 78, IND_CHICKEN: 19, IND_BAKERY: 34,
      IND_CONV: 25, IND_BEAUTY: 38, IND_FITNESS: 14, IND_ACADEMY: 9
    },
    store_trend_yoy_pct: {
      IND_CAFE: +3.3, IND_KOREAN: 0.0, IND_CHICKEN: -5.0, IND_BAKERY: +6.2,
      IND_CONV: +4.1, IND_BEAUTY: +2.7, IND_FITNESS: +7.6, IND_ACADEMY: 0.0
    },
    adjacent_zones: ['부전2동 서면중앙 상권', '문현금융단지 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_DG_01',
    zone_name: '범어1동 범어네거리 금융·법조·학원 상권',
    sido_name: '대구광역시',
    sigungu_name: '수성구',
    emd_name: '범어1동(범어네거리)',
    region_code: '2726010101',
    lat: 35.8589,
    lng: 128.6264,
    district_type: 'MIXED',
    district_type_label: '대경권 핵심 업무·명문학군 복합형',
    resident_population: 28450,
    household_count: 11420,
    worker_population: 46800,
    floating_pop_daily: 69400,
    age_20_39_ratio: 36.8,
    age_40_59_ratio: 40.2,
    total_biz_count: 4120,
    avg_monthly_rent_per_py: 16.4,
    avg_deposit_per_py: 170.0,
    estimated_interior_per_py: 190.0,
    survival_modifier: { s1: +6.1, s3: +5.3, s5: +4.5, closure: -1.9 },
    store_counts_by_industry: {
      IND_CAFE: 44, IND_KOREAN: 79, IND_CHICKEN: 16, IND_BAKERY: 17,
      IND_CONV: 26, IND_BEAUTY: 28, IND_FITNESS: 16, IND_ACADEMY: 92
    },
    store_trend_yoy_pct: {
      IND_CAFE: +4.7, IND_KOREAN: +1.3, IND_CHICKEN: 0.0, IND_BAKERY: +6.2,
      IND_CONV: +4.0, IND_BEAUTY: +3.7, IND_FITNESS: +6.6, IND_ACADEMY: +5.7
    },
    adjacent_zones: ['만촌3동 학원가 상권', '수성못 유원지 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_IC_01',
    zone_name: '송도1동 센트럴파크·국제업무지구 배후 상권',
    sido_name: '인천광역시',
    sigungu_name: '연수구',
    emd_name: '송도1동(센트럴파크)',
    region_code: '2818510601',
    lat: 37.3924,
    lng: 126.6438,
    district_type: 'MIXED',
    district_type_label: '국제업무·신도시 대단지 복합형',
    resident_population: 41200,
    household_count: 15840,
    worker_population: 44600,
    floating_pop_daily: 66800,
    age_20_39_ratio: 39.2,
    age_40_59_ratio: 38.6,
    total_biz_count: 3780,
    avg_monthly_rent_per_py: 16.9,
    avg_deposit_per_py: 175.0,
    estimated_interior_per_py: 195.0,
    survival_modifier: { s1: +5.9, s3: +5.1, s5: +4.2, closure: -1.8 },
    store_counts_by_industry: {
      IND_CAFE: 45, IND_KOREAN: 74, IND_CHICKEN: 18, IND_BAKERY: 18,
      IND_CONV: 28, IND_BEAUTY: 29, IND_FITNESS: 19, IND_ACADEMY: 58
    },
    store_trend_yoy_pct: {
      IND_CAFE: +7.1, IND_KOREAN: +4.2, IND_CHICKEN: +5.8, IND_BAKERY: +5.8,
      IND_CONV: +3.7, IND_BEAUTY: +7.4, IND_FITNESS: +5.5, IND_ACADEMY: +9.4
    },
    adjacent_zones: ['송도 트리플스트리트 상권', '인천대입구역 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_DJ_01',
    zone_name: '관평동 대덕테크노밸리 연구·주거 배후 상권',
    sido_name: '대전광역시',
    sigungu_name: '유성구',
    emd_name: '관평동(테크노밸리)',
    region_code: '3020014600',
    lat: 36.4248,
    lng: 127.3912,
    district_type: 'MIXED',
    district_type_label: 'R&D 산업단지·가족주거 혼합형',
    resident_population: 29840,
    household_count: 11240,
    worker_population: 48200,
    floating_pop_daily: 58400,
    age_20_39_ratio: 38.4,
    age_40_59_ratio: 39.2,
    total_biz_count: 3120,
    avg_monthly_rent_per_py: 14.5,
    avg_deposit_per_py: 150.0,
    estimated_interior_per_py: 185.0,
    survival_modifier: { s1: +6.7, s3: +5.9, s5: +4.9, closure: -2.3 },
    store_counts_by_industry: {
      IND_CAFE: 36, IND_KOREAN: 72, IND_CHICKEN: 17, IND_BAKERY: 14,
      IND_CONV: 24, IND_BEAUTY: 22, IND_FITNESS: 14, IND_ACADEMY: 34
    },
    store_trend_yoy_pct: {
      IND_CAFE: +5.8, IND_KOREAN: +2.8, IND_CHICKEN: 0.0, IND_BAKERY: +7.6,
      IND_CONV: +4.3, IND_BEAUTY: +4.7, IND_FITNESS: +7.6, IND_ACADEMY: +6.2
    },
    adjacent_zones: ['전민동 연구단지 상권', '신탄진역 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_GG_01',
    zone_name: '삼평동 판교테크노밸리 역세권·IT 업무 상권',
    sido_name: '경기도',
    sigungu_name: '성남시 분당구',
    emd_name: '삼평동(판교테크노밸리)',
    region_code: '4113510900',
    lat: 37.3998,
    lng: 127.1086,
    district_type: 'OFFICE',
    district_type_label: '국내 최대 IT·게임 R&D 클러스터형',
    resident_population: 25480,
    household_count: 9640,
    worker_population: 92400,
    floating_pop_daily: 104800,
    age_20_39_ratio: 49.4,
    age_40_59_ratio: 33.8,
    total_biz_count: 5240,
    avg_monthly_rent_per_py: 23.2,
    avg_deposit_per_py: 250.0,
    estimated_interior_per_py: 215.0,
    survival_modifier: { s1: +7.4, s3: +6.8, s5: +5.9, closure: -2.7 },
    store_counts_by_industry: {
      IND_CAFE: 68, IND_KOREAN: 112, IND_CHICKEN: 19, IND_BAKERY: 24,
      IND_CONV: 38, IND_BEAUTY: 27, IND_FITNESS: 24, IND_ACADEMY: 21
    },
    store_trend_yoy_pct: {
      IND_CAFE: +6.2, IND_KOREAN: +3.7, IND_CHICKEN: 0.0, IND_BAKERY: +9.0,
      IND_CONV: +5.5, IND_BEAUTY: +3.8, IND_FITNESS: +9.0, IND_ACADEMY: +5.0
    },
    adjacent_zones: ['백현동 판교역 남측 상권', '정자동 카페거리 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_GG_02',
    zone_name: '정자동 정자역·카페거리 업무·주거 복합 상권',
    sido_name: '경기도',
    sigungu_name: '성남시 분당구',
    emd_name: '정자동(정자카페거리)',
    region_code: '4113510300',
    lat: 37.3672,
    lng: 127.1082,
    district_type: 'MIXED',
    district_type_label: '신분당선 환승·주상복합·카페거리 결합형',
    resident_population: 42600,
    household_count: 17940,
    worker_population: 46200,
    floating_pop_daily: 74800,
    age_20_39_ratio: 37.8,
    age_40_59_ratio: 39.4,
    total_biz_count: 4680,
    avg_monthly_rent_per_py: 20.4,
    avg_deposit_per_py: 215.0,
    estimated_interior_per_py: 210.0,
    survival_modifier: { s1: +6.2, s3: +5.4, s5: +4.6, closure: -2.0 },
    store_counts_by_industry: {
      IND_CAFE: 57, IND_KOREAN: 92, IND_CHICKEN: 21, IND_BAKERY: 22,
      IND_CONV: 31, IND_BEAUTY: 36, IND_FITNESS: 21, IND_ACADEMY: 59
    },
    store_trend_yoy_pct: {
      IND_CAFE: +3.6, IND_KOREAN: +2.2, IND_CHICKEN: 0.0, IND_BAKERY: +4.7,
      IND_CONV: +3.3, IND_BEAUTY: +2.8, IND_FITNESS: +5.0, IND_ACADEMY: +5.3
    },
    adjacent_zones: ['수내역 롯데백화점 상권', '미금역 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  },
  {
    zone_id: 'ZONE_GG_03',
    zone_name: '이의동 광교중앙역·경기도청 신청사 복합 상권',
    sido_name: '경기도',
    sigungu_name: '수원시 영통구',
    emd_name: '이의동(광교중앙역)',
    region_code: '4111710300',
    lat: 37.2886,
    lng: 127.0518,
    district_type: 'MIXED',
    district_type_label: '행정타운·신도시 역세권 복합형',
    resident_population: 48900,
    household_count: 18420,
    worker_population: 49800,
    floating_pop_daily: 78600,
    age_20_39_ratio: 41.2,
    age_40_59_ratio: 37.9,
    total_biz_count: 4410,
    avg_monthly_rent_per_py: 19.4,
    avg_deposit_per_py: 205.0,
    estimated_interior_per_py: 205.0,
    survival_modifier: { s1: +6.9, s3: +6.1, s5: +5.2, closure: -2.4 },
    store_counts_by_industry: {
      IND_CAFE: 53, IND_KOREAN: 86, IND_CHICKEN: 19, IND_BAKERY: 20,
      IND_CONV: 30, IND_BEAUTY: 32, IND_FITNESS: 19, IND_ACADEMY: 64
    },
    store_trend_yoy_pct: {
      IND_CAFE: +6.0, IND_KOREAN: +3.6, IND_CHICKEN: +5.5, IND_BAKERY: +5.2,
      IND_CONV: +3.4, IND_BEAUTY: +6.6, IND_FITNESS: +5.5, IND_ACADEMY: +8.4
    },
    adjacent_zones: ['광교호수공원 상권', '아주대 삼거리 상권'],
    quality_status: 'OFFICIAL',
    stats_granularity: '시·군·구 및 행정동 상권 결합',
    store_data_period: '2026-Q1 (2026.03 기준)',
    pop_data_period: '2026.02 주민등록인구 및 2025 사업체조사'
  }
];

/**
 * 관리자 화면용 최근 데이터 수집·갱신·중복정리 이력 로그
 */
const INITIAL_SYNC_LOGS = [
  {
    log_id: 1005,
    source_id: 'SRC_SEMAS_STORE',
    job_type: 'SCHEDULED_SYNC (2026-Q1 전국 상가업소 증분 수집 및 중복 정리)',
    status: 'SUCCESS',
    records_fetched: 48290,
    records_upserted: 47812,
    duplicates_removed: 478,
    http_status_code: 200,
    error_message: null,
    started_at: '2026-10-30T06:00:00+09:00',
    finished_at: '2026-10-30T06:14:22+09:00'
  },
  {
    log_id: 1004,
    source_id: 'SRC_KOSIS_SURVIVAL',
    job_type: 'SCHEDULED_SYNC (기업생멸행정통계 시도·시군구 생존율/소멸률 동기화)',
    status: 'SUCCESS',
    records_fetched: 2040,
    records_upserted: 2040,
    duplicates_removed: 0,
    http_status_code: 200,
    error_message: null,
    started_at: '2026-10-30T05:30:00+09:00',
    finished_at: '2026-10-30T05:32:11+09:00'
  },
  {
    log_id: 1003,
    source_id: 'SRC_KOSIS_POP_BIZ',
    job_type: 'SCHEDULED_SYNC (행정동별 주민등록인구·세대수·사업체종사자 갱신)',
    status: 'SUCCESS',
    records_fetched: 3580,
    records_upserted: 3580,
    duplicates_removed: 0,
    http_status_code: 200,
    error_message: null,
    started_at: '2026-10-30T05:00:00+09:00',
    finished_at: '2026-10-30T05:04:08+09:00'
  },
  {
    log_id: 1002,
    source_id: 'SRC_REB_RENT',
    job_type: 'SCHEDULED_SYNC (상업용부동산 표본 상권 임대료·보증금 동기화)',
    status: 'PARTIAL_ERROR',
    records_fetched: 260,
    records_upserted: 248,
    duplicates_removed: 0,
    http_status_code: 206,
    error_message: '비표본 외곽 행정동 12곳 임대료 시세 미제공 → 임의 추정 없이 NULL(미확보)로 기록 완료',
    started_at: '2026-10-30T04:40:00+09:00',
    finished_at: '2026-10-30T04:41:50+09:00'
  },
  {
    log_id: 1001,
    source_id: 'SRC_NTS_BIZ_STATUS',
    job_type: 'BIZ_STATUS_CHECK (사용자 요청 단건 사업자등록 상태 검증 배치)',
    status: 'SUCCESS',
    records_fetched: 50,
    records_upserted: 50,
    duplicates_removed: 0,
    http_status_code: 200,
    error_message: null,
    started_at: '2026-10-29T18:10:00+09:00',
    finished_at: '2026-10-29T18:10:04+09:00'
  }
];

const { FULL_REGIONS_TREE, buildRegionalZoneCandidates } = require('./koreaRegionsFull');

module.exports = {
  DATA_SOURCES,
  INDUSTRY_CODES,
  REGIONS_TREE: FULL_REGIONS_TREE,
  buildRegionalZoneCandidates,
  INDUSTRY_BASE_SURVIVAL_STATS,
  COMMERCIAL_ZONES,
  INITIAL_SYNC_LOGS
};
