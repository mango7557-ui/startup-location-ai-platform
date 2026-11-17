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
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/preview.html');
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
