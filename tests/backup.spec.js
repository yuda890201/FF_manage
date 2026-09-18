// バックアップの世代管理と自動取得。
//
// 以前は店舗ごとに1世代しか持てず、新しく取ると前の内容が消えていた。
// 壊れた状態で上書きしてしまうと戻せる時点が一つも無くなるため、
// 日時ごとに分けて複数世代を残し、1日1回は自動で取るようにしている。

const { test, expect } = require('@playwright/test');
const { APP_URL, blockFirebaseSdk, ensureLoggedInView, autoHandleDialogs } = require('./helpers');

const STORE_ID = 'fm71661';

function storeConfig(fixtureName) {
  return {
    fixtures: [{ name: fixtureName, category: 'ホッターズ', cols: 1, rows: 1, cells: [{ itemId: 1, stock: 2, cookTime: null }] }],
    schedule: { weekday: { 1: { morning: 5, lunch: 5, evening: 5, minQty: 1 } } },
    timeSlots: { morning: { startHour: 6 }, lunch: { startHour: 11 }, evening: { startHour: 16 } }
  };
}

/** クラウドをメモリ上のスタブに差し替えてアプリを開く */
async function openApp(page, cloud) {
  await blockFirebaseSdk(page);
  await page.goto(APP_URL);
  await page.evaluate(([storeId, cloudData, conf]) => {
    document.getElementById('login-overlay').style.display = 'none';
    currentUser = { uid: 'test' };
    initialDataLoaded = true;
    window.__cloud = JSON.parse(JSON.stringify(cloudData));

    db = {
      collection: (name) => ({
        doc: (id) => ({
          get: async () => ({
            exists: !!(window.__cloud[name] && window.__cloud[name][id]),
            data: () => window.__cloud[name][id]
          }),
          set: async (value) => {
            window.__cloud[name] = window.__cloud[name] || {};
            window.__cloud[name][id] = JSON.parse(JSON.stringify(value));
          },
          delete: async () => { delete window.__cloud[name][id]; }
        }),
        add: async () => {},
        get: async () => ({
          docs: Object.keys(window.__cloud[name] || {}).map(id => ({ id, data: () => window.__cloud[name][id] }))
        })
      })
    };

    ITEMS = [
      { id: 0, name: '（空き）', category: '-', price: 0, limitHour: 0 },
      { id: 1, name: 'ファミチキ', category: 'ホッターズ', price: 230, limitHour: 4, imageUrl: '' }
    ];
    STORE_MASTER = [{ id: storeId, name: '博多住吉通り店', area: '博多', memo: '' }];
    currentStoreId = storeId;
    STORES_CONFIG[storeId] = JSON.parse(JSON.stringify(conf));
    loadedStoreConfigIds.add(storeId);

    applyCurrentStoreData();
    switchView('home');
  }, [STORE_ID, cloud, storeConfig('現在の什器')]);
  await ensureLoggedInView(page);
  await page.waitForTimeout(200);
}

const backupIds = page => page.evaluate(() => Object.keys(window.__cloud.manualBackups || {}).sort());

test('バックアップを取っても、前の世代が消えない', async ({ page }) => {
  await openApp(page, { manualBackups: {}, storesConfig: {} });
  autoHandleDialogs(page);

  // 日時が同じだと同じドキュメントになるため、時刻をずらして2回取る
  await page.evaluate(async () => {
    await createBackupForStore(getCurrentStore(), Date.parse('2026-09-17T23:00:00'), '2026-09-17_2300');
    await createBackupForStore(getCurrentStore(), Date.parse('2026-09-18T11:00:00'), '2026-09-18_1100');
  });

  expect(await backupIds(page)).toEqual([`${STORE_ID}__2026-09-17_2300`, `${STORE_ID}__2026-09-18_1100`]);
});

test('世代は7件までで、古いものから消える', async ({ page }) => {
  await openApp(page, { manualBackups: {}, storesConfig: {} });

  await page.evaluate(async () => {
    for (let d = 1; d <= 9; d++) {
      const day = String(d).padStart(2, '0');
      await createBackupForStore(getCurrentStore(), Date.parse(`2026-09-${day}T10:00:00`), `2026-09-${day}_1000`);
    }
  });

  const ids = await backupIds(page);
  expect(ids).toHaveLength(7);
  // 残っているのは新しい7件（9/3〜9/9）
  expect(ids).toContain(`${STORE_ID}__2026-09-09_1000`);
  expect(ids).not.toContain(`${STORE_ID}__2026-09-01_1000`);
  expect(ids).not.toContain(`${STORE_ID}__2026-09-02_1000`);
});

test('世代管理より前の1世代だけのバックアップは、世代数に関係なく残す', async ({ page }) => {
  await openApp(page, {
    manualBackups: { [STORE_ID]: { items: [], stores: [], storeConfig: storeConfig('旧形式の什器'), backedUpAt: Date.parse('2026-09-01T10:00:00') } },
    storesConfig: {}
  });

  await page.evaluate(async () => {
    for (let d = 10; d <= 19; d++) {
      await createBackupForStore(getCurrentStore(), Date.parse(`2026-09-${d}T10:00:00`), `2026-09-${d}_1000`);
    }
  });

  const ids = await backupIds(page);
  expect(ids).toContain(STORE_ID);
  expect(ids.filter(id => id.includes('__'))).toHaveLength(7);
});

test('他店舗のバックアップは、この店舗の世代数に数えない', async ({ page }) => {
  await openApp(page, { manualBackups: {}, storesConfig: {} });

  await page.evaluate(async () => {
    // 別店舗のバックアップを先に置いておく
    for (let d = 1; d <= 8; d++) {
      const day = String(d).padStart(2, '0');
      await db.collection('manualBackups').doc(`fm99999__2026-09-${day}_1000`).set({ backedUpAt: Date.parse(`2026-09-${day}T10:00:00`) });
    }
    await createBackupForStore(getCurrentStore(), Date.parse('2026-09-18T10:00:00'), '2026-09-18_1000');
  });

  const ids = await backupIds(page);
  expect(ids.filter(id => id.startsWith('fm99999'))).toHaveLength(8);
  expect(ids.filter(id => id.startsWith(`${STORE_ID}__`))).toHaveLength(1);
});

test('その日のバックアップが無ければ、起動時に自動で取る', async ({ page }) => {
  await openApp(page, { manualBackups: {}, storesConfig: {} });
  await page.evaluate(() => autoBackupIfNeeded());
  await page.waitForTimeout(200);

  const ids = await backupIds(page);
  expect(ids).toHaveLength(1);
  const saved = await page.evaluate(id => window.__cloud.manualBackups[id], ids[0]);
  expect(saved.storeConfig.fixtures[0].name).toBe('現在の什器');
});

test('その日のバックアップが既にあれば、重ねて取らない', async ({ page }) => {
  await openApp(page, { manualBackups: {}, storesConfig: {} });
  await page.evaluate(() => autoBackupIfNeeded());
  await page.waitForTimeout(200);
  const first = await backupIds(page);

  await page.evaluate(() => autoBackupIfNeeded());
  await page.waitForTimeout(200);
  expect(await backupIds(page)).toEqual(first);
});

test('復元する時点を一覧から選べる', async ({ page }) => {
  await openApp(page, {
    manualBackups: {
      [`${STORE_ID}__2026-09-17_2300`]: { items: [], stores: [], storeConfig: storeConfig('昨夜の什器'), backedUpAt: Date.parse('2026-09-17T23:00:00') },
      [`${STORE_ID}__2026-09-18_1100`]: { items: [], stores: [], storeConfig: storeConfig('今朝の什器'), backedUpAt: Date.parse('2026-09-18T11:00:00') }
    },
    storesConfig: {}
  });

  await page.evaluate(() => handleManualRestore());
  await expect(page.locator('#backupModal')).toBeVisible();

  const entries = page.locator('.backup-entry');
  await expect(entries).toHaveCount(2);
  // 新しい順に並んでいること
  await expect(entries.first()).toContainText('11:00');
  await expect(entries.last()).toContainText('23:00');

  // 指で押せる大きさであること
  const box = await entries.first().boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
});

test('選んだ時点のデータに復元され、クラウドにも保存される', async ({ page }) => {
  await openApp(page, {
    manualBackups: {
      [`${STORE_ID}__2026-09-17_2300`]: { items: [], stores: [], storeConfig: storeConfig('昨夜の什器'), backedUpAt: Date.parse('2026-09-17T23:00:00') },
      [`${STORE_ID}__2026-09-18_1100`]: { items: [], stores: [], storeConfig: storeConfig('今朝の什器'), backedUpAt: Date.parse('2026-09-18T11:00:00') }
    },
    storesConfig: {}
  });
  autoHandleDialogs(page);

  await page.evaluate(() => handleManualRestore());
  await page.locator('.backup-entry').last().click();
  await page.waitForTimeout(600);

  expect(await page.evaluate(() => getActiveStoreConfig().fixtures[0].name)).toBe('昨夜の什器');
  const cloudConf = await page.evaluate(id => window.__cloud.storesConfig[id], STORE_ID);
  expect(cloudConf.fixtures[0].name).toBe('昨夜の什器');
});

test('復元をキャンセルしたら、何も変えない', async ({ page }) => {
  await openApp(page, {
    manualBackups: {
      [`${STORE_ID}__2026-09-17_2300`]: { items: [], stores: [], storeConfig: storeConfig('昨夜の什器'), backedUpAt: Date.parse('2026-09-17T23:00:00') }
    },
    storesConfig: {}
  });
  autoHandleDialogs(page, { accept: false });

  await page.evaluate(() => handleManualRestore());
  await page.locator('.backup-entry').first().click();
  await page.waitForTimeout(400);

  expect(await page.evaluate(() => getActiveStoreConfig().fixtures[0].name)).toBe('現在の什器');
  expect(await page.evaluate(id => window.__cloud.storesConfig[id], STORE_ID)).toBeUndefined();
});

test('バックアップが1件も無ければ、その旨を知らせる', async ({ page }) => {
  await openApp(page, { manualBackups: {}, storesConfig: {} });
  const dialogs = autoHandleDialogs(page);

  await page.evaluate(() => handleManualRestore());
  await page.waitForTimeout(300);

  expect(dialogs.messages.join('\n')).toContain('見つかりませんでした');
  await expect(page.locator('#backupModal')).toBeHidden();
});
