// 読み込み失敗時の保護。
//
// 電波が悪くてクラウドからの読み込みに失敗すると、アプリは初期設定を表示する。
// それを本物のデータと思い込んで操作し保存すると、保存は「全部書き換え」方式なので
// クラウドの正しいデータを初期設定で丸ごと上書きしてしまう。実際に2回発生した事故。

const { test, expect } = require('@playwright/test');
const { APP_URL, blockFirebaseSdk } = require('./helpers');

/**
 * 読み込みが必ず失敗する状態でアプリを開く。
 * 電波が悪くて Firestore から読めない状況の再現。
 */
async function openWithFailingLoad(page) {
  await blockFirebaseSdk(page);
  await page.goto(APP_URL);
  await page.evaluate(async () => {
    document.getElementById('login-overlay').style.display = 'none';
    currentUser = { uid: 'test' };
    window.__writes = [];

    // 読み取りは失敗、書き込みは記録だけする Firestore スタブ
    db = {
      collection: (name) => ({
        doc: (id) => ({
          get: async () => { throw new Error('通信エラー(テスト)'); },
          set: async (value) => { window.__writes.push({ name, id, value }); },
          delete: async () => {}
        }),
        get: async () => { throw new Error('通信エラー(テスト)'); }
      })
    };

    await loadInitialDataFromSpreadsheet();
  });
  await page.waitForTimeout(250);
}

test('読み込みに失敗したら、操作をブロックして知らせる', async ({ page }) => {
  await openWithFailingLoad(page);

  const overlay = page.locator('#loadErrorOverlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('データを読み込めませんでした');
  // 何が起きるかを伝えていること
  await expect(overlay).toContainText('上書き');
});

test('読み込みに失敗している間は、クラウドへ保存しない', async ({ page }) => {
  await openWithFailingLoad(page);

  // 読み込み失敗後に保存が走っても、クラウドへの書き込みは発生しない
  await page.evaluate(async () => {
    await saveStoreConfigToCloud(false);
    await saveSnapshotToCloud(false);
  });

  const writes = await page.evaluate(() => window.__writes);
  expect(writes).toEqual([]);
});

test('画面切り替えでの自動保存でも、クラウドを上書きしない', async ({ page }) => {
  await openWithFailingLoad(page);

  // 失敗に気づかず画面を触った状況。自動保存が走っても書き込まれないこと
  await page.evaluate(async () => {
    markUnsaved();
    await switchViewWithSave('itemMaster');
    await switchViewWithSave('scheduleMaster');
  });

  const writes = await page.evaluate(() => window.__writes);
  expect(writes).toEqual([]);
});

test('読み込みが成功すればブロックは解除され、保存できる', async ({ page }) => {
  await openWithFailingLoad(page);
  await expect(page.locator('#loadErrorOverlay')).toBeVisible();

  // 電波が戻って読み込めるようになった状況
  await page.evaluate(async () => {
    db = {
      collection: (name) => ({
        doc: (id) => ({
          get: async () => ({
            exists: name === 'meta' && id === 'storeMaster',
            data: () => ({ stores: [{ id: 'fm71661', name: '博多住吉通り店', area: '博多', memo: '' }] })
          }),
          set: async (value) => { window.__writes.push({ name, id, value }); },
          delete: async () => {}
        }),
        get: async () => ({ docs: [] })
      })
    };
    await retryInitialLoad();
  });
  await page.waitForTimeout(250);

  await expect(page.locator('#loadErrorOverlay')).toBeHidden();

  await page.evaluate(async () => { await saveStoreConfigToCloud(false); });
  const writes = await page.evaluate(() => window.__writes);
  expect(writes.length).toBeGreaterThan(0);
});
