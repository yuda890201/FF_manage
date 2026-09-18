// 「現在の店舗」の切り替え。
//
// 切替先の店舗の設定をクラウドから読み込まないまま保存すると、
// getActiveStoreConfig() が返す初期設定でその店舗の什器配置・スケジュールを
// 丸ごと上書きしてしまう。実際に設定が消える原因になっていた。

const { test, expect } = require('@playwright/test');
const { APP_URL, blockFirebaseSdk, ensureLoggedInView, autoHandleDialogs } = require('./helpers');

const CLOUD = {
  storesConfig: {
    A: {
      fixtures: [{ name: 'A店の什器', category: 'ホッターズ', cols: 1, rows: 1, cells: [{ itemId: 1, stock: 3, cookTime: null }] }],
      schedule: { weekday: { 1: { morning: 5, lunch: 5, evening: 5, minQty: 1 } } },
      timeSlots: { morning: { startHour: 6 }, lunch: { startHour: 11 }, evening: { startHour: 16 } }
    },
    B: {
      fixtures: [{ name: 'B店の什器', category: 'ホッターズ', cols: 1, rows: 1, cells: [{ itemId: 1, stock: 9, cookTime: null }] }],
      schedule: { weekday: { 1: { morning: 8, lunch: 8, evening: 8, minQty: 4 } } },
      timeSlots: { morning: { startHour: 7 }, lunch: { startHour: 11 }, evening: { startHour: 16 } }
    }
  },
  meta: {}
};

/**
 * A店を開いた状態で店舗マスタを表示する。
 * 本番と同じく、起動時に読み込むのは「現在の店舗」の設定だけにしてある。
 */
async function openStoreMasterWithTwoStores(page, { failReads = false } = {}) {
  await blockFirebaseSdk(page);
  await page.goto(APP_URL);
  await page.evaluate(([cloud, fail]) => {
    document.getElementById('login-overlay').style.display = 'none';
    currentUser = { uid: 'test' };
    initialDataLoaded = true;
    window.__cloud = JSON.parse(JSON.stringify(cloud));
    window.__failReads = fail;

    db = {
      collection: (name) => ({
        doc: (id) => ({
          get: async () => {
            if (window.__failReads) throw new Error('通信エラー(テスト)');
            return {
              exists: !!(window.__cloud[name] && window.__cloud[name][id]),
              data: () => window.__cloud[name][id]
            };
          },
          set: async (value) => {
            window.__cloud[name] = window.__cloud[name] || {};
            window.__cloud[name][id] = JSON.parse(JSON.stringify(value));
          },
          delete: async () => { delete window.__cloud[name][id]; }
        }),
        add: async () => {},
        get: async () => ({ docs: [] })
      })
    };

    ITEMS = [
      { id: 0, name: '（空き）', category: '-', price: 0, limitHour: 0 },
      { id: 1, name: 'ファミチキ', category: 'ホッターズ', price: 230, limitHour: 4, imageUrl: '' }
    ];
    STORE_MASTER = [{ id: 'A', name: 'A店', area: '博多', memo: '' }, { id: 'B', name: 'B店', area: '博多', memo: '' }];
    currentStoreId = 'A';
    STORES_CONFIG['A'] = JSON.parse(JSON.stringify(cloud.storesConfig.A));
    loadedStoreConfigIds.add('A');
    migrateRenamedStoreConfigs = async () => {};

    applyCurrentStoreData();
    switchView('storeMaster');
  }, [CLOUD, failReads]);
  await ensureLoggedInView(page);
  await page.waitForTimeout(200);
}

/** 店舗マスタで「現在の店舗」をn番目に切り替えて保存する */
async function switchCurrentStoreTo(page, index) {
  await page.locator('input[name="currentStoreRadio"]').nth(index).check();
  await page.evaluate(() => saveStoreMaster(false));
  await page.waitForTimeout(400);
}

test('店舗を切り替えても、切替先の設定が初期設定で消えない', async ({ page }) => {
  await openStoreMasterWithTwoStores(page);
  await switchCurrentStoreTo(page, 1);

  const b = await page.evaluate(() => JSON.parse(JSON.stringify(window.__cloud.storesConfig.B)));
  expect(b.fixtures[0].name).toBe('B店の什器');
  expect(b.schedule.weekday['1'].minQty).toBe(4);
  expect(b.timeSlots.morning.startHour).toBe(7);
});

test('切り替えたら、切替先の設定が画面に反映される', async ({ page }) => {
  await openStoreMasterWithTwoStores(page);
  await switchCurrentStoreTo(page, 1);

  const shown = await page.evaluate(() => ({
    fixture: getActiveStoreConfig().fixtures[0].name,
    morning: document.getElementById('slot-morning-start').value
  }));
  expect(shown.fixture).toBe('B店の什器');
  expect(shown.morning).toBe('07:00');
});

test('切替先の設定を読み込めなければ、切り替えを中止して元の店舗に戻す', async ({ page }) => {
  await openStoreMasterWithTwoStores(page);
  const dialogs = autoHandleDialogs(page);

  // 電波が悪くて読み込めない状況
  await page.evaluate(() => { window.__failReads = true; });
  await switchCurrentStoreTo(page, 1);

  expect(dialogs.messages.join('\n')).toContain('読み込めませんでした');
  // 切替先の設定は手つかずのまま
  const b = await page.evaluate(() => JSON.parse(JSON.stringify(window.__cloud.storesConfig.B)));
  expect(b.fixtures[0].name).toBe('B店の什器');
  // 表示も元の店舗のまま
  expect(await page.evaluate(() => currentStoreId)).toBe('A');
});

test('設定を読み込めていない店舗では、保存そのものを行わない', async ({ page }) => {
  await openStoreMasterWithTwoStores(page);
  const dialogs = autoHandleDialogs(page);

  // 読み込みを通さずに「現在の店舗」だけがB店になってしまった状態
  await page.evaluate(() => { currentStoreId = 'B'; });
  await page.evaluate(() => saveStoreConfigToCloud(false));
  await page.waitForTimeout(300);

  expect(dialogs.messages.join('\n')).toContain('保存を中止');
  const b = await page.evaluate(() => JSON.parse(JSON.stringify(window.__cloud.storesConfig.B)));
  expect(b.fixtures[0].name).toBe('B店の什器');
});
