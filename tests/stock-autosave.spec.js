// ホーム画面の在庫数の自動保存。
//
// 以前は調理/販売をタップしても在庫数がクラウドに保存されず、タブレットを開き直すと
// 「最後にマスタ画面を保存した時点」の在庫に戻っていた。
// 在庫は什器配置・スケジュールとは別のドキュメント(storeStock)に保存し、
// 設定を巻き込まずに頻繁に書けるようにしている。

const { test, expect } = require('@playwright/test');
const { APP_URL, blockFirebaseSdk, ensureLoggedInView } = require('./helpers');

const STORE_ID = 'fm71661';

/** 什器1台(3マス)のホーム画面を開く。保存はすべてメモリ上のスタブに記録する */
async function openHome(page, { savedStock = null } = {}) {
  await blockFirebaseSdk(page);
  await page.goto(APP_URL);
  await page.evaluate(([storeId, savedStock]) => {
    document.getElementById('login-overlay').style.display = 'none';
    currentUser = { uid: 'test' };
    initialDataLoaded = true;
    window.__cloud = { storeStock: {} };
    if (savedStock) window.__cloud.storeStock[storeId] = { stock: savedStock };
    window.__writes = [];

    db = {
      collection: (name) => ({
        doc: (id) => ({
          get: async () => ({
            exists: !!(window.__cloud[name] && window.__cloud[name][id]),
            data: () => window.__cloud[name][id]
          }),
          set: async (value) => {
            window.__writes.push({ col: name, id });
            window.__cloud[name] = window.__cloud[name] || {};
            window.__cloud[name][id] = JSON.parse(JSON.stringify(value));
          },
          delete: async () => {}
        }),
        add: async () => { window.__writes.push({ col: name, add: true }); },
        get: async () => ({ docs: [] })
      })
    };

    ITEMS = [
      { id: 0, name: '（空き）', category: '-', price: 0, limitHour: 0 },
      { id: 1, name: 'ファミチキ', category: 'ホッターズ', price: 230, limitHour: 4, imageUrl: '' },
      { id: 2, name: 'ハッシュドポテト', category: 'ホッターズ', price: 130, limitHour: 4, imageUrl: '' }
    ];
    STORE_MASTER = [{ id: storeId, name: '博多住吉通り店', area: '博多', memo: '' }];
    currentStoreId = storeId;
    STORES_CONFIG[storeId] = {
      fixtures: [{
        name: 'ホッターズ', category: 'ホッターズ', cols: 3, rows: 1,
        cells: [
          { itemId: 1, stock: 0, cookTime: null },
          { itemId: 2, stock: 0, cookTime: null },
          { itemId: 0, stock: 0, cookTime: null }
        ]
      }],
      schedule: { weekday: { 1: { morning: 5, lunch: 5, evening: 5, minQty: 1 }, 2: { morning: 4, lunch: 4, evening: 4, minQty: 1 } } },
      timeSlots: { morning: { startHour: 6 }, lunch: { startHour: 11 }, evening: { startHour: 16 } }
    };
    loadedStoreConfigIds.add(storeId);

    applyCurrentStoreData();
    switchView('home');
    window.__writes = [];
  }, [STORE_ID, savedStock]);
  await ensureLoggedInView(page);
  await page.waitForTimeout(300);
}

/** 保留中の在庫保存をすぐ確定させる(テストで10秒待たないため) */
const flush = page => page.evaluate(() => flushStockSave());
const stockDoc = page => page.evaluate(id => JSON.parse(JSON.stringify(window.__cloud.storeStock[id] || null)), STORE_ID);

test('調理をタップした在庫数がクラウドに保存される', async ({ page }) => {
  await openHome(page);
  await page.evaluate(() => { for (let i = 0; i < 5; i++) handleTouch('0_0', 'cook'); });
  await flush(page);

  const doc = await stockDoc(page);
  expect(doc.stock['0_0']).toMatchObject({ itemId: 1, stock: 5 });
});

test('販売でも在庫数が保存される', async ({ page }) => {
  await openHome(page);
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) handleTouch('0_1', 'cook');
    handleTouch('0_1', 'sell');
  });
  await flush(page);

  const doc = await stockDoc(page);
  expect(doc.stock['0_1'].stock).toBe(3);
});

test('在庫の保存で、什器配置やスケジュールのドキュメントは書き換えない', async ({ page }) => {
  await openHome(page);
  await page.evaluate(() => { handleTouch('0_0', 'cook'); });
  await flush(page);

  const writes = await page.evaluate(() => window.__writes.map(w => w.col));
  expect(writes).toContain('storeStock');
  expect(writes).not.toContain('storesConfig');
  expect(writes).not.toContain('meta');
});

test('連続でタップしても、保存は1回にまとめられる', async ({ page }) => {
  await openHome(page);
  await page.evaluate(() => { for (let i = 0; i < 20; i++) handleTouch('0_0', 'cook'); });
  await flush(page);

  const saves = await page.evaluate(() => window.__writes.filter(w => w.col === 'storeStock').length);
  expect(saves).toBe(1);
});

test('画面を切り替えるときに、在庫の保存が確定する', async ({ page }) => {
  await openHome(page);
  await page.evaluate(async () => {
    handleTouch('0_0', 'cook');
    await switchViewWithSave('record');
  });

  const doc = await stockDoc(page);
  expect(doc.stock['0_0'].stock).toBe(1);
});

test('保存した在庫数が、次に開いたときに復元される', async ({ page }) => {
  await openHome(page, { savedStock: { '0_0': { itemId: 1, stock: 7, cookTime: null } } });
  await page.evaluate(id => loadStockForStore(id), STORE_ID);
  await page.waitForTimeout(150);

  const stock = await page.evaluate(() => getActiveStoreConfig().fixtures[0].cells[0].stock);
  expect(stock).toBe(7);
});

test('什器の商品を入れ替えていたら、前の商品の在庫数は引き継がない', async ({ page }) => {
  // 保存時は 0_0 がファミチキだったが、その後ハッシュドポテトに入れ替えた状況
  await openHome(page, { savedStock: { '0_0': { itemId: 1, stock: 7, cookTime: null } } });
  await page.evaluate(() => { getActiveStoreConfig().fixtures[0].cells[0].itemId = 2; });
  await page.evaluate(id => loadStockForStore(id), STORE_ID);
  await page.waitForTimeout(150);

  const stock = await page.evaluate(() => getActiveStoreConfig().fixtures[0].cells[0].stock);
  expect(stock).toBe(0);
});

test('読み込みに失敗している間は、在庫も保存しない', async ({ page }) => {
  await openHome(page);
  await page.evaluate(() => { initialDataLoaded = false; handleTouch('0_0', 'cook'); });
  await flush(page);

  const saves = await page.evaluate(() => window.__writes.filter(w => w.col === 'storeStock').length);
  expect(saves).toBe(0);
});

test('保存できたかどうかが画面に表示される', async ({ page }) => {
  await openHome(page);
  await page.evaluate(() => { handleTouch('0_0', 'cook'); });
  await expect(page.locator('#stockSaveState')).toContainText('保存中');

  await flush(page);
  await expect(page.locator('#stockSaveState')).toContainText('保存しました');
});
