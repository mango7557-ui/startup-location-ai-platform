const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests', testMatch: 'ui.spec.js', timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:3107', headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: { command: 'node server/index.js', url: 'http://127.0.0.1:3107/api/health', env: { PORT: '3107', HOST: '127.0.0.1', ACCOUNTS_DB: ':memory:', CARD_SALES_DB: ':memory:', ADMIN_API_TOKEN: 'ui-test-only-admin-token-123456789', DATA_GO_KR_SERVICE_KEY: '', KOSIS_API_KEY: '', KAKAO_REST_API_KEY: '', NTS_SERVICE_KEY: '', SEOUL_DATA_API_KEY: '', KAKAO_CLIENT_SECRET: '', KAKAO_JAVASCRIPT_KEY: '', KAKAO_NATIVE_APP_KEY: '', KAKAO_BIZ_SECRET: '', KOSIS_SURVIVAL_QUERY: '', KOSIS_REGION_QUERY: '' }, reuseExistingServer: false }
});
