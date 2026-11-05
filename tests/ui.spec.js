const { test, expect } = require('@playwright/test');
test('desktop demo, comparison, report and static credential isolation', async ({ page }) => {
  const errors = []; page.on('pageerror', err => errors.push(err.message));
  await page.goto('/preview.html');
  await expect(page.locator('.candidate')).toHaveCount(10);
  await expect(page.locator('#mapMode')).toContainText('DEMO');
  await page.locator('[data-compare]').nth(0).check(); await page.locator('[data-compare]').nth(1).check();
  await page.locator('.nav[data-view="compare"]').click();
  await expect(page.locator('#comparison table')).toBeVisible();
  await page.locator('.nav[data-view="report"]').click();
  await expect(page.locator('#report')).toContainText('모든 수치는 가상 데이터');
  const downloading = page.waitForEvent('download'); await page.locator('#csv').click(); expect((await downloading).suggestedFilename()).toContain('DEMO');
  await page.locator('.nav[data-view="sources"]').click();
  await expect(page.locator('.provider-card')).toHaveCount(5);
  await expect(page.locator('#adminToken')).toBeDisabled();
  await page.locator('.nav[data-view="explore"]').click();
  await page.locator('[data-detail]').first().click(); await expect(page.locator('#detail')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('#detail')).not.toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
});
test('mobile navigation and responsive layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/preview.html');
  await expect(page.locator('.candidate')).toHaveCount(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.locator('.nav[data-view="sources"]').click(); await expect(page.locator('#view-sources')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});
test('server live mode reports missing configuration instead of fake success', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#serverStatus')).toContainText('서버 연결');
  await page.locator('#analyze').click(); await expect(page.locator('#filterFeedback')).toContainText('인증키');
  await expect(page.locator('.candidate')).toHaveCount(0);
  await page.locator('#modeDemo').click(); await expect(page.locator('.candidate')).toHaveCount(10);
});
