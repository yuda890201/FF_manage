// クラウドへ送れなかった記録の保持と再送信。
//
// 以前は調理/販売の記録の送信に失敗しても console にエラーが出るだけで、
// 画面には何も出ず記録が黙って消えていた。電波の悪い店舗では実績がずれる原因になる。
// 送れなかった記録は端末に残し、画面で知らせ、通信が戻ったら送り直す。

const { test, expect } = require('@playwright/test');
const { APP_URL, blockFirebaseSdk, ensureLoggedInView, autoHandleDialogs } = require('./helpers');

const STORE_ID = 'fm71661';

/**
 * ホーム画面を開く。window.__online を false にすると、
 * クラウドへの書き込みがすべて失敗する（電波が悪い状態）。
 */
async function openHome(page) {
  await blockFirebaseSdk(page);
  await page.goto(APP_URL);
  await page.evaluate((storeId) => {
    localStorage.removeItem('ffmanage_pending_records');
    document.getElementById('login-overlay').style.display = 'none';
    currentUser = { uid: 'test' };
    initialDataLoaded = true;
    window.__online = true;
    window.__sent = { recordLog: 0, dailyArchives: 0, storeStock: 0 };

    db = {
      collection: (name) => ({
        doc: (id) => ({
          get: async () => ({ exists: false, data: () => ({}) }),
          set: async () => {
            if (!window.__online) throw new Error('通信エラー(テスト)');
            window.__sent[name] = (window.__sent[name] || 0) + 1;
          },
          delete: async () => {}
        }),
        add: async () => {
          if (!window.__online) throw new Error('通信エラー(テスト)');
          window.__sent[name] = (window.__sent[name] || 0) + 1;
        },
        get: async () => ({ docs: [] })
      })
    };

    ITEMS = [
      { id: 0, name: '（空き）', category: '-', price: 0, limitHour: 0 },
      { id: 1, name: 'ファミチキ', category: 'ホッターズ', price: 230, limitHour: 4, imageUrl: '' }
    ];
    STORE_MASTER = [{ id: storeId, name: '博多住吉通り店', area: '博多', memo: '' }];
    currentStoreId = storeId;
    STORES_CONFIG[storeId] = {
      fixtures: [{ name: 'ホッターズ', category: 'ホッターズ', cols: 1, rows: 1, cells: [{ itemId: 1, stock: 0, cookTime: null }] }],
      schedule: { weekday: { 1: { morning: 5, lunch: 5, evening: 5, minQty: 1 } } },
      timeSlots: { morning: { startHour: 6 }, lunch: { startHour: 11 }, evening: { startHour: 16 } }
    };
    loadedStoreConfigIds.add(storeId);

    pendingRecords = [];
    pendingArchives = {};
    stockSaveFailed = false;
    applyCurrentStoreData();
    switchView('home');
    updatePendingBar();
  }, STORE_ID);
  await ensureLoggedInView(page);
  await page.waitForTimeout(200);
}

/** 電波が悪い状態で調理を記録する */
async function recordOffline(page, times = 1) {
  await page.evaluate(async (n) => {
    window.__online = false;
    for (let i = 0; i < n; i++) recordArchiveAndSync(1, 'cook', 1);
  }, times);
  await page.waitForTimeout(250);
}

test('送信に失敗した記録が、端末に残る', async ({ page }) => {
  await openHome(page);
  await recordOffline(page, 3);

  const count = await page.evaluate(() => pendingRecords.length);
  expect(count).toBe(3);
});

test('送信できていないことが画面に表示される', async ({ page }) => {
  await openHome(page);
  await recordOffline(page, 2);

  const bar = page.locator('#pendingBar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('2 件');
  await expect(bar).toContainText('送れていません');
});

test('送信待ちの記録は、アプリを開き直しても残る', async ({ page }) => {
  await openHome(page);
  await recordOffline(page, 2);

  // アプリを開き直した状態を再現する
  await page.reload();
  await page.waitForTimeout(400);

  const count = await page.evaluate(() => pendingRecords.length);
  expect(count).toBe(2);
  await expect(page.locator('#pendingBar')).toBeVisible();
});

test('電波が戻ったら、再送信で送信待ちが解消する', async ({ page }) => {
  await openHome(page);
  await recordOffline(page, 3);

  await page.evaluate(async () => {
    window.__online = true;
    await retrySilently();
  });
  await page.waitForTimeout(250);

  expect(await page.evaluate(() => pendingRecords.length)).toBe(0);
  expect(await page.evaluate(() => window.__sent.recordLog)).toBe(3);
  await expect(page.locator('#pendingBar')).toBeHidden();
});

test('再送信しても送れなければ、記録は端末に残したままにする', async ({ page }) => {
  await openHome(page);
  await recordOffline(page, 2);

  // 電波が悪いまま再送信した場合
  await page.evaluate(() => retrySilently());
  await page.waitForTimeout(250);

  expect(await page.evaluate(() => pendingRecords.length)).toBe(2);
  await expect(page.locator('#pendingBar')).toBeVisible();
});

test('「今すぐ再送信」ボタンで送り直せる', async ({ page }) => {
  await openHome(page);
  await recordOffline(page, 2);
  const dialogs = autoHandleDialogs(page);

  await page.evaluate(() => { window.__online = true; });
  await page.locator('.pending-bar-btn').click();
  await page.waitForTimeout(400);

  expect(dialogs.messages.join('\n')).toContain('すべて送信しました');
  expect(await page.evaluate(() => pendingRecords.length)).toBe(0);
});

test('再送信ボタンは、指で押せる大きさになっている', async ({ page }) => {
  await openHome(page);
  await recordOffline(page, 1);

  const box = await page.locator('.pending-bar-btn').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
});

test('在庫の保存に失敗したことも画面に出る', async ({ page }) => {
  await openHome(page);
  await page.evaluate(async () => {
    window.__online = false;
    handleTouch('0_0', 'cook');
    await flushStockSave();
  });
  await page.waitForTimeout(250);

  await expect(page.locator('#pendingBar')).toContainText('在庫数');

  await page.evaluate(async () => { window.__online = true; await retrySilently(); });
  await page.waitForTimeout(250);
  await expect(page.locator('#pendingBar')).toBeHidden();
});

test('日別の集計も、送れなければ残して送り直す', async ({ page }) => {
  await openHome(page);
  await recordOffline(page, 1);

  expect(await page.evaluate(() => Object.keys(pendingArchives).length)).toBe(1);

  await page.evaluate(async () => { window.__online = true; await retrySilently(); });
  await page.waitForTimeout(250);

  expect(await page.evaluate(() => Object.keys(pendingArchives).length)).toBe(0);
  expect(await page.evaluate(() => window.__sent.dailyArchives)).toBeGreaterThan(0);
});

test('送信待ちが無いときは、バーを出さない', async ({ page }) => {
  await openHome(page);
  await page.evaluate(() => { recordArchiveAndSync(1, 'cook', 1); });
  await page.waitForTimeout(250);

  await expect(page.locator('#pendingBar')).toBeHidden();
});

test('在庫を保存できていないとき、ヘッダーに「保存中」と出さない', async ({ page }) => {
  await openHome(page);
  await page.evaluate(async () => {
    window.__online = false;
    handleTouch('0_0', 'cook');
    await flushStockSave();
  });
  await page.waitForTimeout(200);

  const state = page.locator('#stockSaveState');
  await expect(state).toContainText('保存できていません');
  await expect(state).not.toContainText('保存中');
});
