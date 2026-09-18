// index.html は単体で動く1ファイル構成なので、file:// で直接開いてテストする
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    // 失敗したときだけ、その瞬間の画面とトレースを残す
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    {
      // 実際の運用端末である12.3インチタブレット横向き
      name: 'tablet-12.3',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1368, height: 912 } }
    },
    {
      // 画面の縦幅が狭い場合(タイルが低くなる条件)
      name: 'tablet-small',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }
    }
  ]
});
