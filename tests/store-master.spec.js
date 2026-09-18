// 店舗マスタ。
//
// 店舗IDを変更すると什器配置・スケジュール設定が引き継がれず、設定が消えたように
// 見える不具合が実際に発生した。その再発を防ぐためのテスト。

const { test, expect } = require('@playwright/test');
const { APP_URL, blockFirebaseSdk, ensureLoggedInView, autoHandleDialogs } = require('./helpers');

/**
 * Firestore をメモリ上の簡易スタブに差し替えて店舗マスタを開く。
 * 店舗IDの変更でドキュメントがどう読み書きされるかを検証するため、
 * 保存処理はスタブ化せず実際のコードを通す。
 */
async function openStoreMaster(page, initialDocs) {
  await blockFirebaseSdk(page);
  await page.goto(APP_URL);
  await page.evaluate((docs) => {
    document.getElementById('login-overlay').style.display = 'none';
    currentUser = { uid: 'test' };
    initialDataLoaded = true;
    window.__firestore = JSON.parse(JSON.stringify(docs));

    db = {
      collection: (name) => ({
        doc: (id) => ({
          get: async () => ({
            exists: !!(window.__firestore[name] && window.__firestore[name][id]),
            data: () => window.__firestore[name][id]
          }),
          set: async (value) => {
            window.__firestore[name] = window.__firestore[name] || {};
            window.__firestore[name][id] = JSON.parse(JSON.stringify(value));
          },
          delete: async () => { delete window.__firestore[name][id]; }
        }),
        get: async () => ({
          docs: Object.keys(window.__firestore[name] || {}).map(id => ({
            id,
            data: () => window.__firestore[name][id]
          }))
        })
      })
    };

    ITEMS = [
      { id: 0, name: '（空き）', category: '-', price: 0, limitHour: 0 },
      { id: 1, name: 'ファミチキ', category: 'ホッターズ', price: 230, limitHour: 4, imageUrl: '' }
    ];
    STORE_MASTER = [
      { id: 'S001', name: '清川二丁目店', area: '福岡中央', memo: '' },
      { id: 'S002', name: '博多住吉通り店', area: '博多', memo: '' }
    ];
    currentStoreId = 'S001';
    STORES_CONFIG['S001'] = window.__firestore.storesConfig['S001'];
    STORES_CONFIG['S002'] = window.__firestore.storesConfig['S002'];

    applyCurrentStoreData();
    switchView('storeMaster');
  }, initialDocs);
  await ensureLoggedInView(page);
  await page.waitForTimeout(250);
}

const INITIAL_DOCS = {
  storesConfig: {
    S001: {
      fixtures: [{ name: '清川の什器', category: 'ホッターズ', cols: 1, rows: 1, cells: [] }],
      schedule: { weekday: { 1: { morning: 7, lunch: 7, evening: 7, minQty: 2 } } },
      timeSlots: { morning: { startHour: 7 }, lunch: { startHour: 11 }, evening: { startHour: 16 } }
    },
    S002: {
      fixtures: [{ name: '博多の什器', category: 'ホッターズ', cols: 1, rows: 1, cells: [] }],
      schedule: { weekday: { 1: { morning: 8, lunch: 8, evening: 8, minQty: 3 } } },
      timeSlots: { morning: { startHour: 8 }, lunch: { startHour: 11 }, evening: { startHour: 16 } }
    }
  },
  manualBackups: {}
};

test('店舗IDを変更しても、什器配置とスケジュール設定が引き継がれる', async ({ page }) => {
  await openStoreMaster(page, INITIAL_DOCS);

  await page.fill('#stm-id-0', 'fm71789');
  await page.fill('#stm-id-1', 'fm71661');
  await page.evaluate(() => saveStoreMaster());
  await page.waitForTimeout(500);

  const docs = await page.evaluate(() => JSON.parse(JSON.stringify(window.__firestore.storesConfig)));
  expect(docs['fm71789'].fixtures[0].name).toBe('清川の什器');
  expect(docs['fm71661'].fixtures[0].name).toBe('博多の什器');
  expect(docs['fm71789'].schedule.weekday['1'].minQty).toBe(2);

  // 変更前のドキュメントは、誤操作からの復旧元として残す
  expect(docs['S001']).toBeTruthy();
  expect(docs['S002']).toBeTruthy();
});

test('店舗IDを変更していなければ、余計な書き込みをしない', async ({ page }) => {
  await openStoreMaster(page, INITIAL_DOCS);
  const before = await page.evaluate(() => JSON.stringify(window.__firestore.storesConfig));
  await page.evaluate(() => saveStoreMaster());
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => JSON.stringify(window.__firestore.storesConfig));
  expect(after).toBe(before);
});

test('変更前の店舗IDからデータを復旧できる', async ({ page }) => {
  await openStoreMaster(page, INITIAL_DOCS);
  autoHandleDialogs(page);

  // 設定が初期状態に戻ってしまった店舗を用意する
  await page.evaluate(() => {
    STORE_MASTER = [{ id: 'fm71789', name: '福岡清川二丁目店', area: '福岡中央', memo: '' }];
    currentStoreId = 'fm71789';
    STORES_CONFIG['fm71789'] = { fixtures: [], schedule: {}, timeSlots: {} };
    renderStoreMasterTable();
    document.getElementById('storeMigratePanel').style.display = 'block';
    const select = document.getElementById('storeMigrateTargetSelect');
    select.innerHTML = STORE_MASTER.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  });

  await page.fill('#storeMigrateSourceId', 'S001');
  await page.locator('button', { hasText: 'この内容で復旧する' }).click();
  await page.waitForTimeout(500);

  const restored = await page.evaluate(() => JSON.parse(JSON.stringify(STORES_CONFIG['fm71789'])));
  expect(restored.fixtures[0].name).toBe('清川の什器');
  expect(restored.schedule.weekday['1'].minQty).toBe(2);
});

test('復旧元が見つからない場合は、復旧先の設定を壊さない', async ({ page }) => {
  await openStoreMaster(page, INITIAL_DOCS);
  const dialogs = autoHandleDialogs(page);

  await page.evaluate(() => {
    document.getElementById('storeMigratePanel').style.display = 'block';
    const select = document.getElementById('storeMigrateTargetSelect');
    select.innerHTML = STORE_MASTER.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    select.value = 'S002';
  });

  await page.fill('#storeMigrateSourceId', '存在しないID');
  await page.locator('button', { hasText: 'この内容で復旧する' }).click();
  await page.waitForTimeout(400);

  expect(dialogs.messages.join('\n')).toContain('見つかりませんでした');
  const untouched = await page.evaluate(() => JSON.parse(JSON.stringify(STORES_CONFIG['S002'])));
  expect(untouched.fixtures[0].name).toBe('博多の什器');
});

test('クラウドに残っている店舗IDを一覧で確認できる', async ({ page }) => {
  await openStoreMaster(page, INITIAL_DOCS);
  await page.evaluate(() => {
    document.getElementById('storeMigratePanel').style.display = 'block';
  });
  await page.locator('button', { hasText: '復旧できるデータを探す' }).click();
  await page.waitForTimeout(400);

  const result = await page.locator('#storeMigrateScanResult').innerText();
  expect(result).toContain('S001');
  expect(result).toContain('S002');
});
