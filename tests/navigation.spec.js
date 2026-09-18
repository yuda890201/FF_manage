// 画面上部のタブ切り替えとヘッダーメニュー。
//
// 「タブが切り替わらない時がある」「操作するとホームに飛ぶ」という不具合があった。
// 原因は、画面を離れる際の自動保存が手動保存として実行され、その中のホーム遷移が
// 走っていたこと。あわせて表示と内部状態がずれ、同一画面ガードでタブが無反応になっていた。

const { test, expect } = require('@playwright/test');
const { openAppMinimal, autoHandleDialogs } = require('./helpers');

const TABS = [
  { label: 'ホーム', view: 'homeView' },
  { label: '実績', view: 'recordView' },
  { label: '店舗マスタ', view: 'storeMasterView' },
  { label: '商品マスタ', view: 'itemMasterView' },
  { label: 'スケジュール目標', view: 'scheduleMasterView' },
  { label: '什器配置', view: 'layoutMasterView' }
];

function currentState(page) {
  return page.evaluate(() => ({
    view: document.querySelector('.view-container.active')?.id ?? null,
    activeView: currentActiveView
  }));
}

test('全タブを2周しても、毎回きちんと切り替わる', async ({ page }) => {
  await openAppMinimal(page);
  // 1周目で状態がずれると2周目が無反応になるため、2周して確かめる
  for (let round = 0; round < 2; round++) {
    for (const [index, tab] of TABS.entries()) {
      await page.locator('.nav-tab').nth(index).click();
      await page.waitForTimeout(120);
      const state = await currentState(page);
      expect(state.view, `${round + 1}周目: ${tab.label}`).toBe(tab.view);
      expect(state.activeView, `${round + 1}周目: ${tab.label} の内部状態`).toBeTruthy();
    }
  }
});

test('店舗マスタで保存してもホーム画面に飛ばされない', async ({ page }) => {
  await openAppMinimal(page, 'storeMaster');
  await page.evaluate(() => saveStoreMaster());
  await page.waitForTimeout(300);
  const state = await currentState(page);
  expect(state.view).toBe('storeMasterView');
  expect(state.activeView).toBe('storeMaster');
});

test('什器配置で保存してもホーム画面に飛ばされない', async ({ page }) => {
  await openAppMinimal(page, 'layoutMaster');
  await page.evaluate(() => saveLayoutMaster());
  await page.waitForTimeout(300);
  const state = await currentState(page);
  expect(state.view).toBe('layoutMasterView');
  expect(state.activeView).toBe('layoutMaster');
});

test('外部からswitchViewが呼ばれても、その後タブが反応しなくならない', async ({ page }) => {
  await openAppMinimal(page, 'storeMaster');
  // 保存処理などがホームへ直接遷移させた状況を再現する
  await page.evaluate(() => switchView('home'));
  await page.waitForTimeout(150);
  expect((await currentState(page)).activeView).toBe('home');

  // 以前はここで内部状態が storeMaster のまま残り、このタップが無視されていた
  await page.locator('.nav-tab').nth(2).click();
  await page.waitForTimeout(150);
  expect((await currentState(page)).view).toBe('storeMasterView');
});

test('ヘッダーのメニューから、バックアップとログアウトを実行できる', async ({ page }) => {
  await openAppMinimal(page);
  await page.evaluate(() => {
    window.__called = [];
    handleManualBackup = async () => { window.__called.push('backup'); };
    handleManualRestore = async () => { window.__called.push('restore'); };
    signOutUser = () => { window.__called.push('signout'); };
  });

  const panel = page.locator('#headerMenuPanel');
  await expect(panel).toBeHidden();

  // 普段使わないボタンはヘッダーに露出させない
  const headerText = await page.locator('.header-left-group').innerText();
  expect(headerText).not.toContain('バックアップ作成');
  expect(headerText).not.toContain('ログアウト');

  await page.locator('button', { hasText: 'メニュー' }).first().click();
  await expect(panel).toBeVisible();

  await panel.locator('button', { hasText: 'バックアップ作成' }).click();
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__called)).toContain('backup');
  await expect(panel).toBeHidden();
});

test('メニューは画面の別の場所をタップすると閉じる', async ({ page }) => {
  await openAppMinimal(page);
  const panel = page.locator('#headerMenuPanel');
  await page.locator('button', { hasText: 'メニュー' }).first().click();
  await expect(panel).toBeVisible();

  const size = page.viewportSize();
  await page.mouse.click(Math.floor(size.width / 2), size.height - 60);
  await expect(panel).toBeHidden();
});

test('ヘッダーが2段に折り返さず、店舗名も省略されない', async ({ page }) => {
  await openAppMinimal(page);
  const header = await page.evaluate(() => {
    const row = document.querySelector('.header-row-top').getBoundingClientRect();
    const badge = document.getElementById('currentStoreBadge');
    return {
      height: Math.round(row.height),
      badgeScrollWidth: badge.scrollWidth,
      badgeClientWidth: badge.clientWidth
    };
  });
  expect(header.height).toBeLessThanOrEqual(34);
  expect(header.badgeScrollWidth).toBeLessThanOrEqual(header.badgeClientWidth + 1);
});

test('画面を離れるときの自動保存で、確認ダイアログが割り込まない', async ({ page }) => {
  await openAppMinimal(page, 'storeMaster');
  const dialogs = autoHandleDialogs(page);
  await page.locator('.nav-tab').nth(3).click();
  await page.waitForTimeout(300);
  expect(dialogs.messages).toEqual([]);
  expect((await currentState(page)).view).toBe('itemMasterView');
});
