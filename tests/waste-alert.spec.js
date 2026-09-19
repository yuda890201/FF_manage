// 期限間近バー。
//
// 同じ商品が什器の複数の場所に並ぶため、商品名だけでは「どの時間に作ったものが
// 廃棄なのか」が分からない。調理時刻を吹き出しで常に出し、タップしなくても読めるようにする。

const { test, expect } = require('@playwright/test');
const { APP_URL, blockFirebaseSdk, ensureLoggedInView, autoHandleDialogs } = require('./helpers');

const HOUR_MS = 3600 * 1000;

/**
 * 期限間近の商品が並んだホーム画面を開く。
 * cells は { itemId, stock, remainMin } の配列。remainMin から調理時刻を逆算する。
 */
async function openHomeWithNearWaste(page, cells) {
  await blockFirebaseSdk(page);
  await page.goto(APP_URL);
  await page.evaluate((cellSpecs) => {
    document.getElementById('login-overlay').style.display = 'none';
    currentUser = { uid: 'test' };
    initialDataLoaded = true;
    db = {
      collection: () => ({
        doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }), set: async () => {}, delete: async () => {} }),
        add: async () => {},
        get: async () => ({ docs: [] })
      })
    };

    const LIMIT_HOUR = 4;
    ITEMS = [
      { id: 0, name: '（空き）', category: '-', price: 0, limitHour: 0 },
      { id: 1, name: 'ファミチキ', category: 'ホッターズ', price: 230, limitHour: LIMIT_HOUR },
      { id: 2, name: 'ハッシュドポテト', category: 'ホッターズ', price: 130, limitHour: LIMIT_HOUR },
      { id: 3, name: 'ファミチキ', category: 'ホッターズ', price: 230, limitHour: LIMIT_HOUR }
    ];
    STORE_MASTER = [{ id: 'fm71661', name: '博多住吉通り店', area: '博多', memo: '' }];
    currentStoreId = 'fm71661';

    const now = Date.now();
    const cells = cellSpecs.map(c => ({
      itemId: c.itemId,
      stock: c.stock,
      // 残りN分 = 調理からlimitHour経つまでの残り
      cookTime: c.cookTime === null ? null : now - (LIMIT_HOUR * 3600 * 1000 - c.remainMin * 60000)
    }));

    const schedule = { weekday: {} };
    ITEMS.forEach(i => { if (i.id !== 0) schedule.weekday[i.id] = { morning: 5, lunch: 5, evening: 5, minQty: 1 }; });

    STORES_CONFIG['fm71661'] = {
      fixtures: [{ name: 'ホッターズ', category: 'ホッターズ', cols: cells.length, rows: 1, cells }],
      schedule,
      timeSlots: { morning: { startHour: 6 }, lunch: { startHour: 11 }, evening: { startHour: 16 } }
    };
    loadedStoreConfigIds.add('fm71661');

    applyCurrentStoreData();
    switchView('home');
    updateWasteAlertBar();
  }, cells);
  await ensureLoggedInView(page);
  await page.waitForTimeout(250);
}

/** 画面に出ている調理時刻を、その商品の実際の調理時刻と突き合わせるための期待値 */
function expectedClock(page, cellIndex) {
  return page.evaluate(idx => {
    const cell = getActiveStoreConfig().fixtures[0].cells[idx];
    const d = new Date(cell.cookTime);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }, cellIndex);
}

test('調理時刻が吹き出しで表示される', async ({ page }) => {
  await openHomeWithNearWaste(page, [{ itemId: 1, stock: 3, remainMin: 12 }]);

  const bubble = page.locator('.waste-cook-bubble');
  await expect(bubble).toHaveCount(1);
  await expect(bubble).toContainText(await expectedClock(page, 0));
  await expect(bubble).toContainText('調理');
});

test('同じ商品でも、作った時間で見分けられる', async ({ page }) => {
  await openHomeWithNearWaste(page, [
    { itemId: 1, stock: 3, remainMin: 25 },
    { itemId: 3, stock: 1, remainMin: 5 }
  ]);

  // どちらも「ファミチキ」だが、調理時刻は別々に出る
  const chips = page.locator('.waste-item-chip');
  await expect(chips).toHaveCount(2);
  const bubbles = await page.locator('.waste-cook-bubble').allInnerTexts();
  expect(bubbles[0]).not.toBe(bubbles[1]);
  expect(bubbles).toContain(`${await expectedClock(page, 0)} 調理`);
  expect(bubbles).toContain(`${await expectedClock(page, 1)} 調理`);
});

test('先に期限が来るものから順に並ぶ', async ({ page }) => {
  await openHomeWithNearWaste(page, [
    { itemId: 1, stock: 3, remainMin: 25 },
    { itemId: 2, stock: 2, remainMin: 5 },
    { itemId: 3, stock: 1, remainMin: -3 }
  ]);

  // 残り分数は秒単位の切り捨てで1分ぶれるため、順番そのもので確かめる
  const texts = await page.locator('.waste-item-chip').allInnerTexts();
  expect(texts[0]).toContain('期限切れ');
  expect(texts[1]).toContain('ハッシュドポテト');
  expect(texts[2]).toContain('ファミチキ');

  const remains = texts.slice(1).map(t => Number(t.match(/残(\d+)分/)[1]));
  expect(remains[0]).toBeLessThan(remains[1]);
});

test('吹き出しはタップしなくても読める（常に表示されている）', async ({ page }) => {
  await openHomeWithNearWaste(page, [{ itemId: 1, stock: 3, remainMin: 12 }]);

  const bubble = page.locator('.waste-cook-bubble');
  await expect(bubble).toBeVisible();
  // 商品名より上に出ていること
  const bubbleBox = await bubble.boundingBox();
  const nameBox = await page.locator('.waste-chip-main').boundingBox();
  expect(bubbleBox.y + bubbleBox.height).toBeLessThanOrEqual(nameBox.y + 1);
});

test('期限間近が無いときは、これまで通りの高さに収まる', async ({ page }) => {
  await openHomeWithNearWaste(page, [{ itemId: 1, stock: 3, remainMin: 120 }]);

  await expect(page.locator('.waste-item-chip')).toHaveCount(0);
  const barHeight = await page.evaluate(() => document.getElementById('wasteAlertBar').getBoundingClientRect().height);
  expect(barHeight).toBeLessThanOrEqual(40);
});

test('廃棄の確認画面にも、調理時刻と期限が出る', async ({ page }) => {
  await openHomeWithNearWaste(page, [{ itemId: 1, stock: 3, remainMin: 12 }]);
  await page.locator('.waste-item-chip').first().click();

  const info = page.locator('#wasteModalInfo');
  await expect(info).toBeVisible();
  await expect(info).toContainText(await expectedClock(page, 0));
  await expect(info).toContainText('期限');
});

test('調理時刻の記録が無くても、表示が壊れない', async ({ page }) => {
  await openHomeWithNearWaste(page, [{ itemId: 1, stock: 3, remainMin: 12 }]);
  // 記録が欠けた状態を作る（古いデータからの移行直後などに起こりうる）
  await page.evaluate(() => {
    getActiveStoreConfig().fixtures[0].cells[0].cookTime = null;
    openWasteModal('0_0');
  });

  await expect(page.locator('#wasteModalInfo')).toContainText('記録がありません');
});
