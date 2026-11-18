'use strict';
let member = null, registering = false, currentSalesTab = 'approval', salesInitialized = false;
let kosisRequestId = 0, seoulRequestId = 0, localSalesRequestId = 0;

function renderBarGroup(title, entries, suffix = '') {
  const valid = entries.filter(([, v]) => Number.isFinite(v) && v >= 0);
  const max = Math.max(...valid.map(([, v]) => v), 1);
  return `<div><strong style="font-size:12px;display:block;margin-bottom:8px">${escapeHtml(title)}</strong>${valid.map(([k, v]) => `<div class="bar-row" style="margin-bottom:9px"><div><span>${escapeHtml(k)}</span><b>${fmt(v, suffix)}</b></div><section class="track"><i style="width:${Math.max(2, Math.round(v / max * 100))}%"></i></section></div>`).join('') || '<p class="hint">표시할 수치가 없습니다.</p>'}</div>`;
}

async function loadKosisSales(btn) {
  if (window.APP_STATIC) return;
  if (btn && busyButtons.has(btn)) return;
  const id = ++kosisRequestId, requestedTab = currentSalesTab;
  $('kosisSalesChart').textContent = '';
  $('kosisSalesOutput').textContent = '공식 통계를 불러오는 중…';
  $('kosisSalesBadge').textContent = '조회 중'; $('kosisSalesBadge').className = 'tag ready';
  await perform(btn, async () => {
    let r;
    try { r = await api('/api/card-sales/kosis', {
      type: requestedTab,
      sido: $('salesSidoFilter').value,
      keyword: $('salesKeyword').value
    }); } catch (err) { if (id !== kosisRequestId) return; $('kosisSalesBadge').textContent = '조회 실패'; throw err; }
    if (id !== kosisRequestId) return;
    $('kosisSalesBadge').textContent = r.mode === 'STALE' ? '이전 실제 응답' : 'KOSIS 응답 확인';
    $('kosisSalesBadge').className = `tag ${r.mode === 'STALE' ? 'ready' : 'live'}`;
    if (requestedTab === 'approval' && r.records.length) {
      const periods = [...new Set(r.records.map(x => x.period))].sort();
      const latest = periods[periods.length - 1];
      $('metricApproval').textContent = `${latest.slice(0, 4)}.${latest.slice(4)} 실적`;
      const latestRows = r.records.filter(x => x.period === latest && Number.isFinite(x.value)).sort((a, b) => b.value - a.value);
      $('kosisSalesChart').innerHTML = renderBarGroup(`${latest} 업종별 국내 카드승인실적 (단위: ${latestRows[0]?.unit || '백억원'})`, latestRows.map(x => [x.classifications[0]?.name || x.item_name, x.value]), ` ${latestRows[0]?.unit || ''}`);
    } else if (requestedTab === 'payment_share' && r.records.length) {
      const cardRow = r.records.find(x => x.item_name?.includes('카드'));
      if (cardRow && Number.isFinite(cardRow.value)) $('metricCardShare').textContent = `${cardRow.value}%`;
      const sampleGroup = r.records.filter(x => x.item_name !== '기업체 수' && Number.isFinite(x.value)).slice(0, 6);
      $('kosisSalesChart').innerHTML = renderBarGroup('결제수단별 구성비 상위 항목 (%)', sampleGroup.map(x => [`${x.classifications.map(c => c.name).join('·')} — ${x.item_name}`, x.value]), '%');
    } else {
      const topRows = r.records.filter(x => Number.isFinite(x.value)).sort((a, b) => b.value - a.value).slice(0, 6);
      $('kosisSalesChart').innerHTML = renderBarGroup(`소상공인 매출 상위 항목 (단위: ${topRows[0]?.unit || '억원'})`, topRows.map(x => [x.classifications.slice(0, 2).map(c => c.name).join(' · '), x.value]), ` ${topRows[0]?.unit || ''}`);
    }
    $('kosisSalesOutput').innerHTML = `<p class="hint">${escapeHtml(r.provider_label)} · ${escapeHtml(r.mode)} · 총 ${r.total_records}건 중 ${Math.min(r.records.length, 120)}건 표시</p>` + dataTable(r.records.slice(0, 120).map(v => ({
      분류: v.classifications.map(c => c.name).join(' / '),
      항목: v.item_name,
      기준시점: v.period,
      수치: v.value != null ? Number(v.value).toLocaleString('ko-KR') : v.raw_value,
      단위: v.unit
    }))) + `<p class="hint">${escapeHtml(r.notice)}</p>`;
    refreshProviders();
  }, $('kosisSalesOutput'));
}

async function loadSeoulSales(useSample, btn) {
  if (window.APP_STATIC) return;
  if (btn && busyButtons.has(btn)) return;
  const id = ++seoulRequestId;
  $('seoulBreakdown').hidden = true;
  $('seoulSalesOutput').textContent = '상권 카드매출을 불러오는 중…';
  await perform(btn, async () => {
    let r;
    try { r = await api('/api/card-sales/seoul', {
      useSample,
      quarter: $('seoulQuarter').value.trim(),
      keyword: $('seoulKeyword').value.trim()
    }); } catch (err) { if (id !== seoulRequestId) return; throw err; }
    if (id !== seoulRequestId) return;
    $('seoulKeyBadge').textContent = r.seoul_key_configured ? 'SEOUL LIVE' : '공식 샘플 모드';
    $('seoulKeyBadge').className = `tag ${r.seoul_key_configured ? 'live' : 'demo'}`;
    if (r.items.length) {
      const renderItemBreakdown = item => {
        $('seoulBreakdown').hidden = false;
        $('seoulBreakdown').innerHTML = `<div class="section-title"><h3>${escapeHtml(item.district_name)} · ${escapeHtml(item.industry_name)}</h3><span class="tag">${escapeHtml(item.quarter_label || '')}</span></div><p class="hint">분기 추정매출 <strong>${fmt(item.sales_amount, '원')}</strong> · 승인 <strong>${fmt(item.sales_count, '건')}</strong> · 건당 평균 <strong>${fmt(item.avg_ticket, '원')}</strong></p><div class="breakdown-grid">${renderBarGroup('시간대별 카드매출', Object.entries(item.by_time), '원')}${renderBarGroup('연령대별 카드매출', Object.entries(item.by_age), '원')}${renderBarGroup('요일별 카드매출', Object.entries(item.by_day), '원')}${renderBarGroup('성별 카드매출', Object.entries(item.by_gender), '원')}</div>`;
      };
      renderItemBreakdown(r.items[0]);
      $('seoulSalesOutput').innerHTML = `<p class="hint">${escapeHtml(r.mode)} · 전체 ${fmt(r.total_count, '건')} 중 ${r.items.length}건 조회 (행을 클릭하면 시간대·연령대 차트가 전환됩니다)</p><div class="table-wrap"><table><thead><tr><th>분기</th><th>상권구분</th><th>상권명</th><th>업종</th><th>카드 추정매출</th><th>승인건수</th><th>건당단가</th></tr></thead><tbody>${r.items.map((it, idx) => `<tr data-seoul-idx="${idx}" style="cursor:pointer"><td>${escapeHtml(it.quarter_label)}</td><td>${escapeHtml(it.district_type)}</td><td><strong>${escapeHtml(it.district_name)}</strong></td><td>${escapeHtml(it.industry_name)}</td><td>${fmt(it.sales_amount, '원')}</td><td>${fmt(it.sales_count, '건')}</td><td>${fmt(it.avg_ticket, '원')}</td></tr>`).join('')}</tbody></table></div><p class="hint">${escapeHtml(r.notice)}</p>`;
      $('seoulSalesOutput').querySelectorAll('[data-seoul-idx]').forEach(tr => {
        tr.tabIndex = 0; tr.setAttribute('role', 'button'); tr.setAttribute('aria-label', `${r.items[Number(tr.dataset.seoulIdx)].district_name} 상세 매출 보기`);
        tr.onclick = () => renderItemBreakdown(r.items[Number(tr.dataset.seoulIdx)]);
        tr.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); tr.click(); } };
      });
    } else {
      $('seoulBreakdown').hidden = true;
      $('seoulSalesOutput').innerHTML = `<p class="hint">일치하는 상권 카드매출 항목이 없습니다. ${escapeHtml(r.notice)}</p>`;
    }
  }, $('seoulSalesOutput'));
}

async function loadLocalDatasets() {
  if (window.APP_STATIC) return;
  const id = ++localSalesRequestId;
  $('localSalesOutput').textContent = '저장된 매출 자료를 불러오는 중…';
  try {
    const r = await api(`/api/card-sales/datasets?keyword=${encodeURIComponent($('localSalesQuery').value.trim())}`);
    if (id !== localSalesRequestId) return;
    $('metricImportedSales').textContent = `${r.total_count.toLocaleString('ko-KR')}건`;
    $('seoulKeyBadge').textContent = r.seoul_key_configured ? '서울 API · 키 설정됨' : '서울 열린데이터광장 · 샘플 가능';
    $('localSalesOutput').innerHTML = r.items.length
      ? dataTable(r.items.map(x => ({ 지역: x.region, 상권_행정동: x.district, 업종: x.industry, 기준시점: x.period, 카드매출금액: fmt(x.sales_amount, '원'), 승인건수: x.sales_count != null ? fmt(x.sales_count, '건') : '미제공', 출처: x.source })))
      : '<div class="empty" style="padding:24px"><h3>적재된 외부 카드매출 파일이 없습니다.</h3><p>관리자 콘솔의 [카드매출 CSV 적재]에서 금융데이터거래소·지자체·카드사 CSV를 업로드하면 이곳에 표시됩니다.</p></div>';
  } catch (err) {
    if (id !== localSalesRequestId) return;
    $('localSalesOutput').textContent = err.message;
  }
}

async function openSalesView() {
  if (window.APP_STATIC) {
    $('salesStaticNotice').hidden = false;
    return;
  }
  await loadLocalDatasets();
  if (!salesInitialized) {
    const kosisReady = state.providers.some(p => p.id === 'kosis' && p.configured);
    if (kosisReady) { salesInitialized = true; await loadKosisSales(); }
  }
}
function authTab(register) {
  registering = register;
  $('tabLogin').classList.toggle('selected', !register); $('tabRegister').classList.toggle('selected', register);
  $('tabLogin').setAttribute('aria-pressed', String(!register)); $('tabRegister').setAttribute('aria-pressed', String(register));
  $('nameLabel').hidden = !register; $('consentLabel').hidden = !register; $('passwordHint').hidden = !register;
  $('authName').required = register; $('authConsent').required = register;
  $('authPassword').minLength = register ? 12 : 1;
  $('authPassword').autocomplete = register ? 'new-password' : 'current-password';
  $('authTitle').textContent = register ? '당신의 시작을 응원해요.' : '다시 만나 반가워요.';
  $('authSubtitle').textContent = register ? '계정을 만들고 나만의 탐색 조건을 저장하세요.' : '이메일로 나의 워크스페이스에 로그인하세요.';
  $('authSubmit').textContent = register ? '내 워크스페이스 만들기 →' : '로그인 →';
  $('authMessage').textContent = '';
}
function updateMember() {
  $('accountButton').textContent = member ? `${member.name} 님 ↗` : '로그인 / 가입 ↗';
  $('accountButton').onclick = () => switchView(member ? 'account' : 'auth');
}
async function renderAccount() {
  if (!member) {
    $('accountContent').innerHTML = '<div class="empty"><span>♡</span><h3>당신의 다음 시작을 기록하세요.</h3><p>로그인하면 창업 조건을 저장하고 다시 불러올 수 있어요.</p><button class="primary" id="accountJoin">나의 워크스페이스 만들기 →</button></div>';
    $('accountJoin').onclick = () => { authTab(true); switchView('auth'); }; return;
  }
  $('accountContent').innerHTML = '<p class="hint">저장한 조건을 불러오는 중…</p>';
  try {
    const { searches } = await api('/api/account/searches');
    $('accountContent').innerHTML = `<div class="account-profile"><span class="avatar">${escapeHtml(member.name[0])}</span><div><p>WELCOME BACK</p><h2>${escapeHtml(member.name)} 님의 워크스페이스</h2><p>${escapeHtml(member.email)}</p></div><button id="memberLogout" class="secondary">로그아웃</button></div><div class="section-title"><h2>저장한 창업 조건</h2><span class="tag">${searches.length} / 30</span></div><div class="saved-grid">${searches.length ? searches.map(s => `<article class="saved-search"><span class="tag">상권 탐색 조건</span><h3>${escapeHtml(s.title)}</h3><p>${escapeHtml(s.data.sido)} ${escapeHtml(s.data.sigungu)} · 반경 ${escapeHtml(s.data.radius)}m<br>${new Date(s.created_at).toLocaleDateString('ko-KR')} 저장</p><div class="button-row"><button class="primary" data-load-search="${s.id}">조건 불러오기 ↗</button><button class="quiet" data-delete-search="${s.id}">삭제</button></div></article>`).join('') : '<div class="empty"><span>⌖</span><h3>첫 번째 탐색을 저장해 보세요.</h3><p>상권 탐색에서 업종·지역을 선택한 뒤 ‘조건 저장’을 눌러주세요.</p><button class="secondary" id="startSaved">상권 탐색하기 →</button></div>'}</div>`;
    $('memberLogout').onclick = e => perform(e.currentTarget, async () => { await api('/api/auth/logout', {}); member = null; updateMember(); await renderAccount(); toast('로그아웃했습니다.'); });
    if ($('startSaved')) $('startSaved').onclick = () => switchView('explore');
    document.querySelectorAll('[data-delete-search]').forEach(b => b.onclick = () => perform(b, async () => { await api('/api/account/searches/delete', { id: b.dataset.deleteSearch }); await renderAccount(); }));
    document.querySelectorAll('[data-load-search]').forEach(b => b.onclick = () => {
      const d = searches.find(s => s.id === b.dataset.loadSearch).data;
      $('industrySearch').value = ''; populateIndustries(); $('industry').value = d.industry;
      if (![...$('sido').options].some(o => o.value === d.sido)) return toast('지역 목록이 변경되어 조건을 불러올 수 없습니다.');
      $('sido').value = d.sido; populateDistricts();
      if (![...$('sigungu').options].some(o => o.value === d.sigungu)) return toast('지역 목록이 변경되어 조건을 불러올 수 없습니다.');
      $('sigungu').value = d.sigungu; populateEmd();
      for (const id of ['emd', 'radius', 'budget', 'rent', 'storeType']) if (d[id] != null) $(id).value = d[id];
      ['Survival', 'Competition', 'Demand', 'Cost'].forEach(k => { if (Number.isFinite(d[`w${k}`])) $(`weight-${k.toLowerCase()}`).value = Math.round(d[`w${k}`] * 100); });
      $('weight-survival').dispatchEvent(new Event('input')); setMode('LIVE'); if (Number.isFinite(d.lat) && Number.isFinite(d.lng)) { moveMap(d.lat, d.lng, 16); updateCoordinates(); } $('officialIndustry').value = d.officialIndustry || ''; switchView('explore'); toast('저장한 탐색 조건을 불러왔습니다.');
    });
  } catch (err) { $('accountContent').innerHTML = `<div class="empty"><h3>워크스페이스를 불러오지 못했습니다.</h3><p>${escapeHtml(err.message)}</p><button id="retryAccount" class="secondary">다시 로그인</button></div>`; $('retryAccount').onclick = () => { member = null; updateMember(); switchView('auth'); }; }
}
async function refreshAdmin() {
  const r = await api('/api/admin/overview', null, true);
  $('adminContent').hidden = false; document.querySelector('.admin-gate').hidden = true;
  $('adminMetrics').innerHTML = [['가입 회원', `${r.count}명`, '이 서버에 등록된 계정'], ['API 응답 확인', `${r.providers.filter(p => p.status === 'CONNECTED').length} / 5`, `키 설정 ${r.providers.filter(p => p.configured).length}/5`], ['기록된 호출', `${r.logs.length}건`, '최근 최대 100건'], ['서버 가동', `${Math.floor(r.uptime / 60)}분`, '현재 프로세스 기준']].map(([title, value, sub]) => `<article><span>${title}</span><strong>${value}</strong><small>${sub}</small></article>`).join('');
  if (r.kakao_channels) {
    const channelLabels = [['REST / 로컬', r.kakao_channels.oauth], ['카카오 로그인 Secret', r.kakao_channels.client_secret], ['JavaScript SDK', r.kakao_channels.js_sdk], ['네이티브 앱', r.kakao_channels.native_app], ['비즈니스 인증', r.kakao_channels.biz_auth]];
    let strip = $('kakaoChannelStrip');
    if (!strip) { strip = document.createElement('div'); strip.id = 'kakaoChannelStrip'; strip.className = 'channel-badges'; $('adminMetrics').after(strip); }
    strip.innerHTML = channelLabels.map(([label, ok]) => `<span class="tag ${ok ? 'live' : ''}">Kakao ${label}: ${ok ? '설정됨' : '미설정'}</span>`).join('');
  }
  $('memberTable').innerHTML = r.users.length ? dataTable(r.users.map(u => ({ 이름: u.name, 이메일: u.email, 가입일: new Date(u.created_at).toLocaleString('ko-KR') }))) : '<div class="empty"><h3>아직 가입한 회원이 없습니다.</h3><p>실제 서버에 가입한 계정만 표시됩니다.</p></div>';
  $('logOutput').innerHTML = dataTable(r.logs.map(l => ({ 제공처: l.provider, 상태: l.status, 건수: l.records_fetched, 완료: l.finished_at })));
  await refreshProviders();
}
async function initWorkspace() {
  // Keep credential and identity tools inside the authenticated console.
  for (const id of ['keysForm', 'ntsForm']) $('adminTools').append($(id).closest('section'));
  const logSection = document.createElement('section'); logSection.className = 'panel padded';
  logSection.innerHTML = '<div class="section-title"><h2>실제 API 호출 이력</h2><span class="tag">최근 100건</span></div>';
  logSection.append($('viewLogs'), $('logOutput')); $('adminTools').append(logSection);
  const csvSection = document.createElement('section'); csvSection.className = 'panel padded';
  csvSection.innerHTML = '<div class="section-title"><h2>카드매출 데이터셋 적재</h2><span class="tag">CSV · 관리자</span></div><p class="hint">금융데이터거래소(FinDX), 경기데이터드림, 지자체 상권포털 등의 카드매출 CSV를 서버 SQLite에 적재합니다.</p><p class="inline-notice">업로드한 지역·상권별 매출 자료는 사이트 방문자에게 공개됩니다. 개인·회원 정보는 포함하지 마세요.</p><form id="csvImportForm"><label>데이터 출처명<input id="csvSource" placeholder="예: 경기도시장상권진흥원 카드매출" value="외부 카드매출 CSV"></label><label>CSV 파일 선택 (선택)<input id="csvFile" type="file" accept=".csv,text/csv"></label><label>CSV 내용 (헤더: 지역,상권명,업종,기준년월,카드매출금액,승인건수)<textarea id="csvText" rows="5" spellcheck="false" placeholder="지역,상권명,업종,기준년월,카드매출금액,승인건수&#10;서울특별시 강남구,역삼역상권,커피전문점,202609,485000000,41200"></textarea></label><div class="button-row"><button class="primary" type="submit">카드매출 CSV 적재</button><button class="quiet" type="button" id="clearSalesDb">적재 데이터 초기화</button></div><p id="csvImportMsg" class="hint" aria-live="polite"></p></form>';
  $('adminTools').append(csvSection);
  if ($('salesSidoFilter') && state.meta?.regions) {
    $('salesSidoFilter').innerHTML = '<option value="">전국 전체</option>' + state.meta.regions.map(r => `<option value="${escapeHtml(r.sido_name)}">${escapeHtml(r.sido_name)}</option>`).join('');
  }
  document.querySelectorAll('[data-sales-tab]').forEach(btn => btn.onclick = () => {
    currentSalesTab = btn.dataset.salesTab;
    document.querySelectorAll('[data-sales-tab]').forEach(b => { b.classList.toggle('selected', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
    loadKosisSales();
  });
  $('kosisSalesForm').onsubmit = e => { e.preventDefault(); loadKosisSales(e.submitter); };
  $('seoulSalesForm').onsubmit = e => { e.preventDefault(); loadSeoulSales(false, e.submitter); };
  $('btnSeoulSample').onclick = e => loadSeoulSales(true, e.currentTarget);
  $('localSalesForm').onsubmit = e => { e.preventDefault(); loadLocalDatasets(); };
  $('csvFile').onchange = async e => { const f = e.target.files?.[0]; if (f) $('csvText').value = await f.text(); };
  $('csvImportForm').onsubmit = e => { e.preventDefault(); perform(e.submitter, async () => {
    const r = await api('/api/admin/card-sales/import', { source: $('csvSource').value, csv: $('csvText').value }, true);
    $('csvImportMsg').textContent = `${r.inserted}건 적재 완료 · 현재 총 ${r.total}건 보관 중`;
    $('csvText').value = ''; $('csvFile').value = '';
  }, $('csvImportMsg')); };
  $('clearSalesDb').onclick = e => {
    if (!window.confirm('적재한 카드매출 자료를 모두 삭제할까요? 삭제 후 복구하려면 원본 CSV를 다시 적재해야 합니다.')) return;
    perform(e.currentTarget, async () => {
    await api('/api/admin/card-sales/clear', {}, true);
    $('csvImportMsg').textContent = '적재된 외부 카드매출 데이터를 모두 비웠습니다.';
    await loadLocalDatasets();
  }, $('csvImportMsg')); };
  if (window.APP_STATIC) {
    $('kosisSalesForm').querySelectorAll('input,select,button').forEach(el => el.disabled = true);
    $('seoulSalesForm').querySelectorAll('input,button').forEach(el => el.disabled = true);
    $('localSalesForm').querySelectorAll('input,button').forEach(el => el.disabled = true);
    $('csvImportForm').querySelectorAll('input,textarea,button').forEach(el => el.disabled = true);
  }
  $('adminToken').closest('label').hidden = true; $('adminToken').required = false;
  for (const [key, label] of [['KOSIS_SURVIVAL_QUERY', '기업생멸 기본 통계표'], ['KOSIS_REGION_QUERY', '지역 수요 기본 통계표']]) {
    const host = document.createElement('label'); host.textContent = label;
    const input = document.createElement('textarea'); input.dataset.key = key; input.rows = 3; input.spellcheck = false; input.placeholder = '{"orgId":"기관 코드","tblId":"통계표 코드","objL1":"분류 코드","itmId":"항목 코드","prdSe":"Y"}';
    if (window.APP_STATIC) input.disabled = true;
    host.append(input); $('keyFields').append(host);
  }
  $('heroExplore').onclick = () => { $('industrySearch').focus({ preventScroll: true }); $('searchForm').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  $('tabLogin').onclick = () => authTab(false); $('tabRegister').onclick = () => authTab(true);
  $('togglePassword').onclick = () => { const show = $('authPassword').type === 'password'; $('authPassword').type = show ? 'text' : 'password'; $('togglePassword').textContent = show ? '숨김' : '보기'; $('togglePassword').setAttribute('aria-label', show ? '비밀번호 숨김' : '비밀번호 표시'); };
  $('privacyOpen').onclick = () => { $('detailBody').innerHTML = '<p class="eyebrow">ACCOUNT DATA</p><h2>계정 정보 저장 안내</h2><p>저장 항목: 이름, 이메일, 비밀번호 해시, 가입 시각, 로그인 세션, 직접 저장한 분석 조건.</p><p>이용 목적: 로그인과 개인 워크스페이스 제공. 데이터는 이 서비스를 실행하는 서버의 SQLite 파일에 저장됩니다. 비밀번호 원문이나 외부 API 키는 회원 정보에 저장되지 않습니다.</p><p>이메일 소유 확인과 비밀번호 재설정 메일은 아직 지원하지 않습니다. 실제 운영자는 서비스 개설 전에 개인정보 처리방침, 보관 기간 및 문의·삭제 창구를 등록해야 합니다.</p>'; $('detail').showModal(); };
  $('authForm').onsubmit = e => { e.preventDefault(); perform(e.submitter, async () => {
    $('authMessage').textContent = '';
    const r = await api(`/api/auth/${registering ? 'register' : 'login'}`, { name: $('authName').value, email: $('authEmail').value, password: $('authPassword').value, consent: $('authConsent').checked });
    member = r.user; $('authForm').reset(); updateMember(); switchView('account'); toast(registering ? '가입이 완료되었습니다. 나만의 탐색을 시작해 보세요.' : '로그인했습니다.');
  }, $('authMessage')); };
  $('saveSearch').onclick = e => {
    if (!member) { authTab(true); switchView('auth'); return; }
    if (!$('industry').value) return toast('저장할 업종을 선택해 주세요.');
    perform(e.currentTarget, async () => { const d = { industry: $('industry').value, sido: $('sido').value, sigungu: $('sigungu').value, emd: $('emd').value, radius: Number($('radius').value), lat: state.center[0], lng: state.center[1], officialIndustry: $('officialIndustry').value }; await api('/api/account/searches', { title: `${$('industry').selectedOptions[0].textContent} · ${d.sigungu}`, data: d }); toast('내 워크스페이스에 조건을 저장했습니다.'); });
  };
  $('adminLoginForm').onsubmit = e => { e.preventDefault(); perform(e.submitter, async () => {
    state.token = $('adminLoginToken').value;
    try { await refreshAdmin(); $('adminLoginToken').value = ''; $('adminMessage').textContent = ''; $('toast').hidden = true; }
    catch (err) { state.token = ''; throw err; }
  }, $('adminMessage')); };
  $('adminRefresh').onclick = e => perform(e.currentTarget, refreshAdmin);
  $('adminLogout').onclick = () => { state.token = ''; $('adminToken').value = ''; $('adminContent').hidden = true; document.querySelector('.admin-gate').hidden = false; $('memberTable').textContent = ''; $('connectionResults').textContent = ''; $('logOutput').textContent = ''; $('ntsOutput').textContent = ''; $('bizNo').value = ''; document.querySelectorAll('[data-key]').forEach(el => el.value = ''); toast('관리자 인증을 종료했습니다.'); };
  $('checkConnections').onclick = e => perform(e.currentTarget, async () => { $('connectionResults').textContent = '기관별 연결을 확인합니다…'; const r = await api('/api/admin/check', { bizNo: $('bizNo').value }, true); const names = Object.fromEntries(state.providers.map(p => [p.id, p.name])); $('connectionResults').innerHTML = dataTable(r.results.map(c => ({ 기관: names[c.id] || c.id, 상태: c.status, 결과: c.message, 수집시각: c.collected_at || '—' }))); await refreshAdmin(); }, $('connectionResults'));
  if (window.APP_STATIC) {
    $('authStaticNotice').hidden = false;
    $('authForm').querySelectorAll('input,button').forEach(el => el.disabled = true);
    $('adminLoginForm').querySelectorAll('input,button').forEach(el => el.disabled = true);
    $('adminMessage').textContent = '정적 데모입니다. 관리자 기능은 서버 배포 후 사용할 수 있습니다.';
  } else {
    try {
      const me = await api('/api/auth/me');
      member = me.user;
      if (me.kakao_login) {
        $('kakaoAuthBox').hidden = false;
        $('kakaoRedirectHint').textContent = `${location.origin}/api/auth/kakao/callback`;
        $('kakaoLoginBtn').onclick = () => { location.href = '/api/auth/kakao/start'; };
      }
      const oauthError = new URLSearchParams(location.search).get('oauth_error');
      if (oauthError) {
        const msg = { state: '카카오 인증 세션이 만료되었습니다. 다시 시도해 주세요.', token: '카카오 토큰 발급에 실패했습니다. 카카오 디벨로퍼스 Redirect URI 및 Client Secret 설정을 확인하세요.', profile: '카카오 사용자 정보를 불러오지 못했습니다.', account: '같은 이메일의 계정이 있습니다. 이메일과 비밀번호로 로그인해 주세요.', network: '카카오 인증 서버에 연결하지 못했습니다.' }[oauthError] || '카카오 로그인에 실패했습니다.';
        $('authMessage').textContent = msg;
        history.replaceState(null, '', location.pathname + location.hash);
      }
    } catch (err) { toast(err.message); }
  }
  updateMember();
  const initial = location.hash.slice(1); if (initial) switchView(initial);
  window.addEventListener('hashchange', () => switchView(location.hash.slice(1) || 'explore'));
}
