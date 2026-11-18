'use strict';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, suffix = '') => v == null ? '미확보' : `${Number(v).toLocaleString('ko-KR')}${suffix}`;
const state = { mode: 'LIVE', meta: null, result: null, live: null, selected: null, compared: new Set(), map: null, mapEngine: null, layers: null, daumOverlays: [], daumCircle: null, roadview: null, roadviewClient: null, center: [37.5006, 127.0334], requestId: 0, token: '', view: 'explore', providers: [], liveQuery: null };
const labels = { survival: '생존·폐업 지표', competition: '경쟁 환경', demand: '배후 수요', cost: '비용 부담' };
let toastTimer;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6000); }
async function api(route, data, admin = false) {
  if (window.APP_STATIC) {
    if (route === '/api/meta') return window.APP_DEMO.meta;
    if (route === '/api/external/catalog') return { providers: window.APP_DEMO.providers.map(p => ({ ...p, status: 'SERVER_REQUIRED', configured: false })) };

    throw new Error('서버에 연결해야 실제 API를 호출할 수 있습니다. Node.js 서버에서 실행해 주세요.');
  }
  let response;
  try {
    response = await fetch(route, { method: data ? 'POST' : 'GET', headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(admin ? { Authorization: `Bearer ${state.token || $('adminToken').value}` } : {}) }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(20000) });
  } catch (err) {
    throw new Error(['TimeoutError', 'AbortError'].includes(err.name) ? '응답 시간이 초과되었습니다. 잠시 후 다시 조회해 주세요.' : '서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.');
  }
  let json;
  try { json = await response.json(); } catch { throw new Error('서버 응답을 읽을 수 없습니다. Node.js 서버 실행 상태를 확인하세요.'); }
  if (!response.ok) { const err = new Error(json.error || '요청 처리에 실패했습니다.'); err.status = response.status; err.code = json.code; throw err; }
  return json;
}
const busyButtons = new WeakSet();
async function perform(button, fn, output) {
  if (button && busyButtons.has(button)) return;
  const old = button?.textContent;
  if (button) { busyButtons.add(button); button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = '처리 중…'; }
  try { return await fn(); } catch (err) { if (output) output.textContent = err.message; toast(err.message); }
  finally { if (button) { busyButtons.delete(button); button.disabled = button.id === 'analyze' && !$('industry').value; button.removeAttribute('aria-busy'); button.textContent = old; } }
}
function switchView(view) {
  if (!['explore', 'compare', 'sales', 'report', 'sources', 'account', 'auth', 'admin', 'guide'].includes(view)) return;
  state.view = view;
  document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== `view-${view}`);
  document.querySelectorAll('.nav').forEach(el => { el.classList.toggle('active', el.dataset.view === view); el.setAttribute('aria-current', el.dataset.view === view ? 'page' : 'false'); });
  $('pageTitle').textContent = { explore: '상권 탐색', compare: '후보 비교', sales: '카드매출 분석', report: '분석 리포트', sources: '데이터 연결', account: '내 워크스페이스', auth: '로그인 / 회원가입', admin: '관리자', guide: '시작 가이드' }[view];
  if (view === 'explore') setTimeout(resizeMap, 50);
  if (view === 'compare') renderComparison();
  if (view === 'sales' && typeof openSalesView === 'function') openSalesView();
  if (view === 'report') renderReport();
  if (view === 'sources') refreshProviders();
  if (view === 'account') renderAccount();
  history.replaceState(null, '', `#${view}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
const loadedScripts = new Map();
function loadScriptOnce(src) {
  if (loadedScripts.has(src)) return loadedScripts.get(src);
  const p = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    let timer;
    const finish = ok => { clearTimeout(timer); if (!ok) { loadedScripts.delete(src); s.remove(); } resolve(ok); };
    s.onload = () => finish(true);
    s.onerror = () => finish(false);
    timer = setTimeout(() => finish(false), 8000);
    document.head.append(s);
  });
  loadedScripts.set(src, p);
  return p;
}
function resizeMap() {
  if (!state.map) return;
  if (state.mapEngine === 'DAUM') {
    state.map.relayout();
    state.map.setCenter(new window.daum.maps.LatLng(state.center[0], state.center[1]));
  } else state.map.invalidateSize();
}
function moveMap(lat, lng, leafletZoom = 14) {
  state.center = [lat, lng];
  if (!state.map) return;
  if (state.mapEngine === 'DAUM') {
    const levelMap = { 13: 5, 14: 4, 15: 3, 16: 2 };
    state.map.setLevel(levelMap[leafletZoom] || 4);
    state.map.panTo(new window.daum.maps.LatLng(lat, lng));
  } else {
    state.map.setView([lat, lng], leafletZoom);
  }
  if (!$('roadviewWrap').hidden && state.mapEngine === 'DAUM') refreshRoadview();
}
async function initMap() {
  const jsKey = state.meta?.kakao_js_key;
  if (jsKey) {
    const loaded = await loadScriptOnce(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(jsKey)}&libraries=services&autoload=false`);
    if (loaded && window.kakao?.maps?.load) {
      const ready = await new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), 8000);
        try { window.kakao.maps.load(() => { clearTimeout(timer); resolve(Boolean(window.daum?.maps?.Map)); }); }
        catch { clearTimeout(timer); resolve(false); }
      });
      if (ready) {
        state.mapEngine = 'DAUM';
        $('map').innerHTML = '';
        state.map = new window.daum.maps.Map($('map'), { center: new window.daum.maps.LatLng(state.center[0], state.center[1]), level: 4 });
        state.map.addControl(new window.daum.maps.ZoomControl(), window.daum.maps.ControlPosition.RIGHT);
        $('mapEngineBadge').textContent = '다음지도 LIVE';
        $('mapEngineBadge').className = 'tag live';
        $('mapDomainHint').hidden = true;
        window.daum.maps.event.addListener(state.map, 'click', mouseEvent => {
          const latlng = mouseEvent.latLng;
          state.center = [latlng.getLat(), latlng.getLng()];
          updateCoordinates();
          if (!$('roadviewWrap').hidden) refreshRoadview();
          if (state.mode === 'LIVE') invalidateExploreResults();
          else drawMap();
        });
        updateCoordinates();
        drawMap();
        return;
      }
    }
    $('mapDomainHint').hidden = false;
    $('mapDomainHint').textContent = '다음지도를 연결하지 못해 기본지도를 표시합니다. 잠시 후 새로고침하거나 다음지도 크게보기를 이용해 주세요. 운영자는 지도 API 사용 설정과 허용 도메인을 확인해 주세요.';
  }
  if (!window.L) await loadScriptOnce('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
  if (!window.L) { $('mapEngineBadge').textContent = '지도 연결 확인 필요'; $('map').innerHTML = '<div class="map-fallback">지도 라이브러리를 불러오지 못했습니다.<br>네트워크 연결을 확인하세요. 검색 목록은 계속 이용할 수 있습니다.</div>'; return; }
  state.mapEngine = 'LEAFLET';
  $('mapEngineBadge').textContent = '기본지도 · 다음 주소연동';
  $('mapEngineBadge').className = 'tag ready';
  state.map = L.map('map', { zoomControl: false }).setView(state.center, 14);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(state.map);
  state.layers = L.layerGroup().addTo(state.map);
  state.map.on('click', e => { state.center = [e.latlng.lat, e.latlng.lng]; updateCoordinates(); if (state.mode === 'LIVE') invalidateExploreResults(); });
  updateCoordinates();
}
function setDaumMapType(skyview) {
  $('btnMapNormal').classList.toggle('selected', !skyview);
  $('btnMapSkyview').classList.toggle('selected', skyview);
  if (state.mapEngine === 'DAUM' && state.map) {
    state.map.setMapTypeId(skyview ? window.daum.maps.MapTypeId.HYBRID : window.daum.maps.MapTypeId.ROADMAP);
  } else if (skyview) {
    toast('스카이뷰 위성지도는 내장 다음지도 활성화 도메인 또는 [다음지도 크게보기]에서 확인할 수 있습니다.');
    $('btnMapNormal').classList.add('selected');
    $('btnMapSkyview').classList.remove('selected');
  }
}
function refreshRoadview() {
  if (state.mapEngine !== 'DAUM' || !window.daum?.maps?.Roadview) return;
  if (!state.roadview) {
    state.roadview = new window.daum.maps.Roadview($('roadview'));
    state.roadviewClient = new window.daum.maps.RoadviewClient();
  }
  const pos = new window.daum.maps.LatLng(state.center[0], state.center[1]);
  state.roadviewClient.getNearestPanoId(pos, 100, panoId => {
    if (!panoId) { $('roadviewStatus').textContent = '반경 100m 내 도로 파노라마가 없는 위치입니다.'; return; }
    $('roadviewStatus').textContent = `${state.center[0].toFixed(5)}, ${state.center[1].toFixed(5)} 현장 거리뷰`;
    state.roadview.setPanoId(panoId, pos);
  });
}
function toggleRoadview() {
  if (state.mapEngine === 'DAUM') {
    const nextHidden = !$('roadviewWrap').hidden;
    $('roadviewWrap').hidden = nextHidden;
    if (!nextHidden) refreshRoadview();
  } else {
    window.open(`https://map.kakao.com/link/roadview/${state.center[0]},${state.center[1]}`, '_blank', 'noopener');
  }
}
async function openDaumPostcode() {
  if (!$('postcodeDialog').open) $('postcodeDialog').showModal();
  $('postcodeEmbed').textContent = '주소 검색을 불러오는 중…';
  const ok = await loadScriptOnce('https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js');
  if (!$('postcodeDialog').open) return;
  if (!ok || !window.daum?.Postcode) { $('postcodeEmbed').textContent = '주소 검색 서비스를 불러오지 못했습니다. 창을 닫고 다시 시도하거나 주소·장소 검색을 이용해 주세요.'; return; }
  $('postcodeEmbed').innerHTML = '';
  new window.daum.Postcode({
    width: '100%',
    height: '100%',
    oncomplete: async data => {
      $('postcodeDialog').close();
      const addr = data.roadAddress || data.jibunAddress || data.address;
      if (!addr) return;
      $('placeQuery').value = addr;
      $('placeType').value = 'address';
      try {
        const docs = await searchPlacesClientOrServer(addr, 'address');
        if (docs[0]?.lat != null && docs[0]?.lng != null) {
          moveMap(docs[0].lat, docs[0].lng, 16);
          updateCoordinates(); invalidateExploreResults();
          toast(`다음 주소 선택 완료: ${addr}`);
          return;
        }
      } catch { /* fallback below */ }
      try {
        const nom = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=kr&q=${encodeURIComponent(addr)}`, { signal: AbortSignal.timeout(8000) })).json();
        if (nom[0]) {
          moveMap(Number(nom[0].lat), Number(nom[0].lon), 16);
          updateCoordinates(); invalidateExploreResults();
          toast(`다음 주소 이동 완료: ${addr}`);
          return;
        }
      } catch { /* ignore */ }
      toast(`주소가 입력되었습니다: ${addr}`);
    }
  }).embed($('postcodeEmbed'));
}
async function searchPlacesClientOrServer(q, action) {
  if (window.daum?.maps?.services) {
    try { return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('지도 검색 응답 시간이 초과되었습니다.')), 6000);
      const done = (err, records) => { clearTimeout(timer); if (err) reject(err); else resolve(records); };
      if (action === 'address') {
        new window.daum.maps.services.Geocoder().addressSearch(q, (res, status) => {
          if (status === window.daum.maps.services.Status.ZERO_RESULT) return done(null, []);
          if (status !== window.daum.maps.services.Status.OK) return done(new Error('다음 주소 좌표 변환에 실패했습니다.'));
          done(null, res.map(r => ({ name: r.address_name, address: r.road_address?.address_name || r.address_name, lat: Number(r.y), lng: Number(r.x) })));
        });
      } else {
        new window.daum.maps.services.Places().keywordSearch(q, (res, status) => {
          if (status === window.daum.maps.services.Status.ZERO_RESULT) return done(null, []);
          if (status !== window.daum.maps.services.Status.OK) return done(new Error('다음 장소 검색에 실패했습니다.'));
          done(null, res.map(r => ({ name: r.place_name, address: r.road_address_name || r.address_name, lat: Number(r.y), lng: Number(r.x) })));
        });
      }
    }); } catch (err) { if (window.APP_STATIC) throw err; }
  }
  const data = await api('/api/external/kakao', { query: q, action });
  refreshProviders();
  return data.documents || [];
}
function updateCoordinates() {
  $('coordinates').textContent = `${state.center[0].toFixed(5)}, ${state.center[1].toFixed(5)} · ${$('radius').value}m`;
  if ($('linkDaumMap')) {
    const label = encodeURIComponent($('mapTitle').textContent || '탐색 위치');
    $('linkDaumMap').href = `https://map.kakao.com/link/map/${label},${state.center[0]},${state.center[1]}`;
  }
}
function drawMap() {
  if (!state.map) return;
  const list = state.mode === 'DEMO' ? state.result?.candidates || [] : state.live?.items || [];
  if (state.mapEngine === 'DAUM') {
    if (state.daumCircle) { state.daumCircle.setMap(null); state.daumCircle = null; }
    state.daumOverlays.forEach(o => o.setMap(null));
    state.daumOverlays = [];
    const centerLatLng = new window.daum.maps.LatLng(state.center[0], state.center[1]);
    state.daumCircle = new window.daum.maps.Circle({
      center: centerLatLng, radius: Number($('radius').value),
      strokeWeight: 2, strokeColor: '#197266', strokeOpacity: 0.85,
      fillColor: '#197266', fillOpacity: 0.1
    });
    state.daumCircle.setMap(state.map);
    list.forEach(c => {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return;
      const wrap = document.createElement('div');
      wrap.innerHTML = `<div class="pin ${state.selected === c.id ? 'chosen' : ''}" title="${escapeHtml(c.name || c.store_name || '')}"><span>${state.mode === 'DEMO' ? c.rank : '•'}</span></div>`;
      const el = wrap.firstElementChild;
      el.style.cursor = 'pointer';
      el.onclick = ev => {
        ev.stopPropagation();
        if (state.mode === 'DEMO') showDetail(c.id);
        else toast(`${c.store_name || ''} · ${c.address || '주소 미제공'}`);
      };
      const overlay = new window.daum.maps.CustomOverlay({
        position: new window.daum.maps.LatLng(c.lat, c.lng),
        content: el,
        yAnchor: 1
      });
      overlay.setMap(state.map);
      state.daumOverlays.push(overlay);
    });
    return;
  }
  if (!state.layers) return;
  state.layers.clearLayers();
  L.circle(state.center, { radius: Number($('radius').value), color: '#438568', fillOpacity: .07, weight: 1.5 }).addTo(state.layers);
  list.forEach(c => {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return;
    const icon = L.divIcon({ className: '', html: `<div class="pin ${state.selected === c.id ? 'chosen' : ''}"><span>${state.mode === 'DEMO' ? c.rank : '•'}</span></div>`, iconSize: [34, 34], iconAnchor: [17, 34] });
    const marker = L.marker([c.lat, c.lng], { icon }).addTo(state.layers);
    marker.bindPopup(`<strong>${escapeHtml(c.name || c.store_name)}</strong><br>${escapeHtml(state.mode === 'DEMO' ? '가상 후보 위치 · 데모 전용' : c.address)}`);
    if (state.mode === 'DEMO') marker.on('click', () => showDetail(c.id));
  });
}
function syncOfficialIndustry() {
  const selected = state.meta?.industries.find(i => i.industry_code === $('industry').value);
  const code = selected?.semas_code;
  $('officialIndustry').value = /^[A-Z]\d{5}$/.test(code || '') ? code : '';
  updateOfficialIndustryHelp();
}
function updateOfficialIndustryHelp() {
  const code = $('officialIndustry').value.trim();
  const selected = state.meta?.industries.find(i => i.industry_code === $('industry').value);
  const classification = state.meta?.industries.find(i => i.semas_code === code);
  $('officialIndustryHelp').textContent = !code
    ? '코드를 비워 두면 선택한 업종과 관계없이 전체 업종을 조회합니다.'
    : code === selected?.semas_code && selected.semas_name
      ? `대표 소분류: ${selected.semas_name} (${code}). 이 분류의 점포만 조회하며, 선택한 업종의 다른 세부 업종은 포함하지 않습니다. 코드를 직접 수정할 수 있습니다.`
      : `직접 지정한 소분류: ${classification?.semas_name ? `${classification.semas_name} (${code})` : code}. 이 코드에 해당하는 점포만 조회합니다.`;
}
function populateIndustries(query = '') {
  const previous = $('industry').value;
  const q = query.replace(/\s/g, '').toLowerCase();
  const filtered = state.meta.industries.filter(i => !q || [i.industry_name, i.category_large, ...i.keywords].some(s => s.replace(/\s/g, '').toLowerCase().includes(q)));
  const groups = new Map();
  filtered.forEach(i => { if (!groups.has(i.category_large)) groups.set(i.category_large, []); groups.get(i.category_large).push(i); });
  $('industry').innerHTML = [...groups].map(([group, items]) => `<optgroup label="${escapeHtml(group)}">${items.map(i => `<option value="${i.industry_code}">${escapeHtml(i.industry_name)}</option>`).join('')}</optgroup>`).join('');
  if (filtered.some(i => i.industry_code === previous)) $('industry').value = previous;
  $('analyze').disabled = !filtered.length || busyButtons.has($('analyze'));
  syncOfficialIndustry();
  $('industryHint').textContent = filtered.length ? `${filtered.length}개 업종 · 선택하면 대표 소분류 코드가 입력됩니다.` : '일치하는 업종이 없습니다. 검색어를 바꿔 주세요.';
}
function invalidateExploreResults() {
  state.requestId++; state.result = null; state.live = null; state.liveQuery = null; state.compared.clear();
  $('compareCount').textContent = '0'; $('filterFeedback').textContent = '';
  $('kakaoFallback').hidden = true;
  renderLiveEmpty(); drawMap();
}
function populateDistricts() {
  const r = state.meta.regions.find(r => r.sido_name === $('sido').value);
  $('sigungu').innerHTML = r.sigungu_list.map(d => `<option>${escapeHtml(d.sigungu_name)}</option>`).join('');
  populateEmd();
}
function populateEmd() {
  state.requestId++;
  const r = state.meta.regions.find(r => r.sido_name === $('sido').value);
  const d = r.sigungu_list.find(d => d.sigungu_name === $('sigungu').value);
  $('emd').innerHTML = '<option value="">전체 읍·면·동</option>' + d.emd_list.map(e => `<option>${escapeHtml(e)}</option>`).join('');
  state.center = [...d.center]; state.live = null; state.result = null; state.compared.clear(); state.liveQuery = null;
  $('compareCount').textContent = '0'; moveMap(state.center[0], state.center[1], 13); updateCoordinates(); drawMap(); renderLiveEmpty();
}
function setMode(mode) {
  mode = 'LIVE';
  state.requestId++;
  state.mode = mode; state.result = null; state.live = null; state.liveQuery = null; state.compared.clear(); state.selected = null;
  $('compareCount').textContent = '0';
  $('kakaoFallback').hidden = true;
  $('modeLive').classList.toggle('selected', mode === 'LIVE'); $('modeDemo').classList.toggle('selected', mode === 'DEMO');
  $('demoFilters').hidden = mode !== 'DEMO'; $('moreStores').hidden = true;
  $('modeNotice').textContent = mode === 'DEMO' ? '체험용 가상 데이터입니다. 통계·점포·좌표·점수는 실제 입지 판단에 사용할 수 없습니다.' : '공식 API의 실제 응답만 표시합니다. 데이터 연결 상태를 먼저 확인하세요.';
  $('mapMode').textContent = mode === 'DEMO' ? 'DEMO · 가상 위치' : '실데이터'; $('mapMode').className = `tag ${mode === 'DEMO' ? 'demo' : 'live'}`;
  $('mapLegend').textContent = mode === 'DEMO' ? '가상 후보 위치 · 순위 예시' : '조회된 실제 점포';
  $('analyze').textContent = mode === 'DEMO' ? '데모 상권 분석하기 →' : '이 위치의 점포 조회 →';
  renderLiveEmpty(); drawMap(); renderMetrics();
  if (mode === 'DEMO') analyze();
}
function renderLiveEmpty() {
  $('kakaoFallback').hidden = true;
  $('mapLegend').textContent = '조회된 실제 점포';
  $('cards').innerHTML = `<div class="empty panel"><span>⌖</span><h3>${state.mode === 'DEMO' ? '선택한 조건으로 데모를 실행하세요' : '위치를 정하고 실제 점포를 조회하세요'}</h3><p>${state.mode === 'DEMO' ? '가상 데이터로 분석·비교·보고서 기능을 체험합니다.' : '지도에서 클릭하거나 주소 검색으로 위치를 지정해 주세요.<br>인증키 설정은 데이터 연결 화면에서 확인할 수 있습니다.'}</p></div>`;
  $('resultsTitle').textContent = state.mode === 'DEMO' ? '데모 추천 후보' : '조회 결과';
  $('resultNotice').hidden = true; $('moreStores').hidden = true; renderMetrics();
}
function query() {
  const weights = [...document.querySelectorAll('[data-weight]')].map(el => Number(el.value));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return { mode: 'DEMO', industry: $('industry').value, sido: $('sido').value, sigungu: $('sigungu').value, emd: $('emd').value,
    radius: Number($('radius').value), budget: Number($('budget').value), rent: Number($('rent').value), storeType: $('storeType').value,
    wSurvival: weights[0] / sum, wCompetition: weights[1] / sum, wDemand: weights[2] / sum, wCost: weights[3] / sum };
}
async function analyze(page = 1) {
  const id = ++state.requestId;
  const button = page === 1 ? $('analyze') : $('moreStores');
  await perform(button, async () => {
    $('kakaoFallback').hidden = true;
    $('filterFeedback').textContent = '데이터를 확인하고 있습니다…';
    if (state.mode === 'DEMO') {
      const data = await api('/api/recommend', query());
      if (id !== state.requestId) return;
      state.result = data; state.compared = new Set([...state.compared].filter(id => data.candidates.some(c => c.id === id)));
      renderCandidates();
      const first = data.candidates[0]; if (first) moveMap(first.lat, first.lng, 13);
    } else {
      // Broad UI categories are not asserted to be verified official small-industry codes.
      const p = page === 1 ? { cx: state.center[1], cy: state.center[0], radius: Number($('radius').value), numOfRows: 100, pageNo: 1, ...($('officialIndustry').value.trim() ? { indsSclsCd: $('officialIndustry').value.trim() } : {}) } : { ...state.liveQuery, pageNo: page };
      let data;
      try { data = await api('/api/external/semas', p); }
      catch (err) {
        if (id !== state.requestId) return;
        $('kakaoFallback').hidden = false;
        const industry = state.meta.industries.find(item => item.industry_code === $('industry').value);
        $('kakaoStoreQuery').value = industry?.keywords?.[0] || industry?.industry_name || '';
        refreshProviders();
        throw err;
      }
      if (id !== state.requestId) return;
      state.live = data; state.liveQuery = p; renderStores();
    }
    renderMetrics(); drawMap(); updateCoordinates();
    $('filterFeedback').textContent = state.mode === 'DEMO' ? '가상 데이터 분석 완료 · 실제 추천이 아닙니다.' : '공식 API 응답을 조회했습니다. 업종명과 관측 시점을 함께 확인하세요.';
    refreshProviders();
  }, $('filterFeedback'));
}
async function searchKakaoStores(page = 1) {
  const button = page === 1 ? $('searchKakaoStores') : $('moreStores');
  if (busyButtons.has(button)) return;
  const p = page === 1 ? { action: 'keyword', query: $('kakaoStoreQuery').value.trim(), x: state.center[1], y: state.center[0], radius: Number($('radius').value), page: 1 } : { ...state.liveQuery, page };
  if (!p.query) return toast('카카오에서 검색할 업종이나 장소명을 입력해 주세요.');
  const id = ++state.requestId;
  if (page === 1) { state.live = null; state.liveQuery = null; renderLiveEmpty(); drawMap(); $('kakaoFallback').hidden = false; }
  await perform(button, async () => {
    $('filterFeedback').textContent = '카카오 장소검색 응답을 확인하고 있습니다…';
    let data;
    try { data = await api('/api/external/kakao', p); }
    catch (err) { if (id !== state.requestId) return; throw err; }
    if (id !== state.requestId) return;
    state.liveQuery = p;
    state.live = { ...data, provider: 'kakao', page, page_size: 15, total_count: null, has_more: data.meta?.is_end === false && page < 45, observation_period: '카카오 응답 시점',
      items: data.documents.map((place, index) => ({ id: `kakao-${page}-${index}`, store_name: place.name, address: place.address, industry_name: place.category, lat: place.lat, lng: place.lng, observation_period: data.collected_at })) };
    renderStores(); renderMetrics(); drawMap(); updateCoordinates();
    $('filterFeedback').textContent = '카카오 장소검색 결과입니다. 공식 상가 API 승인 상태와는 별개이며 전체 점포 현황이 아닙니다.';
    refreshProviders();
  }, $('filterFeedback'));
}
function renderMetrics() {
  const demo = state.mode === 'DEMO';
  const kakao = state.live?.provider === 'kakao';
  const values = demo ? [['데이터 모드', 'DEMO', '체험용 가상 데이터'], ['비교 가능 후보', `${state.result?.candidates.length || 0}곳`, '선택 조건에 따른 가상 결과'], ['평가 기준', '4개 지표', '초기 제안 가중치'], ['분석 반경', `${$('radius').value}m`, '가상 후보 중심 기준']]
    : [['데이터 모드', '실데이터', kakao ? '카카오 장소검색 응답' : '공식 API 응답'], [kakao ? '검색된 장소' : '조회 점포', state.live ? fmt(state.live.items.length, '곳') : '—', state.live ? kakao ? `일부 검색 결과 · ${state.live.page}페이지` : `전체 ${fmt(state.live.total_count, '곳')} · 페이지 ${state.live.page}` : '조회 후 표시'], ['데이터 기준', state.live?.observation_period || '—', '제공기관 기준시점'], ['분석 반경', `${$('radius').value}m`, '선택 좌표 중심']];
  $('metrics').innerHTML = values.map(v => `<article><span>${v[0]}</span><strong>${escapeHtml(v[1])}</strong><small>${escapeHtml(v[2])}</small></article>`).join('');
}
function renderCandidates() {
  const list = state.result?.candidates || [];
  $('resultsTitle').textContent = `데모 추천 후보 ${list.length}곳`;
  $('mapTitle').textContent = `${$('sido').value} ${$('sigungu').value} · 가상 상권 탐색`;
  $('resultNotice').hidden = false; $('resultNotice').textContent = state.result.notice;
  $('compareCount').textContent = state.compared.size;
  $('cards').innerHTML = list.map(c => `<article class="candidate panel ${state.selected === c.id ? 'selected' : ''}"><div class="card-top"><span class="rank">${String(c.rank).padStart(2, '0')} · CANDIDATE</span><span class="tag demo">가상 데이터</span></div><h3>${escapeHtml(c.name)}</h3><p class="location">${escapeHtml(c.type)}</p><div class="card-metrics"><div><small>데모 평가 점수</small><strong>${fmt(c.score)}</strong></div><div><small>가상 경쟁 점포</small><strong>${fmt(c.stores, '곳')}</strong></div><div><small>가상 월세</small><strong>${fmt(c.rent, '만')}</strong></div></div><div class="card-bottom"><label><input type="checkbox" data-compare="${c.id}" ${state.compared.has(c.id) ? 'checked' : ''}> 비교 담기</label><button class="text-btn" data-detail="${c.id}">분석 살펴보기 ↗</button></div></article>`).join('') || '<div class="empty panel">해당 조건의 데모 후보가 없습니다.</div>';
  $('cards').querySelectorAll('[data-detail]').forEach(b => b.onclick = () => showDetail(b.dataset.detail));
  $('cards').querySelectorAll('[data-compare]').forEach(input => input.onchange = () => {
    if (input.checked && state.compared.size >= 3) { input.checked = false; return toast('후보는 최대 3곳까지 비교할 수 있습니다.'); }
    if (input.checked) state.compared.add(input.dataset.compare); else state.compared.delete(input.dataset.compare);
    $('compareCount').textContent = state.compared.size;
  });
}
function renderStores() {
  const data = state.live;
  const kakao = data.provider === 'kakao';
  $('resultsTitle').textContent = `${kakao ? '카카오 장소' : '실제 점포'} ${data.items.length}곳 · ${data.page}페이지`;
  $('mapTitle').textContent = kakao ? '선택 위치 주변의 카카오 검색 결과' : '선택 위치 주변의 실제 점포';
  $('mapLegend').textContent = kakao ? '카카오 장소검색 결과 · 일부 장소' : '조회된 실제 점포';
  $('resultNotice').hidden = false;
  $('resultNotice').textContent = `${data.mode === 'STALE' ? '갱신 실패 · 마지막 실제 수집 캐시' : data.mode === 'CACHED' ? '최근 실제 수집 캐시' : '공식 API 조회'} · 수집 ${new Date(data.collected_at).toLocaleString('ko-KR')} · ${state.liveQuery?.indsSclsCd ? state.liveQuery.indsSclsCd + ' 업종 조회' : '전체 업종 조회'} · 제공기관 원본 분류 기준`;
  if (kakao) $('resultNotice').textContent = `출처: 카카오 Local 장소검색 · 검색어: ${state.liveQuery.query} · 수집 ${new Date(data.collected_at).toLocaleString('ko-KR')} · 검색 결과 일부이며 공식 전체 점포 수가 아닙니다. 공식 소분류 코드를 사용하지 않습니다.`;
  $('cards').innerHTML = data.items.map(c => `<article class="candidate panel"><div class="card-top"><span class="tag live">실제 API 응답</span><span class="location">${escapeHtml(c.industry_code || '분류 없음')}</span></div><h3>${escapeHtml(c.store_name)} ${escapeHtml(c.branch_name || '')}</h3><p class="location">${escapeHtml(c.address || '주소 미제공')}</p><div class="card-bottom"><span>${escapeHtml(c.industry_name || '업종 미제공')}</span><span class="location">${escapeHtml(c.floor || '층 미제공')}</span></div></article>`).join('') || '<div class="empty panel"><h3>조회된 점포가 없습니다.</h3><p>위치 또는 반경을 바꿔 다시 조회해 보세요.</p></div>';
  if (kakao) {
    $('cards').querySelectorAll('.card-top .tag').forEach(tag => { tag.textContent = '카카오 장소검색'; });
    $('cards').querySelectorAll('.card-top .location').forEach(label => { label.textContent = '키워드 검색'; });
    $('cards').querySelectorAll('.card-bottom .location').forEach(label => { label.textContent = '일부 검색 결과'; });
  }
  $('moreStores').hidden = kakao ? !data.has_more : data.total_count == null || data.page * data.page_size >= data.total_count;
}
function showDetail(id) {
  const c = state.result?.candidates.find(c => c.id === id); if (!c) return;
  state.selected = id;
  $('detailBody').innerHTML = `<p class="eyebrow">CANDIDATE ${String(c.rank).padStart(2, '0')} · DEMO ONLY</p><h2>${escapeHtml(c.name)}</h2><p>${escapeHtml(c.region)} · ${escapeHtml(c.type)}</p><div class="inline-notice">아래 수치와 위치는 모두 가상 데이터입니다. 생존·폐업 통계의 실제 출처가 아닙니다.</div><div class="card-metrics"><div><small>데모 점수</small><strong>${fmt(c.score)}</strong></div><div><small>가상 초기 비용</small><strong>${fmt(c.startup, '만원')}</strong></div><div><small>가상 월세</small><strong>${fmt(c.rent, '만원')}</strong></div></div><div class="score-bars">${Object.entries(labels).map(([k, label]) => `<div class="bar-row"><div><span>${label} <small>가중치 ${Math.round((c.weights[k] || 0) * 100)}%</small></span><b>${fmt(c.scores[k])}</b></div><section class="track"><i style="width:${Math.max(0, Math.min(100, c.scores[k] || 0))}%"></i></section></div>`).join('')}</div><p>1·3·5년 가상 생존율: ${c.survival.map(n => fmt(n, '%')).join(' / ')}<br>가상 연간 소멸률: ${fmt(c.closure, '%')}<br>생존율과 소멸률은 분모와 관측기간이 다릅니다.</p>${c.missing.length ? `<div class="inline-notice">결측 처리 예시: ${escapeHtml(c.missing.join(', '))}</div>` : ''}<p class="hint">종합 점수에는 데모 엔진의 결측 패널티가 적용될 수 있습니다. 예측 성능은 검증되지 않았습니다.</p>`;
  $('detail').showModal(); renderCandidates(); drawMap();
}
function renderComparison() {
  const list = state.result?.candidates.filter(c => state.compared.has(c.id)) || [];
  const host = $('comparison');
  if (list.length < 2) { host.className = 'panel empty'; host.innerHTML = '<span>▥</span><h3>비교할 후보를 2~3곳 선택해 주세요</h3><p>비교 가능한 공식 데이터가 확보되면 이용할 수 있습니다.</p>'; return; }
  host.className = 'panel padded';
  const rows = [['데모 점수', c => fmt(c.score)], ['가상 경쟁 점포', c => fmt(c.stores, '곳')], ['가상 상주 인구', c => fmt(c.population, '명')], ['가상 직장 인구', c => fmt(c.workers, '명')], ['가상 월세', c => fmt(c.rent, '만원')], ['가상 초기 비용', c => fmt(c.startup, '만원')], ['3년 가상 생존율', c => fmt(c.survival[1], '%')], ['결측 항목', c => c.missing.join(', ') || '없음']];
  host.innerHTML = `<div class="inline-notice">모든 비교 수치는 데모입니다. 현재 분석에서 산출한 동일한 가중치의 결과를 사용합니다.</div><div class="table-wrap"><table><thead><tr><th>비교 항목</th>${list.map(c => `<th>${escapeHtml(c.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, fn]) => `<tr><th>${label}</th>${list.map(c => `<td>${escapeHtml(fn(c))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function exportRows() {
  if (state.mode === 'DEMO') return (state.result?.candidates || []).map(c => ({ 데이터구분: 'DEMO 가상 데이터', 후보명: c.name, 지역: c.region, 가상점수: c.score, 가상점포수: c.stores, 가상월세만원: c.rent, 출처: '가상 시뮬레이션' }));
  return (state.live?.items || []).map(c => ({ 데이터구분: state.live.provider === 'kakao' ? '카카오 장소검색 · 일부 검색 결과' : state.live.mode, 상호: c.store_name, 주소: c.address, 업종: c.industry_name, 기준시점: c.observation_period, 수집시각: state.live.collected_at, 출처: state.live.source_url }));
}
function renderReport() {
  const rows = exportRows();
  $('report').innerHTML = `<p class="eyebrow">STARTUP LOCATION REPORT</p><h2>${state.mode === 'DEMO' ? '데모 상권 분석 리포트' : '실데이터 점포 조회 리포트'}</h2><p>생성 ${new Date().toLocaleString('ko-KR')} · 반경 ${$('radius').value}m</p><div class="inline-notice">${state.mode === 'DEMO' ? '모든 수치는 가상 데이터입니다. 실제 입지 분석 보고서로 사용할 수 없습니다.' : '제공기관의 응답을 그대로 정리합니다. 점포 목록은 사업 성공률이나 폐업 위험 예측이 아닙니다.'}</div>${rows.length ? dataTable(rows) : '<div class="empty"><h3>아직 조회 결과가 없습니다.</h3><p>상권 탐색에서 먼저 조회를 실행해 주세요.</p></div>'}`;
}
function dataTable(rows) {
  if (!rows.length) return '<p class="hint">조회 결과가 없습니다.</p>';
  const keys = Object.keys(rows[0]);
  return `<div class="table-wrap"><table><thead><tr>${keys.map(k => `<th>${escapeHtml(k)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${keys.map(k => `<td>${escapeHtml(r[k] ?? '미확보')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function download(content, extension, mime) {
  const blob = new Blob([content], { type: mime }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `창업입지AI_${state.mode}_${new Date().toISOString().slice(0, 10)}.${extension}`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function refreshProviders() {
  try {
    state.providers = (await api('/api/external/catalog')).providers;
    const names = { NOT_CONFIGURED: '인증키 필요', READY: '설정됨 · 조회 대기', NEEDS_TABLE: '통계표 지정 필요', CONNECTED: '실시간 응답 확인', ERROR: '기관 확인 필요', SERVER_REQUIRED: '서버 필요' };
    $('providerCards').innerHTML = state.providers.map(p => `<article class="panel provider-card"><div class="provider-state"><span class="provider-icon">${{ semas: '⌂', nts: '✓', kosis: '▥', region: '◎', kakao: '⌖' }[p.id]}</span><span class="tag ${p.status === 'CONNECTED' ? 'live' : p.status === 'READY' ? 'ready' : p.status === 'ERROR' ? 'demo' : ''}">${names[p.status] || p.status}</span></div><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description)}</p>${p.last_message ? `<div class="inline-notice" style="margin:0 0 12px;padding:8px 11px;font-size:10.5px">${escapeHtml(p.last_message)}</div>` : ''}<small>${escapeHtml(p.provider)} · ${p.last_success_at ? '최근 응답 ' + new Date(p.last_success_at).toLocaleString('ko-KR') : p.configured ? '인증키 적용됨 · 호출 시 실서버 검증' : '실제 수집 성공 이력 없음'}</small><a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">공식 안내 및 활용 신청 ↗</a></article>`).join('');
    const count = state.providers.filter(p => p.status === 'CONNECTED').length;
    const configuredCount = state.providers.filter(p => p.configured).length;
    $('serverStatus').textContent = window.APP_STATIC ? '정적 데모 · 서버 미연결' : `서버 연결 · 키 설정 ${configuredCount}/5 · 응답 확인 ${count}/5`;
  } catch (err) { $('serverStatus').textContent = '서버 연결 확인 필요'; toast(err.message); }
}
async function init() {
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => switchView(b.dataset.view));
  $('closeDetail').onclick = () => $('detail').close();
  $('closePostcode').onclick = () => $('postcodeDialog').close();
  $('detail').addEventListener('click', e => { if (e.target === $('detail')) { const r = $('detail').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('detail').close(); } });
  $('postcodeDialog').addEventListener('click', e => { if (e.target === $('postcodeDialog')) { const r = $('postcodeDialog').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('postcodeDialog').close(); } });
  state.meta = await api('/api/meta');
  populateIndustries();
  $('sido').innerHTML = state.meta.regions.map(r => `<option>${escapeHtml(r.sido_name)}</option>`).join('');
  populateDistricts();
  // A slow third-party map must not block account, navigation or data controls.
  initMap().then(drawMap).catch(() => { $('mapEngineBadge').textContent = '지도 연결 확인 필요'; $('map').innerHTML = '<div class="map-fallback">지도를 불러오지 못했습니다. 주소 검색과 점포 목록은 계속 이용할 수 있습니다.</div>'; });
  $('btnMapNormal').onclick = () => setDaumMapType(false);
  $('btnMapSkyview').onclick = () => setDaumMapType(true);
  $('btnRoadview').onclick = toggleRoadview;
  $('closeRoadview').onclick = () => { $('roadviewWrap').hidden = true; };
  $('btnDaumPostcode').onclick = openDaumPostcode;
  $('industrySearch').oninput = e => { populateIndustries(e.target.value); invalidateExploreResults(); };
  $('sido').onchange = populateDistricts; $('sigungu').onchange = populateEmd;
  const clearResults = invalidateExploreResults;
  $('emd').onchange = () => { clearResults(); toast('읍·면·동 중심 좌표는 주소 검색으로 확인해 주세요.'); };
  $('radius').onchange = () => { clearResults(); updateCoordinates(); };
  $('industry').onchange = () => { syncOfficialIndustry(); clearResults(); };
  $('officialIndustry').onchange = () => { updateOfficialIndustryHelp(); clearResults(); };
  $('modeLive').onclick = () => setMode('LIVE'); $('modeDemo').onclick = () => setMode('DEMO');
  if ($('tryDemo')) $('tryDemo').onclick = () => setMode('DEMO');
  const defaults = [40, 25, 20, 15];
  $('weightControls').innerHTML = Object.entries(labels).map(([key, label], i) => `<label for="weight-${key}" class="weight-row"><span>${label}</span><output id="out-${key}">${defaults[i]}%</output></label><input id="weight-${key}" data-weight="${key}" type="range" min="5" max="70" step="5" value="${defaults[i]}">`).join('');
  const updateWeights = () => { const els = [...document.querySelectorAll('[data-weight]')]; const sum = els.reduce((a, b) => a + Number(b.value), 0); els.forEach(el => $(`out-${el.dataset.weight}`).textContent = `${Math.round(Number(el.value) / sum * 100)}%`); };
  document.querySelectorAll('[data-weight]').forEach(el => el.oninput = updateWeights);
  $('resetWeights').onclick = () => { document.querySelectorAll('[data-weight]').forEach((el, i) => el.value = defaults[i]); updateWeights(); };
  $('searchForm').onsubmit = e => { e.preventDefault(); analyze(); };
  $('moreStores').onclick = () => state.live?.provider === 'kakao' ? searchKakaoStores(state.live.page + 1) : analyze(state.live.page + 1);
  $('searchKakaoStores').onclick = () => searchKakaoStores();
  $('placeForm').onsubmit = e => { e.preventDefault(); perform(e.submitter, async () => {
    const docs = await searchPlacesClientOrServer($('placeQuery').value, $('placeType').value);
    $('placeResults').hidden = false;
    $('placeResults').innerHTML = docs.map((d, i) => `<button type="button" data-place="${i}">${escapeHtml(d.name)}<small>${escapeHtml(d.address)}</small></button>`).join('') || '<p class="hint">검색 결과가 없습니다.</p>';
    $('placeResults').querySelectorAll('[data-place]').forEach(b => b.onclick = () => { const d = docs[Number(b.dataset.place)]; if (d.lat == null || d.lng == null) return toast('좌표가 제공되지 않은 장소입니다.'); moveMap(d.lat, d.lng, 16); $('placeResults').hidden = true; setMode('LIVE'); updateCoordinates(); drawMap(); });
  }); };
  $('print').onclick = () => { renderReport(); window.print(); };
  $('csv').onclick = () => { const rows = exportRows(); if (!rows.length) return toast('먼저 분석 또는 조회를 실행하세요.');
    const cell = v => { let s = String(v ?? ''); if (/^[=+@\-\t\r]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"`; };
    download('\uFEFF' + [Object.keys(rows[0]), ...rows.map(Object.values)].map(row => row.map(cell).join(',')).join('\r\n'), 'csv', 'text/csv;charset=utf-8'); };
  $('exportJson').onclick = () => { const data = state.mode === 'DEMO' ? state.result : state.live; if (!data) return toast('먼저 분석 또는 조회를 실행하세요.'); download(JSON.stringify(data, null, 2), 'json', 'application/json'); };
  const keyNames = ['DATA_GO_KR_SERVICE_KEY', 'NTS_SERVICE_KEY', 'KOSIS_API_KEY', 'KAKAO_REST_API_KEY', 'SEOUL_DATA_API_KEY', 'KAKAO_CLIENT_SECRET', 'KAKAO_JAVASCRIPT_KEY', 'KAKAO_NATIVE_APP_KEY', 'KAKAO_BIZ_SECRET'];
  $('keyFields').innerHTML = keyNames.map(k => `<label>${k}<input type="password" data-key="${k}" autocomplete="off" placeholder="변경할 키만 입력"></label>`).join('');
  if (window.APP_STATIC) { $('keysForm').querySelectorAll('input,button').forEach(el => el.disabled = true); $('keyMessage').textContent = '정적 데모에서는 인증키를 입력·보관하지 않습니다. 서버 환경변수를 설정하세요.'; }
  $('keysForm').onsubmit = e => { e.preventDefault(); perform(e.submitter, async () => {
    state.token = $('adminToken').value || state.token;
    const keys = Object.fromEntries([...document.querySelectorAll('[data-key]')].filter(el => el.value.trim()).map(el => [el.dataset.key, el.value.trim()]));
    if (!Object.keys(keys).length) throw new Error('변경할 인증키를 입력하세요.');
    const r = await api('/api/external/keys', keys, true); document.querySelectorAll('[data-key]').forEach(el => el.value = ''); $('keyMessage').textContent = r.message; await refreshProviders();
  }, $('keyMessage')); };
  $('statsForm').onsubmit = e => { e.preventDefault(); perform(e.submitter, async () => {
    let p; try { p = JSON.parse($('statsQuery').value || '{}'); } catch { throw new Error('조회 조건 JSON 형식을 확인하세요.'); }
    const r = await api(`/api/external/${$('statsProvider').value}`, p);
    const allRows = r.records.map(v => ({ 통계표: v.table_name, 분류: v.classifications.map(c => c.name).join(' / '), 항목: v.item_name, 시점: v.period, 값: v.value, 단위: v.unit }));
    const renderFiltered = (kw = '') => {
      const term = kw.trim().toLowerCase();
      const matched = term ? allRows.filter(row => Object.values(row).some(val => String(val ?? '').toLowerCase().includes(term))) : allRows;
      $('statsTableWrap').innerHTML = dataTable(matched.slice(0, 150)) + (matched.length > 150 ? `<p class="hint">검색 결과 ${matched.length}건 중 상위 150건을 표시합니다. 검색어로 좁혀 보세요.</p>` : '');
    };
    $('statsOutput').innerHTML = `<p class="hint">${escapeHtml(r.mode)} · 수집 ${new Date(r.collected_at).toLocaleString('ko-KR')} · 총 ${r.records.length}개 항목</p><label>결과 내 빠른 필터<input id="statsFilter" type="search" placeholder="예: 숙박, 음식점, 서울, 강남구, 3년 생존율"></label><div id="statsTableWrap"></div><p class="hint">${escapeHtml(r.notice)}</p>`;
    renderFiltered();
    $('statsFilter').oninput = ev => renderFiltered(ev.target.value);
    await refreshProviders();
  }, $('statsOutput')); };
  $('ntsAction').onchange = () => {
    const isValidate = $('ntsAction').value === 'validate';
    $('ntsValidateFields').hidden = !isValidate;
    $('ntsOwner').required = isValidate;
    $('ntsStartDt').required = isValidate;
  };
  $('ntsForm').onsubmit = e => { e.preventDefault(); perform(e.submitter, async () => {
    state.token = $('adminToken').value || state.token;
    const action = $('ntsAction').value;
    const payload = action === 'validate'
      ? { action: 'validate', bizNo: $('bizNo').value, p_nm: $('ntsOwner').value, start_dt: $('ntsStartDt').value, b_nm: $('ntsBizName').value, corp_no: $('ntsCorpNo').value, b_sector: $('ntsSector').value, b_type: $('ntsType').value, b_adr: $('ntsAddress').value, p_nm2: $('ntsOwner2').value }
      : { action: 'status', bizNo: $('bizNo').value };
    const r = await api('/api/nts/verify', payload, true);
    $('ntsOutput').innerHTML = dataTable(r.items.map(v => ({
      사업자번호: v.number_masked,
      ...(action === 'validate' ? { 진위확인: v.validity === '01' ? '일치 (01)' : `${v.valid_msg || '불일치'} (${v.validity || '—'})` } : {}),
      현재상태: v.status,
      과세유형: v.tax_type,
      직전과세유형: v.prev_tax_type,
      폐업일: v.closed_on
    }))) + `<p class="hint">${escapeHtml(r.notice)}</p>`;
    await refreshProviders();
  }, $('ntsOutput')); };
  $('viewLogs').onclick = e => perform(e.currentTarget, async () => { state.token = $('adminToken').value || state.token; const r = await api('/api/admin/logs', null, true); $('logOutput').innerHTML = dataTable(r.logs.map(l => ({ 제공처: l.provider, 상태: l.status, 수집건수: l.records_fetched, 완료: l.finished_at }))); }, $('logOutput'));
  await refreshProviders(); renderMetrics(); renderReport();
  if (window.APP_STATIC) setMode('LIVE');
  await initWorkspace();
}
window.addEventListener('DOMContentLoaded', () => init().catch(err => { toast(err.message); $('serverStatus').textContent = '초기화 실패 · 새로고침 필요'; }));
