/**
 * 창업입지 AI - 프런트엔드 애플리케이션 (public/app.js)
 * 기획서의 5개 핵심 화면(검색, TOP 10 지도 추천, 상권 상세, 후보 2~3곳 비교, 창업 분석 보고서, 관리자)을
 * 백엔드 API와 실시간으로 연동합니다.
 */

const state = {
  meta: null,
  analysisResult: null,
  selectedZoneRank: 1,
  compareZoneIds: new Set(),
  clickedLatLng: null,
  map: null,
  zoneMarkersLayer: null,
  competitorMarkersLayer: null,
  radiusCircleLayer: null,
  adminData: null
};

// 숫자 포맷 유틸리티 (결측치는 절대 0이나 임의 숫자로 바꾸지 않고 '미확보 (NULL)'로 표시)
function fmtNum(val, suffix = '') {
  if (val === null || val === undefined || Number.isNaN(val)) {
    return '<span style="color:#d97706;font-weight:600;">미확보 (통계 없음)</span>';
  }
  return `${Number(val).toLocaleString('ko-KR')}${suffix}`;
}

function fmtMoneyManwon(manwon) {
  if (manwon === null || manwon === undefined) {
    return '미확보 (비표본 지역)';
  }
  const n = Number(manwon);
  if (n >= 10000) {
    const eok = Math.floor(n / 10000);
    const rem = n % 10000;
    return rem > 0 ? `${eok}억 ${rem.toLocaleString()}만 원` : `${eok}억 원`;
  }
  return `${n.toLocaleString()}만 원`;
}

// 탭 전환
function switchView(viewId) {
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewId);
  });
  document.querySelectorAll('.view-section').forEach((sec) => {
    sec.classList.toggle('active', sec.id === `view-${viewId}`);
  });

  if (viewId === 'main-analysis' && state.map) {
    setTimeout(() => state.map.invalidateSize(), 100);
  } else if (viewId === 'zone-detail') {
    renderZoneDetailView();
  } else if (viewId === 'zone-compare') {
    loadAndRenderComparison();
  } else if (viewId === 'analysis-report') {
    renderAnalysisReportView();
  } else if (viewId === 'admin-console') {
    loadAndRenderAdminConsole();
  }
}

// Leaflet 지도 초기화
function initMap() {
  state.map = L.map('leafletMap', {
    center: [37.5006, 127.0468],
    zoom: 13
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors | 상가정보·KOSIS 공공데이터 결합'
  }).addTo(state.map);

  state.zoneMarkersLayer = L.layerGroup().addTo(state.map);
  state.competitorMarkersLayer = L.layerGroup().addTo(state.map);
  state.radiusCircleLayer = L.layerGroup().addTo(state.map);

  // 지도에서 직접 위치 선택 지원 (기획서 4.1 요구사항)
  state.map.on('click', (e) => {
    state.clickedLatLng = e.latlng;
    const lat = e.latlng.lat.toFixed(5);
    const lng = e.latlng.lng.toFixed(5);
    document.getElementById('clickedCoordText').textContent =
      `위도 ${lat}, 경도 ${lng} (클릭 지점 기준 반경 표시 완료)`;

    const radiusMeters = Number(document.getElementById('radiusSelect').value) || 500;
    state.radiusCircleLayer.clearLayers();
    L.circle([e.latlng.lat, e.latlng.lng], {
      radius: radiusMeters,
      color: '#2563eb',
      weight: 2,
      fillColor: '#3b82f6',
      fillOpacity: 0.12
    })
      .bindPopup(`<b>사용자 선택 위치</b><br/>분석 반경: ${radiusMeters}m`)
      .addTo(state.radiusCircleLayer)
      .openPopup();
  });
}

// 초기 메타데이터 로드 및 셀렉트 박스 채우기
async function initApp() {
  initMap();

  const metaRes = await fetch('/api/meta');
  state.meta = await metaRes.json();

  const industrySelect = document.getElementById('industrySelect');
  industrySelect.innerHTML = state.meta.industries
    .map(
      (ind) =>
        `<option value="${ind.industry_code}">${ind.industry_name} (${ind.category_middle})</option>`
    )
    .join('');

  industrySelect.addEventListener('change', updateIndustryHint);
  updateIndustryHint();

  const sidoSelect = document.getElementById('sidoSelect');
  sidoSelect.innerHTML = state.meta.regions
    .map((r) => `<option value="${r.sido_name}">${r.sido_name}</option>`)
    .join('');

  sidoSelect.addEventListener('change', () => populateSigunguSelect(sidoSelect.value));
  populateSigunguSelect(sidoSelect.value);

  document.getElementById('sigunguSelect').addEventListener('change', () => {
    populateEmdSelect(sidoSelect.value, document.getElementById('sigunguSelect').value);
  });

  // 예산 입력 힌트 실시간 업데이트
  document.getElementById('budgetInput').addEventListener('input', (e) => {
    document.getElementById('budgetFormattedHint').textContent =
      `약 ${fmtMoneyManwon(e.target.value)} (보증금+시설비 기준)`;
  });

  // 매장 유형 라디오 토글
  document.querySelectorAll('#storeTypeGroup input[name="storeType"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      document.querySelectorAll('#storeTypeGroup .radio-pill').forEach((lbl) => {
        lbl.classList.toggle('active', lbl.querySelector('input').checked);
      });
    });
  });

  // 네비게이션 탭 이벤트
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  document.getElementById('brandHomeBtn').addEventListener('click', () => switchView('main-analysis'));

  // 기획서 예시 프리셋 버튼 (커피숍 + 서울특별시 강남구 + 초기 투자비 1억 원 이하)
  document.getElementById('btnGangnamPreset').addEventListener('click', () => {
    industrySelect.value = 'IND_CAFE';
    document.getElementById('industryKeywordInput').value = '';
    updateIndustryHint();
    sidoSelect.value = '서울특별시';
    populateSigunguSelect('서울특별시');
    document.getElementById('sigunguSelect').value = '강남구';
    populateEmdSelect('서울특별시', '강남구');
    document.getElementById('emdSelect').value = '';
    document.getElementById('radiusSelect').value = '500';
    document.getElementById('budgetInput').value = '10000';
    document.getElementById('rentInput').value = '350';
    document.getElementById('budgetFormattedHint').textContent = '약 1억 원 (보증금+시설비 기준)';
    runSearchAnalysis();
  });

  // 검색 폼 제출
  document.getElementById('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    runSearchAnalysis();
  });

  // 경쟁 점포 표시 토글
  document.getElementById('toggleCompetitorsChk').addEventListener('change', () => {
    renderMapMarkers();
  });

  // 카카오 로컬 주소·장소 검색 버튼
  const kakaoSearchBtn = document.getElementById('btnKakaoPlaceSearch');
  const kakaoSearchInput = document.getElementById('kakaoPlaceSearchInput');
  if (kakaoSearchBtn && kakaoSearchInput) {
    const runKakaoPlaceSearch = async () => {
      const q = kakaoSearchInput.value.trim();
      if (!q) return;
      const res = await fetch('/api/external/kakao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q })
      });
      const data = await res.json();
      const first = data.documents && data.documents[0];
      if (first && first.lat && first.lng) {
        state.clickedLatLng = { lat: Number(first.lat), lng: Number(first.lng) };
        const radiusMeters = Number(document.getElementById('radiusSelect').value) || 500;
        state.map.setView([first.lat, first.lng], 15);
        state.radiusCircleLayer.clearLayers();
        L.circle([first.lat, first.lng], {
          radius: radiusMeters,
          color: '#1d4ed8',
          weight: 2,
          fillColor: '#3b82f6',
          fillOpacity: 0.14
        })
          .bindPopup(`<b>[카카오 로컬 검색] ${first.place_name}</b><br/>${first.address_name || ''}<br/>반경 ${radiusMeters}m`)
          .addTo(state.radiusCircleLayer)
          .openPopup();
        document.getElementById('clickedCoordText').textContent =
          `${first.place_name} (위도 ${Number(first.lat).toFixed(5)}, 경도 ${Number(first.lng).toFixed(5)})`;
      }
    };
    kakaoSearchBtn.addEventListener('click', runKakaoPlaceSearch);
    kakaoSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runKakaoPlaceSearch();
      }
    });
  }

  // 선택 비교 이동 버튼
  document.getElementById('btnGoCompareFromList').addEventListener('click', () => {
    switchView('zone-compare');
  });

  // 비교 화면 빠른 선택 버튼
  document.getElementById('btnAutoPickTop3').addEventListener('click', () => {
    if (!state.analysisResult) return;
    state.compareZoneIds.clear();
    state.analysisResult.top_recommendations.slice(0, 3).forEach((z) => state.compareZoneIds.add(z.zone_id));
    updateCompareBadges();
    renderRankingList();
    loadAndRenderComparison();
  });

  document.getElementById('btnIncludePartialZone').addEventListener('click', () => {
    if (!state.analysisResult) return;
    state.compareZoneIds.clear();
    const top1 = state.analysisResult.top_recommendations[0];
    if (top1) state.compareZoneIds.add(top1.zone_id);
    state.compareZoneIds.add('ZONE_GN_12'); // 세곡동 일부 통계 결측 검증용 상권
    updateCompareBadges();
    renderRankingList();
    loadAndRenderComparison();
  });

  // 보고서 인쇄 버튼
  document.getElementById('btnPrintReport').addEventListener('click', () => {
    window.print();
  });

  // 최초 실행: 기획서 2장 핵심 예시(커피숍 · 서울특별시 강남구 · 초기 투자비 1억 이하) 자동 분석
  await runSearchAnalysis();
}

function updateIndustryHint() {
  const code = document.getElementById('industrySelect').value;
  const ind = state.meta.industries.find((i) => i.industry_code === code);
  if (ind) {
    document.getElementById('industryCodeHint').textContent =
      `상가정보 코드: ${ind.semas_code} ↔ 통계청 KSIC: ${ind.kosis_ksic_code} (기본 ${ind.typical_area_pyeong.GENERAL}평)`;
  }
}

function populateSigunguSelect(sidoName) {
  const sido = state.meta.regions.find((r) => r.sido_name === sidoName) || state.meta.regions[0];
  const sigunguSelect = document.getElementById('sigunguSelect');
  sigunguSelect.innerHTML = sido.sigungu_list
    .map((sg) => `<option value="${sg.sigungu_name}">${sg.sigungu_name}</option>`)
    .join('');
  populateEmdSelect(sido.sido_name, sigunguSelect.value);
}

function populateEmdSelect(sidoName, sigunguName) {
  const sido = state.meta.regions.find((r) => r.sido_name === sidoName) || state.meta.regions[0];
  const sigungu =
    sido.sigungu_list.find((sg) => sg.sigungu_name === sigunguName) || sido.sigungu_list[0];
  const emdSelect = document.getElementById('emdSelect');
  emdSelect.innerHTML =
    `<option value="">${sigungu.sigungu_name} 내 전체 후보 상권 비교</option>` +
    sigungu.emd_list.map((emd) => `<option value="${emd}">${emd}</option>`).join('');
}

// 추천 분석 API 호출
async function runSearchAnalysis() {
  const keywordInput = document.getElementById('industryKeywordInput').value.trim();
  const industryParam = keywordInput || document.getElementById('industrySelect').value;
  const sido = document.getElementById('sidoSelect').value;
  const sigungu = document.getElementById('sigunguSelect').value;
  const emd = document.getElementById('emdSelect').value;
  const radius = document.getElementById('radiusSelect').value;
  const budget = document.getElementById('budgetInput').value;
  const rent = document.getElementById('rentInput').value;
  const storeType = document.querySelector('input[name="storeType"]:checked').value;

  const res = await fetch('/api/recommend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      industry: industryParam,
      sido,
      sigungu,
      emd,
      radius,
      budget,
      rent,
      storeType,
      lat: state.clickedLatLng ? state.clickedLatLng.lat : null,
      lng: state.clickedLatLng ? state.clickedLatLng.lng : null
    })
  });

  const data = await res.json();
  state.analysisResult = data;
  state.selectedZoneRank = 1;

  // 드롭다운을 해석된 표준 업종 코드와 동기화
  document.getElementById('industrySelect').value = data.query_summary.industry_code;
  updateIndustryHint();

  // 기본 비교 대상으로 상위 1·2위 자동 등록 (비교 화면 즉시 체험 가능)
  if (state.compareZoneIds.size === 0 && data.top_recommendations.length >= 2) {
    state.compareZoneIds.add(data.top_recommendations[0].zone_id);
    state.compareZoneIds.add(data.top_recommendations[1].zone_id);
    updateCompareBadges();
  }

  document.getElementById('mapHeaderTitle').textContent =
    `${data.query_summary.sido_name} ${data.query_summary.sigungu_name} · [${data.query_summary.industry_name}] 추천 상권 TOP 10`;
  document.getElementById('mapSubNotice').textContent = data.query_summary.scope_notice;

  renderRankingList();
  renderMapMarkers(true);
}

function updateCompareBadges() {
  const cnt = state.compareZoneIds.size;
  document.getElementById('compareCountPill').textContent = `${cnt}/3`;
  document.getElementById('selectedCompareCountBtn').textContent = String(cnt);
}

// 우측 TOP 10 순위 리스트 렌더링
function renderRankingList() {
  const container = document.getElementById('rankingListContainer');
  const list = (state.analysisResult && state.analysisResult.top_recommendations) || [];

  container.innerHTML = list
    .map((item) => {
      const isSelected = item.rank === state.selectedZoneRank;
      const isChecked = state.compareZoneIds.has(item.zone_id);
      const relClass =
        item.reliability.grade === 'HIGH'
          ? 'tag-rel-high'
          : item.reliability.grade === 'MEDIUM'
          ? 'tag-rel-medium'
          : 'tag-rel-low';

      const surv3 =
        item.survival_closure_stats.survival_rate_3yr != null
          ? `${item.survival_closure_stats.survival_rate_3yr}%`
          : '미확보';
      const closure =
        item.survival_closure_stats.annual_closure_rate != null
          ? `${item.survival_closure_stats.annual_closure_rate}%`
          : '미확보';
      const estCost =
        item.cost_stats.estimated_total_startup_cost_manwon != null
          ? fmtMoneyManwon(item.cost_stats.estimated_total_startup_cost_manwon)
          : '미확보';

      return `
        <div class="rank-card ${isSelected ? 'selected' : ''}" data-rank="${item.rank}">
          <div class="rank-card-top">
            <div class="rank-badge-wrap">
              <span class="rank-num ${item.rank <= 3 ? 'top3' : ''}">${item.rank}</span>
              <div>
                <div class="rank-title">${item.zone_name}</div>
                <div class="subtext">${item.sido_name} ${item.sigungu_name} · ${item.emd_name}</div>
              </div>
            </div>
            <div class="rank-score-box">
              <div class="score-big">${item.total_score}</div>
              <div class="score-unit">종합점수</div>
            </div>
          </div>

          <div class="rank-tags">
            <span class="tag tag-type">${item.district_type_label}</span>
            <span class="tag ${relClass}">신뢰도: ${item.reliability.label}</span>
          </div>

          <div class="rank-metrics-grid">
            <div class="metric-cell">
              <span>3년 생존율</span>
              <strong>${surv3}</strong>
            </div>
            <div class="metric-cell">
              <span>연간 폐업률</span>
              <strong style="color:#e11d48;">${closure}</strong>
            </div>
            <div class="metric-cell">
              <span>경쟁 점포(${state.analysisResult.query_summary.radius_meters}m)</span>
              <strong>${item.competition_stats.same_industry_store_count}개</strong>
            </div>
            <div class="metric-cell">
              <span>추정 초기비용</span>
              <strong>${estCost}</strong>
            </div>
          </div>

          <div class="rank-card-footer">
            <label class="compare-chk-label" onclick="event.stopPropagation();">
              <input type="checkbox" class="compare-chk" data-zone-id="${item.zone_id}" ${isChecked ? 'checked' : ''} />
              <span>비교 담기</span>
            </label>
            <button type="button" class="btn-link-detail" data-detail-rank="${item.rank}">
              상세 분석 및 근거 보기 &rarr;
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  // 카드 클릭 -> 지도 포커스 & 선택 변경
  container.querySelectorAll('.rank-card').forEach((card) => {
    card.addEventListener('click', () => {
      state.selectedZoneRank = Number(card.dataset.rank);
      renderRankingList();
      renderMapMarkers(false);
    });
  });

  // 상세 분석 바로가기 버튼
  container.querySelectorAll('.btn-link-detail').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.selectedZoneRank = Number(btn.dataset.detailRank);
      switchView('zone-detail');
    });
  });

  // 후보 비교 체크박스 (최대 3곳)
  container.querySelectorAll('.compare-chk').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const zId = e.target.dataset.zoneId;
      if (e.target.checked) {
        if (state.compareZoneIds.size >= 3) {
          e.target.checked = false;
          alert('후보 상권 비교는 최대 3곳까지 선택할 수 있습니다.');
          return;
        }
        state.compareZoneIds.add(zId);
      } else {
        state.compareZoneIds.delete(zId);
      }
      updateCompareBadges();
    });
  });
}

// 지도 마커 및 경쟁 점포 공간 분포 렌더링
function renderMapMarkers(fitBounds = false) {
  if (!state.map || !state.analysisResult) return;

  state.zoneMarkersLayer.clearLayers();
  state.competitorMarkersLayer.clearLayers();
  state.radiusCircleLayer.clearLayers();

  const list = state.analysisResult.top_recommendations || [];
  const radiusMeters = state.analysisResult.query_summary.radius_meters || 500;
  const showCompetitors = document.getElementById('toggleCompetitorsChk').checked;
  const latLngs = [];

  list.forEach((item) => {
    const isSelected = item.rank === state.selectedZoneRank;
    latLngs.push([item.lat, item.lng]);

    const markerKind =
      item.reliability.missing_metrics.length > 0
        ? 'partial'
        : item.rank <= 3
        ? 'top3'
        : 'normal';

    const size = isSelected ? 38 : 30;
    const icon = L.divIcon({
      className: '',
      html: `<div class="zone-rank-marker ${markerKind}" style="width:${size}px;height:${size}px;">${item.rank}위</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });

    const marker = L.marker([item.lat, item.lng], { icon }).addTo(state.zoneMarkersLayer);

    const popupHtml = `
      <div style="min-width:230px;font-family:'Pretendard',sans-serif;">
        <div style="font-weight:800;font-size:13.5px;margin-bottom:4px;">
          [${item.rank}위] ${item.zone_name}
        </div>
        <div style="font-size:12px;color:#475569;margin-bottom:6px;">
          종합 <b>${item.total_score}점</b> · ${item.district_type_label}
        </div>
        <div style="font-size:12px;line-height:1.6;">
          • 1년/3년 생존율: <b>${item.survival_closure_stats.survival_rate_1yr ?? '미확보'}% / ${item.survival_closure_stats.survival_rate_3yr ?? '미확보'}%</b><br/>
          • 연간 폐업(소멸)률: <b style="color:#e11d48;">${item.survival_closure_stats.annual_closure_rate ?? '미확보'}%</b><br/>
          • 반경 ${radiusMeters}m 동일 업종: <b>${item.competition_stats.same_industry_store_count}개</b><br/>
          • 데이터 신뢰도: <b>${item.reliability.label}</b>
        </div>
      </div>
    `;
    marker.bindPopup(popupHtml);

    marker.on('click', () => {
      state.selectedZoneRank = item.rank;
      renderRankingList();
      renderMapMarkers(false);
    });

    // 현재 선택된 후보 상권이면 반경 원과 주변 경쟁 점포 마커 표시
    if (isSelected) {
      marker.openPopup();
      L.circle([item.lat, item.lng], {
        radius: radiusMeters,
        color: '#1d4ed8',
        weight: 2,
        fillColor: '#3b82f6',
        fillOpacity: 0.10
      }).addTo(state.radiusCircleLayer);

      if (showCompetitors && item.competition_stats.nearby_stores) {
        item.competition_stats.nearby_stores.forEach((st) => {
          L.circleMarker([st.lat, st.lng], {
            radius: 5,
            color: '#ffffff',
            weight: 1.5,
            fillColor: '#f97316',
            fillOpacity: 0.9
          })
            .bindPopup(
              `<b>${st.store_name}</b><br/>업종: ${st.industry_name} (${st.semas_code})<br/>층정보: ${st.floor_info} · 중심거리 ${st.distance_m}m<br/><span style="font-size:11px;color:#64748b;">${st.observed_status}<br/>* ${st.individual_survival_history_note}</span>`
            )
            .addTo(state.competitorMarkersLayer);
        });
      }
    }
  });

  if (fitBounds && latLngs.length > 0) {
    state.map.fitBounds(latLngs, { padding: [40, 40], maxZoom: 14 });
  } else {
    const selectedItem = list.find((x) => x.rank === state.selectedZoneRank);
    if (selectedItem) {
      state.map.panTo([selectedItem.lat, selectedItem.lng]);
    }
  }
}

// [화면 3] 상권 상세 분석 렌더링
function renderZoneDetailView() {
  const container = document.getElementById('zoneDetailContent');
  if (!state.analysisResult) return;

  const list = state.analysisResult.top_recommendations || [];
  const item = list.find((x) => x.rank === state.selectedZoneRank) || list[0];
  if (!item) return;

  const q = state.analysisResult.query_summary;
  const sc = item.survival_closure_stats;
  const comp = item.competition_stats;
  const dem = item.demand_stats;
  const cost = item.cost_stats;

  const zoneOptionsHtml = list
    .map(
      (z) =>
        `<option value="${z.rank}" ${z.rank === item.rank ? 'selected' : ''}>[${z.rank}위] ${z.zone_name} (종합 ${z.total_score}점)</option>`
    )
    .join('');

  const missingWarningHtml =
    item.reliability.missing_metrics.length > 0
      ? `<div class="warning-callout">
          <strong>[데이터 부족 및 불확실성 경고]</strong>
          해당 상권은 다음 공식 통계 항목이 표본 미제공 상태입니다: <b>${item.reliability.missing_metrics.join(', ')}</b>.
          본 플랫폼은 결측 데이터를 임의의 숫자로 채우지 않으며, 확보된 항목만으로 가중치(${JSON.stringify(item.weights_applied)})를 재정규화하여 산출했습니다.
        </div>`
      : '';

  container.innerHTML = `
    <div class="card detail-header-card">
      <div>
        <div class="subtext">분석 대상 업종: <b>${q.industry_name}</b> (상가정보 ${q.semas_code} / 통계청 KSIC ${q.kosis_ksic_code})</div>
        <h2 style="font-size:20px;margin-top:4px;">[${item.rank}위] ${item.zone_name}</h2>
        <div class="rank-tags" style="margin-top:8px;">
          <span class="tag tag-type">${item.sido_name} ${item.sigungu_name} ${item.emd_name}</span>
          <span class="tag tag-type">${item.district_type_label}</span>
          <span class="tag ${item.reliability.grade === 'HIGH' ? 'tag-rel-high' : 'tag-rel-low'}">
            데이터 신뢰도: ${item.reliability.label} (지표 확보율 ${item.reliability.coverage_pct}%)
          </span>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
        <div>
          <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px;">다른 추천 후보 상권 전환</label>
          <select id="detailZoneSwitcher" style="min-width:290px;">${zoneOptionsHtml}</select>
        </div>
        <div style="text-align:right;background:#eff6ff;padding:10px 16px;border-radius:10px;border:1px solid #bfdbfe;">
          <div style="font-size:11.5px;color:#1e40af;font-weight:600;">종합 추천 점수</div>
          <div style="font-size:24px;font-weight:800;color:#1d4ed8;">${item.total_score} <span style="font-size:13px;">/ 100</span></div>
        </div>
      </div>
    </div>

    ${missingWarningHtml}

    <div class="detail-grid-2">
      <!-- 4.2 업종별 폐업률·생존율 분석 -->
      <div class="card detail-box">
        <h3>
          <span>1. 업종별 생존율 · 폐업(소멸)률 공식 통계 분석</span>
          <span class="tag tag-type">영역 점수: ${item.pillar_scores.survival ?? '미산출'}점 (가중치 ${(item.weights_applied.survival * 100).toFixed(0)}%)</span>
        </h3>

        <div class="stat-definition-callout">
          <strong>[통계 정의 구분 안내]</strong> ${sc.metric_definition}
          개별 점포의 과거 생존 이력이 확인되지 않은 경우 특정 업체의 생존 여부를 추정해 확정 표시하지 않습니다.
        </div>

        <div class="bar-row">
          <div class="bar-label-line">
            <span>1년 생존율 (전국 동일업종 기준 ${sc.national_benchmark.survival_rate_1yr}%)</span>
            <strong>${fmtNum(sc.survival_rate_1yr, '%')}</strong>
          </div>
          <div class="bar-track"><div class="bar-fill emerald" style="width:${sc.survival_rate_1yr || 0}%;"></div></div>
        </div>

        <div class="bar-row">
          <div class="bar-label-line">
            <span>3년 생존율 (전국 동일업종 기준 ${sc.national_benchmark.survival_rate_3yr}%)</span>
            <strong>${fmtNum(sc.survival_rate_3yr, '%')}</strong>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${sc.survival_rate_3yr || 0}%;"></div></div>
        </div>

        <div class="bar-row">
          <div class="bar-label-line">
            <span>5년 생존율 (전국 동일업종 기준 ${sc.national_benchmark.survival_rate_5yr}%)</span>
            <strong>${fmtNum(sc.survival_rate_5yr, '%')}</strong>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${sc.survival_rate_5yr || 0}%;"></div></div>
        </div>

        <div class="bar-row" style="margin-top:14px;">
          <div class="bar-label-line">
            <span>연간 폐업(소멸)률 (당해 활동사업체 대비 소멸 비율 · 전국 ${sc.national_benchmark.annual_closure_rate}%)</span>
            <strong style="color:#e11d48;">${fmtNum(sc.annual_closure_rate, '%')}</strong>
          </div>
          <div class="bar-track"><div class="bar-fill closure" style="width:${Math.min(100, (sc.annual_closure_rate || 0) * 3)}%;"></div></div>
        </div>

        <div class="meta-footnote">
          <span>출처: ${sc.source_name}</span>
          <span>기준연도/관측기간: ${sc.base_year}년 (${sc.observation_period}) · 공표일: ${sc.published_at}</span>
        </div>
      </div>

      <!-- 4.3 경쟁 점포 분석 -->
      <div class="card detail-box">
        <h3>
          <span>2. 동일 업종 경쟁 점포 분포 및 밀집도 분석</span>
          <span class="tag tag-type">영역 점수: ${item.pillar_scores.competition}점 (가중치 ${(item.weights_applied.competition * 100).toFixed(0)}%)</span>
        </h3>

        <table class="data-table">
          <tbody>
            <tr>
              <th>반경 ${q.radius_meters}m 내 동일 업종 점포 수</th>
              <td><strong>${comp.same_industry_store_count}개</strong> (밀집도: ${comp.density_per_km2}개/km²)</td>
            </tr>
            <tr>
              <th>점포 1개당 유효 배후수요 (상주+직장인구)</th>
              <td><strong>약 ${comp.demand_per_store.toLocaleString()}명 / 점포</strong></td>
            </tr>
            <tr>
              <th>전년 동기 대비 점포 수 증감률</th>
              <td><strong>${comp.yoy_store_change_pct > 0 ? `+${comp.yoy_store_change_pct}% 증가` : `${comp.yoy_store_change_pct}%`}</strong></td>
            </tr>
            <tr>
              <th>인접 경쟁 상권 관계</th>
              <td>${comp.adjacent_zones.join(' · ')}</td>
            </tr>
          </tbody>
        </table>

        <div style="margin-top:12px;">
          <div style="font-size:12.5px;font-weight:700;margin-bottom:6px;">반경 내 주요 경쟁 점포 표본 (상가정보 API 좌표 기준)</div>
          <div style="max-height:135px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px;padding:8px;font-size:12px;">
            ${comp.nearby_stores
              .slice(0, 8)
              .map(
                (st) =>
                  `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #f1f5f9;">
                    <span><b>${st.store_name}</b> (${st.floor_info})</span>
                    <span style="color:#64748b;">중심거리 ${st.distance_m}m · ${st.observed_status}</span>
                  </div>`
              )
              .join('')}
          </div>
        </div>

        <div class="meta-footnote">
          <span>출처: ${comp.source_name}</span>
          <span>관측 기준: ${comp.observation_period}</span>
        </div>
      </div>

      <!-- 4.4 상권 수요 분석 -->
      <div class="card detail-box">
        <h3>
          <span>3. 상권 배후 수요 (인구·가구·직장인구·유동인구)</span>
          <span class="tag tag-type">영역 점수: ${item.pillar_scores.demand}점 (가중치 ${(item.weights_applied.demand * 100).toFixed(0)}%)</span>
        </h3>

        <table class="data-table">
          <tbody>
            <tr>
              <th>주민등록 상주인구 / 가구 수</th>
              <td><strong>${fmtNum(dem.resident_population, '명')}</strong> / ${fmtNum(dem.household_count, '세대')}</td>
            </tr>
            <tr>
              <th>사업체 종사자(직장) 인구</th>
              <td><strong>${fmtNum(dem.worker_population, '명')}</strong> (전체 사업체 ${fmtNum(dem.total_biz_count, '개')})</td>
            </tr>
            <tr>
              <th>일평균 유동인구 (공공 상권센서)</th>
              <td><strong>${fmtNum(dem.floating_pop_daily, '명/일')}</strong></td>
            </tr>
            <tr>
              <th>핵심 소비 연령대 구조</th>
              <td>20~39세 <b>${fmtNum(dem.age_20_39_ratio, '%')}</b> · 40~59세 <b>${fmtNum(dem.age_40_59_ratio, '%')}</b></td>
            </tr>
            <tr>
              <th>상권 특성 분류</th>
              <td><strong>${item.district_type_label} (${item.district_type})</strong></td>
            </tr>
          </tbody>
        </table>

        <div class="meta-footnote">
          <span>출처: ${dem.source_name}</span>
          <span>기준 시점: ${dem.observation_period}</span>
        </div>
      </div>

      <!-- 임대료 및 창업비용 분석 -->
      <div class="card detail-box">
        <h3>
          <span>4. 임대료 시세 및 초기 창업비용 부담 분석</span>
          <span class="tag tag-type">영역 점수: ${item.pillar_scores.cost ?? '미산출'}점 (가중치 ${(item.weights_applied.cost * 100).toFixed(0)}%)</span>
        </h3>

        <table class="data-table">
          <tbody>
            <tr>
              <th>적용 매장 유형 및 기준 면적</th>
              <td><strong>${cost.store_type}</strong> (기준 전용 <b>${cost.reference_area_pyeong}평</b>)</td>
            </tr>
            <tr>
              <th>평당 월평균 임대료 / 평당 보증금</th>
              <td>월 ${fmtNum(cost.avg_monthly_rent_per_py, '만 원/평')} / 보증금 ${fmtNum(cost.avg_deposit_per_py, '만 원/평')}</td>
            </tr>
            <tr>
              <th>추정 월 임대료 (한도 ${fmtMoneyManwon(cost.rent_limit_manwon)})</th>
              <td>
                <strong>${fmtMoneyManwon(cost.estimated_monthly_rent_manwon)}</strong>
                ${
                  cost.is_within_rent === true
                    ? '<span class="tag tag-rel-high" style="margin-left:6px;">한도 이내</span>'
                    : cost.is_within_rent === false
                    ? '<span class="tag tag-rel-low" style="margin-left:6px;">한도 초과 주의</span>'
                    : ''
                }
              </td>
            </tr>
            <tr>
              <th>추정 초기 투자비 (보증금+기본시설비 · 한도 ${fmtMoneyManwon(cost.budget_limit_manwon)})</th>
              <td>
                <strong>${fmtMoneyManwon(cost.estimated_total_startup_cost_manwon)}</strong>
                ${
                  cost.is_within_budget === true
                    ? '<span class="tag tag-rel-high" style="margin-left:6px;">예산 적합</span>'
                    : cost.is_within_budget === false
                    ? '<span class="tag tag-rel-low" style="margin-left:6px;">예산 초과 주의</span>'
                    : ''
                }
              </td>
            </tr>
          </tbody>
        </table>

        <div class="meta-footnote">
          <span>출처: ${cost.source_name}</span>
          <span>기준 시점: ${cost.observation_period} (권리금·별도 철거비 제외)</span>
        </div>
      </div>
    </div>

    <!-- 장점 및 위험 요인 -->
    <div class="card detail-box">
      <h3>5. 후보 상권 핵심 장점 및 위험 요인 (추천 근거 연결)</h3>
      <div class="pros-cons-grid">
        <div>
          <div style="font-weight:700;color:#065f46;margin-bottom:8px;">추천 근거 및 기회 요인 (Strengths)</div>
          <ul class="list-pros">
            ${item.strengths.map((s) => `<li>✓ ${s}</li>`).join('')}
          </ul>
        </div>
        <div>
          <div style="font-weight:700;color:#9f1239;margin-bottom:8px;">위험 요인 및 현장 필수 확인 사항 (Risk Factors)</div>
          <ul class="list-risks">
            ${item.risk_factors.map((r) => `<li>⚠ ${r}</li>`).join('')}
          </ul>
        </div>
      </div>
    </div>
  `;

  document.getElementById('detailZoneSwitcher').addEventListener('change', (e) => {
    state.selectedZoneRank = Number(e.target.value);
    renderZoneDetailView();
    renderRankingList();
    renderMapMarkers(false);
  });
}

// [화면 4] 후보 상권 2~3곳 비교 로드 및 렌더링
async function loadAndRenderComparison() {
  const container = document.getElementById('compareTableContainer');
  const zoneIds = Array.from(state.compareZoneIds);

  if (zoneIds.length < 2) {
    container.innerHTML = `
      <div style="padding:32px;text-align:center;color:#64748b;">
        비교할 후보 상권을 2곳 이상(최대 3곳) 선택해주세요.<br/>
        우측 상단의 <b>[상위 1·2·3위 자동 선택]</b> 버튼을 누르면 즉시 비교표를 확인할 수 있습니다.
      </div>
    `;
    return;
  }

  const q = state.analysisResult ? state.analysisResult.query_summary : {};
  const res = await fetch('/api/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      zoneIds,
      queryParams: {
        industry: q.industry_code || 'IND_CAFE',
        radius: q.radius_meters || 500,
        budget: q.budget_limit_manwon || 10000,
        rent: q.rent_limit_manwon || 350,
        storeType: q.store_type || 'GENERAL'
      }
    })
  });

  const data = await res.json();
  const cands = data.candidates || [];
  const summary = data.comparison_summary;

  const warningListHtml =
    summary && summary.uncertainty_warnings && summary.uncertainty_warnings.length > 0
      ? `<div style="margin-top:8px;color:#92400e;background:#fffbeb;padding:8px 12px;border-radius:6px;border:1px solid #fde68a;">
          <strong>[데이터 누락 및 불확실성 고지]</strong><br/>
          ${summary.uncertainty_warnings.join('<br/>')}
        </div>`
      : '';

  container.innerHTML = `
    ${
      summary
        ? `<div class="compare-summary-banner">
            <strong>[비교 요약 결론]</strong> 비교 대상 중 <b>${summary.leader_zone_name}</b>이(가) 점수 차이 <b>+${summary.score_gap}점</b>으로 우세합니다.<br/>
            ${summary.key_difference}
            ${warningListHtml}
          </div>`
        : ''
    }
    <div class="compare-table-wrap">
      <table class="compare-table">
        <thead>
          <tr>
            <th style="width:210px;">비교 항목 (업종: ${data.industry.industry_name})</th>
            ${cands
              .map(
                (c, i) => `
                <th>
                  <div style="font-size:14px;color:#0f172a;">후보 ${i + 1}. ${c.zone_name}</div>
                  <div style="font-size:11.5px;color:#64748b;font-weight:500;">${c.sido_name} ${c.sigungu_name} ${c.emd_name} · ${c.district_type_label}</div>
                </th>
              `
              )
              .join('')}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>종합 평가 점수 (100점 만점)</th>
            ${cands.map((c) => `<td><strong style="font-size:18px;color:#1d4ed8;">${c.total_score}점</strong></td>`).join('')}
          </tr>
          <tr>
            <th>데이터 신뢰도 및 결측 여부</th>
            ${cands
              .map(
                (c) => `
                <td>
                  <span class="tag ${c.reliability.grade === 'HIGH' ? 'tag-rel-high' : 'tag-rel-low'}">${c.reliability.label}</span>
                  <div style="font-size:11.5px;color:#64748b;margin-top:4px;">
                    지표 확보율: ${c.reliability.coverage_pct}%
                    ${c.reliability.missing_metrics.length > 0 ? `<br/><span style="color:#d97706;">미확보: ${c.reliability.missing_metrics.join(', ')}</span>` : '<br/>필수 공공통계 전항목 확보'}
                  </div>
                </td>
              `
              )
              .join('')}
          </tr>
          <tr>
            <th>1년 / 3년 / 5년 생존율 (KOSIS 코호트)</th>
            ${cands
              .map(
                (c) => `
                <td>
                  1년: <b>${fmtNum(c.survival_closure_stats.survival_rate_1yr, '%')}</b><br/>
                  3년: <b>${fmtNum(c.survival_closure_stats.survival_rate_3yr, '%')}</b><br/>
                  5년: <b>${fmtNum(c.survival_closure_stats.survival_rate_5yr, '%')}</b>
                </td>
              `
              )
              .join('')}
          </tr>
          <tr>
            <th>연간 폐업(소멸)률 (활동사업체 대비)</th>
            ${cands
              .map(
                (c) => `
                <td>
                  <strong style="color:#e11d48;">${fmtNum(c.survival_closure_stats.annual_closure_rate, '%')}</strong>
                  <span style="font-size:11.5px;color:#64748b;">(전국 평균 ${c.survival_closure_stats.national_benchmark.annual_closure_rate}%)</span>
                </td>
              `
              )
              .join('')}
          </tr>
          <tr>
            <th>동일 업종 경쟁 점포 수 및 밀집도</th>
            ${cands
              .map(
                (c) => `
                <td>
                  <b>${c.competition_stats.same_industry_store_count}개</b> (${c.competition_stats.density_per_km2}개/km²)<br/>
                  <span style="font-size:11.5px;color:#64748b;">점포당 유효수요: ${c.competition_stats.demand_per_store.toLocaleString()}명</span>
                </td>
              `
              )
              .join('')}
          </tr>
          <tr>
            <th>배후 인구 (상주 / 직장 / 일유동)</th>
            ${cands
              .map(
                (c) => `
                <td>
                  상주: ${fmtNum(c.demand_stats.resident_population, '명')}<br/>
                  직장: ${fmtNum(c.demand_stats.worker_population, '명')}<br/>
                  유동: ${fmtNum(c.demand_stats.floating_pop_daily, '명/일')}
                </td>
              `
              )
              .join('')}
          </tr>
          <tr>
            <th>추정 초기 투자비 / 월 임대료 (${cands[0]?.cost_stats.reference_area_pyeong || 15}평 기준)</th>
            ${cands
              .map(
                (c) => `
                <td>
                  초기비용: <b>${fmtMoneyManwon(c.cost_stats.estimated_total_startup_cost_manwon)}</b><br/>
                  월임대료: <b>${fmtMoneyManwon(c.cost_stats.estimated_monthly_rent_manwon)}</b>
                </td>
              `
              )
              .join('')}
          </tr>
          <tr>
            <th>핵심 강점 (Strengths)</th>
            ${cands.map((c) => `<td>${c.strengths.map((s) => `• ${s}`).join('<br/>')}</td>`).join('')}
          </tr>
          <tr>
            <th>위험 요인 및 주의사항 (Risks)</th>
            ${cands.map((c) => `<td style="color:#9f1239;">${c.risk_factors.map((r) => `• ${r}`).join('<br/>')}</td>`).join('')}
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

// [화면 5-A] 창업 분석 보고서 렌더링
function renderAnalysisReportView() {
  const container = document.getElementById('reportDocumentContainer');
  if (!state.analysisResult) return;

  const r = state.analysisResult;
  const q = r.query_summary;
  const top10 = r.top_recommendations || [];
  const top1 = top10[0];

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:16px;">
      <div>
        <div style="font-size:12px;color:#2563eb;font-weight:700;">창업입지 AI · 공공데이터 기반 상권 분석 리포트</div>
        <h1 style="font-size:22px;margin-top:4px;">[${q.sido_name} ${q.sigungu_name}] ${q.industry_name} 창업 입지 추천 보고서</h1>
        <p style="font-size:12.5px;color:#475569;margin-top:4px;">
          분석 ID: ${r.analysis_id} · 생성일시: ${new Date(r.generated_at).toLocaleString('ko-KR')}
        </p>
      </div>
      <div style="text-align:right;font-size:12px;color:#475569;">
        <div>분석 반경: <b>${q.radius_meters}m</b> · 매장유형: <b>${q.store_type} (${q.reference_area_pyeong}평)</b></div>
        <div>초기 투자 예산 한도: <b>${fmtMoneyManwon(q.budget_limit_manwon)}</b></div>
        <div>월 임대료 한도: <b>${fmtMoneyManwon(q.rent_limit_manwon)}</b></div>
      </div>
    </div>

    <div class="stat-definition-callout" style="margin-top:16px;">
      <strong>[보고서 활용 및 한계 고지]</strong> ${r.disclaimer}
    </div>

    <div class="report-section">
      <h3>1. 추천 상권 TOP 10 종합 요약표</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>순위</th>
            <th>후보 상권명 (행정동)</th>
            <th>상권 유형</th>
            <th>종합 점수</th>
            <th>1년 / 3년 / 5년 생존율</th>
            <th>연간 폐업률</th>
            <th>동일업종 점포수</th>
            <th>추정 초기비용 (월임대료)</th>
            <th>데이터 신뢰도</th>
          </tr>
        </thead>
        <tbody>
          ${top10
            .map(
              (item) => `
              <tr>
                <td><b>${item.rank}위</b></td>
                <td><b>${item.zone_name}</b><br/><span style="font-size:11px;color:#64748b;">${item.emd_name}</span></td>
                <td>${item.district_type_label}</td>
                <td><b style="color:#1d4ed8;">${item.total_score}점</b></td>
                <td>${item.survival_closure_stats.survival_rate_1yr ?? '-'}% / ${item.survival_closure_stats.survival_rate_3yr ?? '-'}% / ${item.survival_closure_stats.survival_rate_5yr ?? '미확보'}%</td>
                <td style="color:#e11d48;font-weight:700;">${item.survival_closure_stats.annual_closure_rate ?? '-'}%</td>
                <td>${item.competition_stats.same_industry_store_count}개</td>
                <td>${fmtMoneyManwon(item.cost_stats.estimated_total_startup_cost_manwon)}<br/><span style="font-size:11px;color:#64748b;">(월 ${fmtMoneyManwon(item.cost_stats.estimated_monthly_rent_manwon)})</span></td>
                <td>${item.reliability.label}</td>
              </tr>
            `
            )
            .join('')}
        </tbody>
      </table>
    </div>

    ${
      top1
        ? `
      <div class="report-section">
        <h3>2. 1순위 추천 상권(${top1.zone_name}) 심층 분석 및 현장 점검 체크리스트</h3>
        <div class="pros-cons-grid" style="margin-top:10px;">
          <div>
            <div style="font-weight:700;margin-bottom:6px;color:#065f46;">핵심 추천 근거</div>
            <ul class="list-pros">${top1.strengths.map((s) => `<li>✓ ${s}</li>`).join('')}</ul>
          </div>
          <div>
            <div style="font-weight:700;margin-bottom:6px;color:#9f1239;">위험 요인 및 계약 전 필수 확인 사항</div>
            <ul class="list-risks">${top1.risk_factors.map((rk) => `<li>⚠ ${rk}</li>`).join('')}</ul>
          </div>
        </div>
      </div>
    `
        : ''
    }

    <div class="report-section">
      <h3>3. 데이터 비교 가능성 검증 및 산출 기준</h3>
      <table class="data-table">
        <tbody>
          <tr>
            <th style="width:220px;">표준 업종 매핑 기준</th>
            <td>${r.comparability_check.industry_standard_mapping}</td>
          </tr>
          <tr>
            <th>공간 단위 정합성</th>
            <td>${r.comparability_check.spatial_alignment_note}</td>
          </tr>
          <tr>
            <th>관측 기간 및 시점 정합성</th>
            <td>${r.comparability_check.temporal_alignment_note}</td>
          </tr>
          <tr>
            <th>결측치(Missing Data) 처리 원칙</th>
            <td>${r.comparability_check.missing_data_policy}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="report-section">
      <h3>4. 활용 공공데이터 출처 및 기준일 명세</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>제공기관</th>
            <th>데이터셋 / API 명칭</th>
            <th>갱신 주기</th>
            <th>제공 지역 단위</th>
            <th>최근 검증 시각</th>
          </tr>
        </thead>
        <tbody>
          ${r.data_sources_used
            .map(
              (src) => `
              <tr>
                <td><b>${src.provider_name}</b></td>
                <td>${src.dataset_name}<br/><span style="font-size:11px;color:#64748b;">${src.official_url}</span></td>
                <td>${src.update_cycle}</td>
                <td>${src.spatial_granularity}</td>
                <td>${new Date(src.last_verified_at).toLocaleString('ko-KR')}</td>
              </tr>
            `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

// [화면 5-B] 관리자 대시보드 및 5대 외부 API 연동 센터 로드·렌더링
async function loadAndRenderAdminConsole() {
  const container = document.getElementById('adminConsoleContainer');
  const res = await fetch('/api/admin/overview');
  const admin = await res.json();
  state.adminData = admin;

  const catalog = (admin.security_status && admin.security_status.catalog) || [];

  container.innerHTML = `
    <!-- 5대 공식 외부 API 실시간 연동 및 인증키 설정 허브 -->
    <div class="card detail-box" style="border:2px solid #2563eb;background:#f8fbff;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:14px;">
        <div>
          <span class="tag tag-rel-high" style="margin-bottom:4px;display:inline-block;">5대 핵심 공공·지도 OpenAPI 연동 완료</span>
          <h2 style="font-size:18px;color:#0f172a;">5대 외부 API 실시간 연동 센터 (소상공인 상가정보 · 국세청 · KOSIS · 공공데이터포털 · 카카오맵)</h2>
          <p class="subtext">
            서버 환경변수(<code>.env</code>) 또는 아래 런타임 금고에 발급받은 인증키를 입력하면 즉시 실시간 외부 API를 호출하며, 키 미입력/점검 시에는 내부 표준 적재 데이터로 무중단 폴백됩니다.
          </p>
        </div>
        <button type="button" class="btn-primary" id="btnTestAll5Apis">
          5대 외부 API 일괄 호출 & 정규화 검증 실행
        </button>
      </div>

      <!-- 런타임 인증키 주입 폼 (서버 메모리에만 보관, 프런트 노출 차단) -->
      <div style="background:#ffffff;border:1px solid #cbd5e1;border-radius:10px;padding:14px;margin-bottom:16px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:8px;color:#1e293b;">
          🔑 API 인증키 런타임 설정 (서버 메모리 보안 격리 · 로그/클라이언트 평문 노출 차단)
        </div>
        <div class="admin-grid-3">
          <div class="form-group">
            <label>공공데이터포털 서비스키 (상가정보 · 국세청 · 지역통계 공통)</label>
            <input type="text" id="inputDataGoKrKey" placeholder="DATA_GO_KR_SERVICE_KEY (Decoding/Encoding 키 모두 지원)" />
            <div class="field-hint">현재 상태: <b>${admin.security_status.configured_keys.DATA_GO_KR_SERVICE_KEY}</b></div>
          </div>
          <div class="form-group">
            <label>통계청 KOSIS OpenAPI 인증키 (기업생멸·생존율·인구)</label>
            <input type="text" id="inputKosisKey" placeholder="KOSIS_API_KEY 입력" />
            <div class="field-hint">현재 상태: <b>${admin.security_status.configured_keys.KOSIS_API_KEY}</b></div>
          </div>
          <div class="form-group">
            <label>카카오 개발자센터 REST API 키 (주소·장소·행정동 좌표변환)</label>
            <input type="text" id="inputKakaoRestKey" placeholder="KAKAO_REST_API_KEY 입력" />
            <div class="field-hint">현재 상태: <b>${admin.security_status.configured_keys.KAKAO_REST_API_KEY}</b></div>
          </div>
        </div>
        <div style="margin-top:10px;display:flex;justify-content:flex-end;gap:8px;align-items:center;">
          <span id="keySaveFeedback" style="font-size:12px;color:#059669;font-weight:600;"></span>
          <button type="button" class="btn-secondary-sm" id="btnSaveRuntimeKeys">인증키 적용 및 실시간 모드 전환</button>
        </div>
      </div>

      <!-- 5대 공식 API 카탈로그 및 개별 호출 테스트 테이블 -->
      <table class="data-table" style="background:#fff;">
        <thead>
          <tr>
            <th>연동 API 명칭 및 공식 사이트</th>
            <th>실제 호출 엔드포인트 및 오퍼레이션</th>
            <th>내부 DB 적재 테이블</th>
            <th>개별 연동 테스트</th>
          </tr>
        </thead>
        <tbody>
          ${catalog
            .map(
              (api) => `
              <tr>
                <td>
                  <b>${api.title}</b><br/>
                  <a href="${api.official_portal_url}" target="_blank" rel="noopener" style="font-size:11.5px;color:#2563eb;text-decoration:underline;">
                    ${api.official_portal_url} ↗
                  </a>
                </td>
                <td>
                  <code style="font-size:11.5px;color:#0f172a;">${api.base_endpoint}</code>
                  <div style="font-size:11.5px;color:#475569;margin-top:4px;">
                    ${api.operations.map((op) => `• <b>[${op.method}] ${op.path}</b>: ${op.desc}`).join('<br/>')}
                  </div>
                </td>
                <td><code>${api.target_db_table}</code><br/><span class="tag tag-type">${api.priority}</span></td>
                <td>
                  <button type="button" class="btn-secondary-sm btn-test-single-api" data-api-id="${api.api_id}">
                    실시간 호출 & 정규화 확인
                  </button>
                </td>
              </tr>
            `
            )
            .join('')}
        </tbody>
      </table>

      <!-- 실시간 API 호출 및 정규화 결과 출력 콘솔 -->
      <div style="margin-top:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <strong style="font-size:13px;color:#0f172a;">📡 외부 API 호출 및 내부 표준 스키마 정규화(Normalization) 실시간 결과</strong>
          <span style="font-size:11.5px;color:#64748b;">버튼 클릭 시 실제 엔드포인트 요청 및 정규화 파이프라인 결과를 아래에 표시합니다.</span>
        </div>
        <pre id="externalApiTestOutput" class="code-block" style="max-height:280px;">상단의 [5대 외부 API 일괄 호출 & 정규화 검증 실행] 또는 각 API 우측의 [실시간 호출 & 정규화 확인] 버튼을 클릭하세요.</pre>
      </div>
    </div>

    <div class="admin-grid-3">
      <div class="card detail-box">
        <h3>API 인증키 보안 및 환경변수 격리 상태</h3>
        <p class="subtext">프런트엔드 키 노출 여부: <b style="color:#059669;">노출 없음 (서버 환경변수 전용)</b></p>
        <div style="margin-top:10px;font-size:12.5px;display:flex;flex-direction:column;gap:6px;">
          <div>• 공공데이터포털 키: <b>${admin.security_status.configured_keys.DATA_GO_KR_SERVICE_KEY}</b></div>
          <div>• 통계청 KOSIS 키: <b>${admin.security_status.configured_keys.KOSIS_API_KEY}</b></div>
          <div>• 카카오 로컬/지도: <b>${admin.security_status.configured_keys.KAKAO_REST_API_KEY}</b></div>
        </div>
      </div>

      <div class="card detail-box">
        <h3>내부 DB 적재 품질 및 중복 정리 현황</h3>
        <p class="subtext">기준: ${admin.quality_summary.duplicate_cleaning_policy}</p>
        <div style="margin-top:10px;font-size:12.5px;display:flex;flex-direction:column;gap:6px;">
          <div>• 관리 중인 전국 표본 상권: <b>${admin.quality_summary.total_zones}곳</b></div>
          <div>• 공식 통계 전항목 확보 상권: <b style="color:#059669;">${admin.quality_summary.official_verified_zones}곳</b></div>
          <div>• 일부 통계 미확보(결측 경고) 상권: <b style="color:#d97706;">${admin.quality_summary.partial_coverage_zones}곳</b></div>
        </div>
      </div>

      <div class="card detail-box">
        <h3>국세청 사업자등록 상태조회 단건 검증기 (보조 API)</h3>
        <p class="subtext">사업자등록번호를 알고 있는 특정 대상의 현재 영업 상태만 확인합니다.</p>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <input type="text" id="ntsBizNoInput" placeholder="사업자번호 10자리 (예: 120-81-47521)" value="120-81-47521" />
          <button type="button" class="btn-primary" id="btnVerifyBizNo" style="white-space:nowrap;">상태 조회</button>
        </div>
        <div id="ntsVerifyResultBox" style="margin-top:8px;font-size:12px;color:#334155;"></div>
      </div>
    </div>

    <!-- 외부 API 연결 상태 및 수동 동기화 -->
    <div class="card detail-box">
      <h3>1. 외부 공공데이터 API 연결 상태 및 호출 한도 관리</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>출처 ID</th>
            <th>제공기관 및 API 명</th>
            <th>우선순위</th>
            <th>갱신 주기</th>
            <th>일일 호출량 / 한도</th>
            <th>최근 정상 확인 시각</th>
            <th>수동 수집·검증</th>
          </tr>
        </thead>
        <tbody>
          ${admin.data_sources
            .map(
              (s) => `
              <tr>
                <td><code>${s.source_id}</code></td>
                <td>
                  <b>${s.provider_name}</b> - ${s.dataset_name}<br/>
                  <a href="${s.official_url}" target="_blank" rel="noopener" style="font-size:11px;color:#2563eb;">${s.official_url}</a>
                </td>
                <td><span class="tag tag-type">${s.priority}</span></td>
                <td>${s.update_cycle}</td>
                <td>${s.daily_quota_used.toLocaleString()} / ${s.daily_quota_limit.toLocaleString()}건</td>
                <td>${new Date(s.last_verified_at).toLocaleString('ko-KR')}</td>
                <td>
                  <button type="button" class="btn-secondary-sm btn-trigger-sync" data-source-id="${s.source_id}">
                    즉시 갱신·중복점검
                  </button>
                </td>
              </tr>
            `
            )
            .join('')}
        </tbody>
      </table>
    </div>

    <!-- 수집 및 오류 로그 -->
    <div class="card detail-box">
      <h3>2. 데이터 수집 · 갱신 · 오류 로그 (api_sync_logs)</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>로그 ID</th>
            <th>출처 ID</th>
            <th>작업 유형</th>
            <th>상태</th>
            <th>수집 건수 / 적재 건수 / 중복 제거</th>
            <th>오류 및 결측 처리 내역</th>
            <th>완료 시각</th>
          </tr>
        </thead>
        <tbody>
          ${admin.sync_logs
            .map(
              (log) => `
              <tr>
                <td>#${log.log_id}</td>
                <td><code>${log.source_id}</code></td>
                <td>${log.job_type}</td>
                <td>
                  <span class="tag ${log.status === 'SUCCESS' ? 'tag-rel-high' : 'tag-rel-low'}">${log.status}</span>
                </td>
                <td>수집 ${log.records_fetched.toLocaleString()} / 적재 ${log.records_upserted.toLocaleString()} / 중복제거 ${log.duplicates_removed}</td>
                <td>${log.error_message || '<span style="color:#64748b;">정상 처리 완료</span>'}</td>
                <td>${new Date(log.finished_at).toLocaleString('ko-KR')}</td>
              </tr>
            `
            )
            .join('')}
        </tbody>
      </table>
    </div>

    <!-- 표준 업종 코드 및 PostgreSQL + PostGIS DDL 스키마 -->
    <div class="detail-grid-2">
      <div class="card detail-box">
        <h3>3. 표준 업종 코드 매핑 관리 (상가정보 ↔ 통계청 KSIC)</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>내부 표준코드</th>
              <th>표준 업종명</th>
              <th>상가정보 코드</th>
              <th>KOSIS KSIC</th>
              <th>기준 평수(일반/테이크아웃/대형)</th>
            </tr>
          </thead>
          <tbody>
            ${admin.industry_codes
              .map(
                (ind) => `
                <tr>
                  <td><code>${ind.industry_code}</code></td>
                  <td><b>${ind.industry_name}</b></td>
                  <td><code>${ind.semas_code}</code></td>
                  <td><code>${ind.kosis_ksic_code}</code></td>
                  <td>${ind.typical_area_pyeong.GENERAL}평 / ${ind.typical_area_pyeong.TAKEOUT}평 / ${ind.typical_area_pyeong.LARGE}평</td>
                </tr>
              `
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <div class="card detail-box">
        <h3>4. PostgreSQL + PostGIS 공간 데이터베이스 스키마 (db/schema.sql)</h3>
        <pre class="code-block">${admin.schema_sql.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
      </div>
    </div>
  `;

  // 런타임 인증키 저장 버튼
  document.getElementById('btnSaveRuntimeKeys').addEventListener('click', async () => {
    const payload = {};
    const dKey = document.getElementById('inputDataGoKrKey').value.trim();
    const kKey = document.getElementById('inputKosisKey').value.trim();
    const kaKey = document.getElementById('inputKakaoRestKey').value.trim();
    if (dKey) payload.DATA_GO_KR_SERVICE_KEY = dKey;
    if (kKey) payload.KOSIS_API_KEY = kKey;
    if (kaKey) payload.KAKAO_REST_API_KEY = kaKey;

    await fetch('/api/external/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    await loadAndRenderAdminConsole();
    const fb = document.getElementById('keySaveFeedback');
    if (fb) fb.textContent = '✓ 인증키가 서버 런타임 금고에 안전하게 반영되었습니다.';
  });

  // 5대 API 전체 일괄 호출 테스트
  document.getElementById('btnTestAll5Apis').addEventListener('click', async () => {
    const out = document.getElementById('externalApiTestOutput');
    out.textContent = '5대 외부 API(상가정보, 국세청, KOSIS, 공공데이터포털 지역통계, 카카오 로컬) 호출 및 정규화 중...';
    const resDiag = await fetch('/api/external/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiId: 'ALL' })
    });
    const json = await resDiag.json();
    out.textContent = JSON.stringify(json, null, 2);
  });

  // 개별 API 호출 테스트 버튼
  container.querySelectorAll('.btn-test-single-api').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const apiId = btn.dataset.apiId;
      const out = document.getElementById('externalApiTestOutput');
      out.textContent = `[${apiId}] API 엔드포인트 호출 및 내부 DB 스키마 정규화 실행 중...`;
      const resDiag = await fetch('/api/external/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiId })
      });
      const json = await resDiag.json();
      out.textContent = JSON.stringify(json, null, 2);
    });
  });

  // 국세청 사업자번호 조회 이벤트
  document.getElementById('btnVerifyBizNo').addEventListener('click', async () => {
    const bizNo = document.getElementById('ntsBizNoInput').value;
    const res = await fetch('/api/nts/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bizNo })
    });
    const result = await res.json();
    const box = document.getElementById('ntsVerifyResultBox');
    if (!result.valid_format) {
      box.innerHTML = `<span style="color:#e11d48;font-weight:700;">${result.error}</span>`;
      return;
    }
    box.innerHTML = `
      <div style="background:#f8fafc;border:1px solid #cbd5e1;padding:8px 10px;border-radius:6px;">
        <div>• 사업자번호: <b>${result.b_no_masked}</b> → 현재 상태: <b style="color:#1d4ed8;">${result.b_stt}</b> (${result.tax_type})</div>
        <div style="font-size:11px;color:#64748b;margin-top:3px;">* 호출 엔드포인트: <code>${result.endpoint_called || 'https://api.odcloud.kr/api/nts-businessman/v1/status'}</code></div>
        <div style="font-size:11px;color:#64748b;margin-top:2px;">* ${result.policy_notice}</div>
      </div>
    `;
  });

  // 수동 동기화 트리거 이벤트
  container.querySelectorAll('.btn-trigger-sync').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sourceId = btn.dataset.sourceId;
      await fetch('/api/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId })
      });
      await loadAndRenderAdminConsole();
    });
  });
}

window.addEventListener('DOMContentLoaded', initApp);
