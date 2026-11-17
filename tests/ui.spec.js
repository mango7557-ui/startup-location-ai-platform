const { test, expect } = require('@playwright/test');
test('live interface has no demo entry or simulated recommendations', async ({ page, request }) => {
  const errors = []; page.on('pageerror', err => errors.push(err.message));
  await page.goto('/');
  await expect(page.locator('#modeDemo')).toBeHidden();
  await expect(page.locator('.nav[data-view="compare"]')).toBeHidden();
  await expect(page.locator('#mapMode')).toContainText('실데이터');
  const response = await request.post('/api/recommend', { data: { mode: 'DEMO' } });
  expect((await response.json()).candidates).toEqual([]);
  await page.locator('.nav[data-view="sales"]').click(); await expect(page.locator('#view-sales')).toBeVisible();
  expect(errors).toEqual([]);
});
test('mobile navigation and responsive layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.locator('#modeDemo')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.locator('.nav[data-view="sources"]').click(); await expect(page.locator('#view-sources')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});
test('server live mode reports missing configuration instead of fake success', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#serverStatus')).toContainText('서버 연결');
  await page.locator('#analyze').click(); await expect(page.locator('#filterFeedback')).toContainText('인증키');
  await expect(page.locator('.candidate')).toHaveCount(0);
  await expect(page.locator('#modeDemo')).toBeHidden();
});
test('signup, persistent session, saved conditions and logout', async ({ page }) => {
  await page.goto('/#auth');
  await page.locator('#tabRegister').click();
  await page.locator('#authName').fill('창업 테스트');
  await page.locator('#authEmail').fill('browser@example.com');
  await page.locator('#authPassword').fill('test-password-long-123');
  await page.locator('#authConsent').check(); await page.locator('#authSubmit').click();
  await expect(page.locator('#accountContent')).toContainText('창업 테스트 님');
  await page.reload(); await expect(page.locator('#accountContent')).toContainText('browser@example.com');
  await page.locator('.nav[data-view="explore"]').click(); await page.locator('#saveSearch').click();
  await expect(page.locator('#toast')).toContainText('조건을 저장');
  await page.locator('.nav[data-view="account"]').click(); await expect(page.locator('.saved-search')).toHaveCount(1);
  await page.locator('[data-load-search]').click(); await expect(page.locator('#mapMode')).toContainText('실데이터');
  await page.locator('.nav[data-view="account"]').click(); await page.locator('[data-delete-search]').click();
  await expect(page.locator('.saved-search')).toHaveCount(0);
  await page.locator('#memberLogout').click(); await expect(page.locator('#accountButton')).toContainText('로그인');
  await page.locator('#accountButton').click(); await page.locator('#tabLogin').click();
  await page.locator('#authEmail').fill('browser@example.com'); await page.locator('#authPassword').fill('test-password-long-123');
  await page.locator('#authSubmit').click(); await expect(page.locator('#accountContent')).toContainText('창업 테스트 님');
});
test('admin gate, real connection failures and exit', async ({ page }) => {
  await page.goto('/#admin'); await expect(page.locator('#adminContent')).toBeHidden();
  await page.locator('#adminLoginToken').fill('wrong'); await page.locator('#adminLoginForm button').click();
  await expect(page.locator('#adminMessage')).toContainText('인증'); await expect(page.locator('#adminContent')).toBeHidden();
  await page.locator('#adminLoginToken').fill('ui-test-only-admin-token-123456789'); await page.locator('#adminLoginForm button').click();
  await expect(page.locator('#adminContent')).toBeVisible();
  await expect(page.locator('[data-key="KOSIS_REGION_QUERY"]')).toBeVisible();
  await page.locator('#csvText').fill('지역,상권명,업종,기준년월,카드매출금액,승인건수\n서울특별시 강남구,역삼역상권,커피전문점,202609,485000000,41200');
  await page.locator('#csvImportForm button[type="submit"]').click();
  await expect(page.locator('#csvImportMsg')).toContainText('1건 적재 완료');
  await page.locator('#checkConnections').click(); await expect(page.locator('#connectionResults')).toContainText('NOT_CONFIGURED');
  await expect(page.locator('#connectionResults')).toContainText('INPUT_REQUIRED');
  await page.screenshot({ path: 'test-results/admin.png', fullPage: true });
  await page.locator('#adminLogout').click(); await expect(page.locator('#adminContent')).toBeHidden();
  await page.locator('.nav[data-view="sales"]').click();
  await expect(page.locator('#localSalesOutput')).toContainText('역삼역상권');
});
test('all redesigned static sections on mobile are usable and isolated', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/preview.html');
  for (const view of ['explore', 'sales', 'report', 'sources', 'account', 'guide', 'admin']) {
    await page.locator(`.nav[data-view="${view}"]`).click();
    await expect(page.locator(`#view-${view}`)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), view).toBeTruthy();
  }
  await expect(page.locator('#adminLoginToken')).toBeDisabled();
  await page.locator('#accountButton').click(); await page.locator('#tabRegister').click();
  await expect(page.locator('#authSubmit')).toBeDisabled(); await expect(page.locator('#authStaticNotice')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/signup-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('daum map controls, external map link and postcode dialog work cleanly', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#linkDaumMap')).toHaveAttribute('href', /https:\/\/map\.kakao\.com\/link\/map\//);
  await expect(page.locator('#btnDaumPostcode')).toBeVisible();
  await expect(page.locator('#btnRoadview')).toBeVisible();
  await page.locator('#btnDaumPostcode').click();
  await expect(page.locator('#postcodeDialog')).toBeVisible();
  await page.locator('#closePostcode').click();
  await expect(page.locator('#postcodeDialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('selecting an industry fills its configured official code', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#officialIndustry')).toHaveValue('I21201');
  await page.locator('#industry').selectOption('IND_KOREAN');
  await expect(page.locator('#officialIndustry')).toHaveValue('I20101');
  await page.locator('#industrySearch').fill('커피');
  await expect(page.locator('#officialIndustry')).toHaveValue('I21201');
  await page.locator('#officialIndustry').fill('I20101');
  await expect(page.locator('#officialIndustry')).toHaveValue('I20101');
});

test('a stalled map SDK does not block sign in or navigation', async ({ page }) => {
  await page.route('**/api/meta', async route => {
    const original = await route.fetch();
    await route.fulfill({ json: { ...(await original.json()), kakao_js_key: 'ui-map-test-key' } });
  });
  let releaseMap;
  const mapGate = new Promise(resolve => { releaseMap = resolve; });
  await page.route('https://dapi.kakao.com/**', async route => { await mapGate; await route.abort().catch(() => {}); });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#serverStatus')).toContainText('서버 연결', { timeout: 4000 });
    await page.locator('#accountButton').click();
    await expect(page.locator('#authForm')).toBeVisible();
    await page.locator('#tabRegister').click();
    await expect(page.locator('#authName')).toBeVisible();
  } finally { releaseMap(); }
});

test('changing industry ignores a pending response for the previous selection', async ({ page }) => {
  let pending, requested;
  const received = new Promise(resolve => { requested = resolve; });
  await page.route('**/api/external/semas', route => { pending = route; requested(); });
  await page.goto('/');
  await page.locator('#analyze').click();
  await received;
  await page.locator('#industrySearch').fill('한식');
  await pending.fulfill({ json: { mode: 'LIVE', items: [{ store_name: '이전 업종 점포', address: '이전 조회 주소' }], total_count: 1, page: 1, page_size: 100 } });
  await expect(page.locator('#analyze')).toBeEnabled();
  await expect(page.locator('#cards')).not.toContainText('이전 업종 점포');
  await expect(page.locator('.candidate')).toHaveCount(0);
});

test('sales tabs ignore late responses and clear a chart after a failed refresh', async ({ page }) => {
  let pending, requested, failNext = false;
  const received = new Promise(resolve => { requested = resolve; });
  const response = (name, unit, value) => ({ mode: 'LIVE', provider_label: name, total_records: 1, notice: '회귀 검증', records: [{ classifications: [{ name }], item_name: '카드', period: '202609', unit, value }] });
  await page.route('**/api/card-sales/kosis', async route => {
    if (route.request().postDataJSON().type === 'approval') { pending = route; requested(); return; }
    if (failNext) { await route.fulfill({ status: 503, json: { error: '기관 연결 실패. 다시 조회해 주세요.' } }); return; }
    await route.fulfill({ json: response('새 결제비중', '%', 42) });
  });
  await page.goto('/#sales');
  await expect(page.locator('#kosisSalesBadge')).toHaveText('조회 대기');
  await page.locator('#kosisSalesForm button[type="submit"]').click();
  await received;
  await page.locator('[data-sales-tab="payment_share"]').click();
  await expect(page.locator('#kosisSalesChart')).toContainText('새 결제비중');
  await expect(page.locator('#kosisSalesBadge')).toHaveText('KOSIS 응답 확인');
  await pending.fulfill({ json: response('이전 승인실적', '백억원', 90) });
  await expect(page.locator('#kosisSalesForm button[type="submit"]')).toBeEnabled();
  await expect(page.locator('#kosisSalesOutput')).not.toContainText('이전 승인실적');
  await expect(page.locator('#kosisSalesChart')).toContainText('새 결제비중');
  failNext = true;
  await page.locator('#kosisSalesForm button[type="submit"]').click();
  await expect(page.locator('#kosisSalesOutput')).toContainText('기관 연결 실패');
  await expect(page.locator('#kosisSalesChart')).toBeEmpty();
  await expect(page.locator('#kosisSalesBadge')).toHaveText('조회 실패');
});

test('cancelling bulk sales deletion does not send a delete request', async ({ page }) => {
  let cleared = false;
  await page.route('**/api/admin/card-sales/clear', async route => { cleared = true; await route.fulfill({ json: {} }); });
  await page.goto('/#admin');
  await page.locator('#adminLoginToken').fill('ui-test-only-admin-token-123456789');
  await page.locator('#adminLoginForm button').click();
  await expect(page.locator('#adminContent')).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#clearSalesDb').click();
  await expect(page.locator('#clearSalesDb')).toBeEnabled();
  expect(cleared).toBe(false);
});

test('a denied map SDK search falls back to the server place search', async ({ page }) => {
  await page.route('**/api/external/kakao', route => route.fulfill({ json: { documents: [{ name: '서버 검색 결과', address: '서울특별시 강남구', lat: 37.5, lng: 127.03 }] } }));
  await page.goto('/');
  await expect(page.locator('#serverStatus')).toContainText('서버 연결');
  await page.evaluate(() => {
    window.daum = { maps: { services: { Status: { OK: 'OK', ZERO_RESULT: 'ZERO' }, Places: class { keywordSearch(query, callback) { callback([], 'ERROR'); } } } } };
  });
  await page.locator('#placeQuery').fill('강남역');
  await page.locator('#placeForm button[type="submit"]').click();
  await expect(page.locator('#placeResults')).toContainText('서버 검색 결과');
  await page.locator('[data-place="0"]').click();
  await expect(page.locator('#coordinates')).toContainText('37.50000, 127.03000');
});

test('live pages remain readable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  for (const view of ['explore', 'sales', 'sources', 'auth', 'admin']) {
    if (view === 'auth') await page.locator('#accountButton').click();
    else await page.locator(`.nav[data-view="${view}"]`).click();
    await expect(page.locator(`#view-${view}`)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), view).toBeTruthy();
  }
  await page.locator('.nav[data-view="sales"]').click();
  expect(await page.locator('#salesKeyword').evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await page.screenshot({ path: 'test-results/sales-mobile-live.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.nav[data-view="explore"]').click();
  await page.screenshot({ path: 'test-results/explore-desktop-live.png', fullPage: true });
});

test('SEMAS failure offers an explicit Kakao search with separate source and pagination', async ({ page }) => {
  const requests = [];
  await page.route('**/api/external/semas', route => route.fulfill({ status: 502, json: { code: 'PROVIDER_REJECTED', error: '공식 상가 API 활용 승인이 필요합니다.' } }));
  await page.route('**/api/external/kakao', route => {
    const payload = route.request().postDataJSON(); requests.push(payload);
    return route.fulfill({ json: { mode: 'LIVE', collected_at: '2026-11-18T00:00:00.000Z', source_url: 'https://developers.kakao.com/', meta: { total_count: 800, is_end: payload.page === 2 }, documents: [{ name: `카카오 검색 장소 ${payload.page}`, address: '서울 강남구', category: '음식점 > 카페', lat: 37.5, lng: 127.03 }] } });
  });
  await page.goto('/'); await page.locator('#analyze').click();
  await expect(page.locator('#filterFeedback')).toContainText('활용 승인');
  await expect(page.locator('#searchKakaoStores')).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.locator('#kakaoStoreQuery').fill('카페');
  await page.locator('#searchKakaoStores').click();
  await expect(page.locator('#cards')).toContainText('카카오 검색 장소 1');
  await expect(page.locator('#resultNotice')).toContainText('공식 전체 점포 수가 아닙니다');
  await expect(page.locator('#metrics')).toContainText('카카오 장소검색');
  await expect(page.locator('#metrics')).not.toContainText('800');
  expect(requests[0]).toMatchObject({ action: 'keyword', query: '카페', page: 1, radius: 500 });
  expect(requests[0]).not.toHaveProperty('indsSclsCd');
  await page.locator('#moreStores').click();
  await expect(page.locator('#cards')).toContainText('카카오 검색 장소 2');
  await expect(page.locator('#resultsTitle')).toContainText('2페이지');
  await expect(page.locator('#moreStores')).toBeHidden();
  await page.locator('.nav[data-view="report"]').click();
  await expect(page.locator('#report')).toContainText('카카오 장소검색 · 일부 검색 결과');
});

test('a failed Kakao fallback displays the error without inventing store results', async ({ page }) => {
  await page.route('**/api/external/semas', route => route.fulfill({ status: 502, json: { error: '공식 상가 조회 실패' } }));
  await page.route('**/api/external/kakao', route => route.fulfill({ status: 502, json: { error: '카카오 장소검색 연결 실패. 다시 시도해 주세요.' } }));
  await page.goto('/'); await page.locator('#analyze').click();
  await expect(page.locator('#searchKakaoStores')).toBeVisible();
  await page.locator('#kakaoStoreQuery').fill('카페'); await page.locator('#searchKakaoStores').click();
  await expect(page.locator('#filterFeedback')).toContainText('카카오 장소검색 연결 실패');
  await expect(page.locator('#searchKakaoStores')).toBeEnabled();
  await expect(page.locator('.candidate')).toHaveCount(0);
  await expect(page.locator('#resultNotice')).toBeHidden();
});
