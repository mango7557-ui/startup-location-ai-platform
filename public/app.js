'use strict';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, suffix = '') => v == null ? '미확보' : `${Number(v).toLocaleString('ko-KR')}${suffix}`;
const state = { mode: 'LIVE', meta: null, result: null, live: null, selected: null, compared: new Set(), map: null, layers: null, center: [37.5006, 127.0334], requestId: 0, token: '', view: 'explore', providers: [], liveQuery: null };
const labels = { survival: '생존·폐업 지표', competition: '경쟁 환경', demand: '배후 수요', cost: '비용 부담' };
let toastTimer;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6000); }
async function api(route, data, admin = false) {
  if (window.APP_STATIC) {
    if (route === '/api/meta') return window.APP_DEMO.meta;
    if (route === '/api/external/catalog') return { providers: window.APP_DEMO.providers.map(p => ({ ...p, status: 'SERVER_REQUIRED', configured: false })) };
    if (route === '/api/recommend' && data?.mode === 'DEMO') return window.APP_DEMO.analyze(data);
    throw new Error('정적 데모에서는 실제 API를 호출하지 않습니다. Node.js 서버에서 실행해 주세요.');
  }
  const response = await fetch(route, { method: data ? 'POST' : 'GET', headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(admin ? { Authorization: `Bearer ${state.token || $('adminToken').value}` } : {}) }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(20000) });
  let json;
  try { json = await response.json(); } catch { throw new Error('서버 응답을 읽을 수 없습니다. Node.js 서버 실행 상태를 확인하세요.'); }
  if (!response.ok) throw new Error(json.error || '요청 처리에 실패했습니다.');
  return json;
}
async function perform(button, fn, output) {
  const old = button?.textContent;
  if (button) { button.disabled = true; button.textContent = '조회 중…'; }
  try { await fn(); } catch (err) { if (output) output.textContent = err.message; toast(err.message); }
  finally { if (button) { button.disabled = false; button.textContent = old; } }
}
function switchView(view) {
  if (!['explore', 'compare', 'report', 'sources'].includes(view)) return;
  state.view = view;
  document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== `view-${view}`);
  document.querySelectorAll('.nav').forEach(el => { el.classList.toggle('active', el.dataset.view === view); el.setAttribute('aria-current', el.dataset.view === view ? 'page' : 'false'); });
  $('pageTitle').textContent = { explore: '상권 탐색', compare: '후보 비교', report: '분석 리포트', sources: '데이터 연결' }[view];
  if (view === 'explore') setTimeout(() => state.map?.invalidateSize(), 50);
  if (view === 'compare') renderComparison();
  if (view === 'report') renderReport();
  if (view === 'sources') refreshProviders();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function initMap() {
  if (!window.L) { $('map').innerHTML = '<div class="map-fallback">지도 라이브러리를 불러오지 못했습니다.<br>네트워크 연결을 확인하세요. 검색 목록은 계속 이용할 수 있습니다.</div>'; return; }
  state.map = L.map('map', { zoomControl: false }).setView(state.center, 14);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(state.map);
  state.layers = L.layerGroup().addTo(state.map);
  state.map.on('click', e => { state.center = [e.latlng.lat, e.latlng.lng]; updateCoordinates(); if (state.mode === 'LIVE') { state.live = null; state.liveQuery = null; drawMap(); renderLiveEmpty(); } });
  updateCoordinates();
}
function updateCoordinates() { $('coordinates').textContent = `${state.center[0].toFixed(5)}, ${state.center[1].toFixed(5)} · ${$('radius').value}m`; }
function drawMap() {
  if (!state.map) return;
  state.layers.clearLayers();
  const list = state.mode === 'DEMO' ? state.result?.candidates || [] : state.live?.items || [];
  L.circle(state.center, { radius: Number($('radius').value), color: '#438568', fillOpacity: .07, weight: 1.5 }).addTo(state.layers);
  list.forEach(c => {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return;
    const icon = L.divIcon({ className: '', html: `<div class="pin ${state.selected === c.id ? 'chosen' : ''}"><span>${state.mode === 'DEMO' ? c.rank : '•'}</span></div>`, iconSize: [34, 34], iconAnchor: [17, 34] });
    const marker = L.marker([c.lat, c.lng], { icon }).addTo(state.layers);
    marker.bindPopup(`<strong>${escapeHtml(c.name || c.store_name)}</strong><br>${escapeHtml(state.mode === 'DEMO' ? '가상 후보 위치 · 데모 전용' : c.address)}`);
    if (state.mode === 'DEMO') marker.on('click', () => showDetail(c.id));
  });
}
function populateIndustries(query = '') {
  const previous = $('industry').value;
  const q = query.replace(/\s/g, '').toLowerCase();
  const filtered = state.meta.industries.filter(i => !q || [i.industry_name, i.category_large, ...i.keywords].some(s => s.replace(/\s/g, '').toLowerCase().includes(q)));
  const groups = new Map();
  filtered.forEach(i => { if (!groups.has(i.category_large)) groups.set(i.category_large, []); groups.get(i.category_large).push(i); });
  $('industry').innerHTML = [...groups].map(([group, items]) => `<optgroup label="${escapeHtml(group)}">${items.map(i => `<option value="${i.industry_code}">${escapeHtml(i.industry_name)}</option>`).join('')}</optgroup>`).join('');
  if (filtered.some(i => i.industry_code === previous)) $('industry').value = previous;
  $('analyze').disabled = !filtered.length;
  $('industryHint').textContent = filtered.length ? `${filtered.length}개 업종 · 세부 코드 매핑은 제공기관 분류 확인이 필요합니다.` : '일치하는 업종이 없습니다. 검색어를 바꿔 주세요.';
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
  $('compareCount').textContent = '0'; state.map?.setView(state.center, 13); updateCoordinates(); drawMap(); renderLiveEmpty();
}
function setMode(mode) {
  state.requestId++;
  state.mode = mode; state.result = null; state.live = null; state.liveQuery = null; state.compared.clear(); state.selected = null;
  $('compareCount').textContent = '0';
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
    $('filterFeedback').textContent = '데이터를 확인하고 있습니다…';
    if (state.mode === 'DEMO') {
      const data = await api('/api/recommend', query());
      if (id !== state.requestId) return;
      state.result = data; state.compared = new Set([...state.compared].filter(id => data.candidates.some(c => c.id === id)));
      renderCandidates();
      const first = data.candidates[0]; if (first) { state.center = [first.lat, first.lng]; state.map?.setView(state.center, 13); }
    } else {
      // Broad UI categories are not asserted to be verified official small-industry codes.
      const p = page === 1 ? { cx: state.center[1], cy: state.center[0], radius: Number($('radius').value), numOfRows: 100, pageNo: 1 } : { ...state.liveQuery, pageNo: page };
      const data = await api('/api/external/semas', p);
      if (id !== state.requestId) return;
      state.live = data; state.liveQuery = p; renderStores();
    }
    renderMetrics(); drawMap(); updateCoordinates();
    $('filterFeedback').textContent = state.mode === 'DEMO' ? '가상 데이터 분석 완료 · 실제 추천이 아닙니다.' : '공식 API 응답을 조회했습니다. 선택 업종별 분류는 아래 점포의 원본 업종명을 확인하세요.';
  }, $('filterFeedback'));
}
function renderMetrics() {
  const demo = state.mode === 'DEMO';
  const values = demo ? [['데이터 모드', 'DEMO', '체험용 가상 데이터'], ['비교 가능 후보', `${state.result?.candidates.length || 0}곳`, '선택 조건에 따른 가상 결과'], ['평가 기준', '4개 지표', '초기 제안 가중치'], ['분석 반경', `${$('radius').value}m`, '가상 후보 중심 기준']]
    : [['데이터 모드', '실데이터', '공식 API 응답'], ['조회 점포', state.live ? fmt(state.live.items.length, '곳') : '—', state.live ? `전체 ${fmt(state.live.total_count, '곳')} · 페이지 ${state.live.page}` : '조회 후 표시'], ['데이터 기준', state.live?.observation_period || '—', '제공기관 기준시점'], ['분석 반경', `${$('radius').value}m`, '선택 좌표 중심']];
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
  $('resultsTitle').textContent = `실제 점포 ${data.items.length}곳 · ${data.page}페이지`;
  $('mapTitle').textContent = '선택 위치 주변의 실제 점포';
  $('resultNotice').hidden = false;
  $('resultNotice').textContent = `${data.mode === 'STALE' ? '갱신 실패 · 마지막 실제 수집 캐시' : data.mode === 'CACHED' ? '최근 실제 수집 캐시' : '공식 API 조회'} · 수집 ${new Date(data.collected_at).toLocaleString('ko-KR')} · 전체 업종 조회입니다. 업종명은 제공기관 원본 분류입니다.`;
  $('cards').innerHTML = data.items.map(c => `<article class="candidate panel"><div class="card-top"><span class="tag live">실제 API 응답</span><span class="location">${escapeHtml(c.industry_code || '분류 없음')}</span></div><h3>${escapeHtml(c.store_name)} ${escapeHtml(c.branch_name || '')}</h3><p class="location">${escapeHtml(c.address || '주소 미제공')}</p><div class="card-bottom"><span>${escapeHtml(c.industry_name || '업종 미제공')}</span><span class="location">${escapeHtml(c.floor || '층 미제공')}</span></div></article>`).join('') || '<div class="empty panel"><h3>조회된 점포가 없습니다.</h3><p>위치 또는 반경을 바꿔 다시 조회해 보세요.</p></div>';
  $('moreStores').hidden = data.total_count == null || data.page * data.page_size >= data.total_count;
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
  if (list.length < 2) { host.className = 'panel empty'; host.innerHTML = '<span>▥</span><h3>비교할 후보를 2~3곳 선택해 주세요</h3><p>데모 체험 결과에서 비교 담기를 선택하면 같은 분석 조건으로 나란히 볼 수 있습니다.</p>'; return; }
  host.className = 'panel padded';
  const rows = [['데모 점수', c => fmt(c.score)], ['가상 경쟁 점포', c => fmt(c.stores, '곳')], ['가상 상주 인구', c => fmt(c.population, '명')], ['가상 직장 인구', c => fmt(c.workers, '명')], ['가상 월세', c => fmt(c.rent, '만원')], ['가상 초기 비용', c => fmt(c.startup, '만원')], ['3년 가상 생존율', c => fmt(c.survival[1], '%')], ['결측 항목', c => c.missing.join(', ') || '없음']];
  host.innerHTML = `<div class="inline-notice">모든 비교 수치는 데모입니다. 현재 분석에서 산출한 동일한 가중치의 결과를 사용합니다.</div><div class="table-wrap"><table><thead><tr><th>비교 항목</th>${list.map(c => `<th>${escapeHtml(c.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, fn]) => `<tr><th>${label}</th>${list.map(c => `<td>${escapeHtml(fn(c))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function exportRows() {
  if (state.mode === 'DEMO') return (state.result?.candidates || []).map(c => ({ 데이터구분: 'DEMO 가상 데이터', 후보명: c.name, 지역: c.region, 가상점수: c.score, 가상점포수: c.stores, 가상월세만원: c.rent, 출처: '가상 시뮬레이션' }));
  return (state.live?.items || []).map(c => ({ 데이터구분: state.live.mode, 상호: c.store_name, 주소: c.address, 업종: c.industry_name, 기준시점: c.observation_period, 수집시각: state.live.collected_at, 출처: state.live.source_url }));
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
    const names = { NOT_CONFIGURED: '인증키 필요', READY: '설정됨 · 미검증', NEEDS_TABLE: '통계표 지정 필요', CONNECTED: '응답 확인', ERROR: '최근 호출 오류', SERVER_REQUIRED: '서버 필요' };
    $('providerCards').innerHTML = state.providers.map(p => `<article class="panel provider-card"><div class="provider-state"><span class="provider-icon">${{ semas: '⌂', nts: '✓', kosis: '▥', region: '◎', kakao: '⌖' }[p.id]}</span><span class="tag ${p.status === 'CONNECTED' ? 'live' : ''}">${names[p.status] || p.status}</span></div><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description)}</p><small>${escapeHtml(p.provider)} · ${p.last_success_at ? new Date(p.last_success_at).toLocaleString('ko-KR') : '실제 수집 성공 이력 없음'}</small><a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">공식 안내 및 활용 신청 ↗</a></article>`).join('');
    const count = state.providers.filter(p => p.status === 'CONNECTED').length;
    $('serverStatus').textContent = window.APP_STATIC ? '정적 데모 · 서버 미연결' : `서버 연결 · API 응답 확인 ${count}/5`;
  } catch (err) { $('serverStatus').textContent = '서버 연결 확인 필요'; toast(err.message); }
}
async function init() {
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => switchView(b.dataset.view));
  $('closeDetail').onclick = () => $('detail').close();
  $('detail').addEventListener('click', e => { if (e.target === $('detail')) { const r = $('detail').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('detail').close(); } });
  state.meta = await api('/api/meta');
  populateIndustries();
  $('sido').innerHTML = state.meta.regions.map(r => `<option>${escapeHtml(r.sido_name)}</option>`).join('');
  populateDistricts(); initMap();
  $('industrySearch').oninput = e => populateIndustries(e.target.value);
  $('sido').onchange = populateDistricts; $('sigungu').onchange = populateEmd;
  $('emd').onchange = () => { state.requestId++; state.result = null; state.live = null; state.compared.clear(); renderLiveEmpty(); drawMap(); toast('읍·면·동 중심 좌표는 주소 검색으로 확인해 주세요.'); };
  $('radius').onchange = () => { state.requestId++; state.live = null; state.result = null; renderLiveEmpty(); drawMap(); updateCoordinates(); };
  $('modeLive').onclick = () => setMode('LIVE'); $('modeDemo').onclick = () => setMode('DEMO');
  if ($('tryDemo')) $('tryDemo').onclick = () => setMode('DEMO');
  const defaults = [40, 25, 20, 15];
  $('weightControls').innerHTML = Object.entries(labels).map(([key, label], i) => `<label for="weight-${key}" class="weight-row"><span>${label}</span><output id="out-${key}">${defaults[i]}%</output></label><input id="weight-${key}" data-weight="${key}" type="range" min="5" max="70" step="5" value="${defaults[i]}">`).join('');
  const updateWeights = () => { const els = [...document.querySelectorAll('[data-weight]')]; const sum = els.reduce((a, b) => a + Number(b.value), 0); els.forEach(el => $(`out-${el.dataset.weight}`).textContent = `${Math.round(Number(el.value) / sum * 100)}%`); };
  document.querySelectorAll('[data-weight]').forEach(el => el.oninput = updateWeights);
  $('resetWeights').onclick = () => { document.querySelectorAll('[data-weight]').forEach((el, i) => el.value = defaults[i]); updateWeights(); };
  $('searchForm').onsubmit = e => { e.preventDefault(); analyze(); };
  $('moreStores').onclick = () => analyze(state.live.page + 1);
  $('placeForm').onsubmit = e => { e.preventDefault(); perform(e.submitter, async () => {
    const data = await api('/api/external/kakao', { query: $('placeQuery').value, action: $('placeType').value });
    $('placeResults').hidden = false;
    $('placeResults').innerHTML = data.documents.map((d, i) => `<button type="button" data-place="${i}">${escapeHtml(d.name)}<small>${escapeHtml(d.address)}</small></button>`).join('') || '<p class="hint">검색 결과가 없습니다.</p>';
    $('placeResults').querySelectorAll('[data-place]').forEach(b => b.onclick = () => { const d = data.documents[Number(b.dataset.place)]; if (d.lat == null || d.lng == null) return toast('좌표가 제공되지 않은 장소입니다.'); state.center = [d.lat, d.lng]; state.map?.setView(state.center, 16); $('placeResults').hidden = true; setMode('LIVE'); updateCoordinates(); });
  }); };
  $('print').onclick = () => { renderReport(); window.print(); };
  $('csv').onclick = () => { const rows = exportRows(); if (!rows.length) return toast('먼저 분석 또는 조회를 실행하세요.');
    const cell = v => { let s = String(v ?? ''); if (/^[=+@\-\t\r]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"`; };
    download('\uFEFF' + [Object.keys(rows[0]), ...rows.map(Object.values)].map(row => row.map(cell).join(',')).join('\r\n'), 'csv', 'text/csv;charset=utf-8'); };
  $('exportJson').onclick = () => { const data = state.mode === 'DEMO' ? state.result : state.live; if (!data) return toast('먼저 분석 또는 조회를 실행하세요.'); download(JSON.stringify(data, null, 2), 'json', 'application/json'); };
  const keyNames = ['DATA_GO_KR_SERVICE_KEY', 'NTS_SERVICE_KEY', 'KOSIS_API_KEY', 'KAKAO_REST_API_KEY'];
  $('keyFields').innerHTML = keyNames.map(k => `<label>${k}<input type="password" data-key="${k}" autocomplete="off" placeholder="변경할 키만 입력"></label>`).join('');
  if (window.APP_STATIC) { $('keysForm').querySelectorAll('input,button').forEach(el => el.disabled = true); $('keyMessage').textContent = '정적 데모에서는 인증키를 입력·보관하지 않습니다. 서버 환경변수를 설정하세요.'; }
  $('keysForm').onsubmit = e => { e.preventDefault(); perform(e.submitter, async () => {
    state.token = $('adminToken').value;
    const keys = Object.fromEntries([...document.querySelectorAll('[data-key]')].filter(el => el.value.trim()).map(el => [el.dataset.key, el.value.trim()]));
    if (!Object.keys(keys).length) throw new Error('변경할 인증키를 입력하세요.');
    const r = await api('/api/external/keys', keys, true); document.querySelectorAll('[data-key]').forEach(el => el.value = ''); $('keyMessage').textContent = r.message; await refreshProviders();
  }, $('keyMessage')); };
  $('statsForm').onsubmit = e => { e.preventDefault(); perform(e.submitter, async () => {
    let p; try { p = JSON.parse($('statsQuery').value || '{}'); } catch { throw new Error('조회 조건 JSON 형식을 확인하세요.'); }
    const r = await api(`/api/external/${$('statsProvider').value}`, p);
    $('statsOutput').innerHTML = `<p class="hint">${escapeHtml(r.mode)} · ${escapeHtml(r.collected_at)} · ${r.records.length}개 항목</p>${dataTable(r.records.map(v => ({ 통계표: v.table_name, 분류: v.classifications.map(c => c.name).join(' / '), 항목: v.item_name, 시점: v.period, 값: v.value, 단위: v.unit })))}<p class="hint">${escapeHtml(r.notice)}</p>`; await refreshProviders();
  }, $('statsOutput')); };
  $('ntsForm').onsubmit = e => { e.preventDefault(); perform(e.submitter, async () => { state.token = $('adminToken').value; const r = await api('/api/nts/verify', { bizNo: $('bizNo').value }, true); $('ntsOutput').innerHTML = dataTable(r.items.map(v => ({ 사업자번호: v.number_masked, 현재상태: v.status, 과세유형: v.tax_type, 확인된폐업일: v.closed_on }))) + `<p class="hint">${escapeHtml(r.notice)}</p>`; await refreshProviders(); }, $('ntsOutput')); };
  $('viewLogs').onclick = e => perform(e.currentTarget, async () => { state.token = $('adminToken').value; const r = await api('/api/admin/logs', null, true); $('logOutput').innerHTML = dataTable(r.logs.map(l => ({ 제공처: l.provider, 상태: l.status, 수집건수: l.records_fetched, 완료: l.finished_at }))); }, $('logOutput'));
  await refreshProviders(); renderMetrics(); renderReport();
  if (window.APP_STATIC) setMode('DEMO');
}
window.addEventListener('DOMContentLoaded', () => init().catch(err => { toast(err.message); $('serverStatus').textContent = '초기화 실패 · 새로고침 필요'; }));
