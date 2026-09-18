// テスト用の共通セットアップ。
//
// このアプリはFirebase認証とFirestoreが前提だが、テストでは本番データに触れたくないため
// ログイン画面を閉じて、アプリ内のグローバル変数に直接テストデータを入れる。
// クラウド保存もスタブに差し替え、通信なしで画面の挙動だけを検証する。

const path = require('path');

const APP_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');

/**
 * Firebase SDK の読み込みを遮断する。
 *
 * 読み込まれると onAuthStateChanged が「未ログイン」で発火し、ログイン画面が
 * 再表示されて currentUser も消えるため、テスト用に入れた状態が壊れてしまう。
 * SDK が無ければ auth は null のままで、この処理自体が登録されない。
 * 外部通信にも依存しなくなるので、実行環境によって結果が変わらない。
 */
async function blockFirebaseSdk(page) {
  await page.route('**/firebasejs/**', route => route.abort());
}

/** テスト用の状態を入れたあと、ログイン画面が再表示されていないことを確かめる */
async function ensureLoggedInView(page) {
  await page.waitForSelector('#login-overlay', { state: 'hidden' });
}

// 清川二丁目店の実際の什器構成に合わせたテストデータ
// 中華まん 1列×6段 / ホッターズ 6列×3段 / 常温総菜 2列×4段
const FIXTURE_LAYOUT = {
  man: ['黒豚まん', 'カレー黒豚まん', '肉まん', 'あんバター', 'ピザまん', 'ファミチキ焼肉のたれ'],
  hot: [
    '(空き)', 'ファミチキ焼肉のたれ', '(空き)', '(空き)', 'ファミチキ', '(空き)',
    'えびかつ', 'チーズチキン', 'クリスピー', 'ファミチキレッド', '(空き)', 'スパイシー',
    'ころじゃが', 'ハッシュドポテト', 'ファミコロ', '鶏つくね', 'アメリカンドッグ', 'ジャンボフランク'
  ],
  cold: ['ももタレ', 'かわタレ', 'もも塩', 'かわ塩', 'ファミから塩カップ', 'サラダちくわ磯辺', 'ファミから醤油', '味ぽん']
};

/**
 * 什器が並んだホーム画面を開く。
 * 商品名の文字サイズやタイルのレイアウトを検証する用途。
 */
async function openHomeWithFixtures(page) {
  await blockFirebaseSdk(page);
  await page.goto(APP_URL);
  await page.evaluate((layout) => {
    document.getElementById('login-overlay').style.display = 'none';
    currentUser = { uid: 'test' };
    // クラウドからの読み込みに成功した状態を再現する。false のままだと保存処理が
    // 中止されてしまい、保存経路を通らないテストになってしまう
    initialDataLoaded = true;

    ITEMS = [{ id: 0, name: '（空き）', category: '-', price: 0, limitHour: 0 }];
    let nextId = 1;
    const register = (names, category) => names.map(name => {
      if (name === '(空き)') return 0;
      const id = nextId++;
      ITEMS.push({ id, name, category, price: 200, limitHour: 4, imageUrl: '' });
      return id;
    });
    const manIds = register(layout.man, '中華まん');
    const hotIds = register(layout.hot, 'ホッターズ');
    const coldIds = register(layout.cold, '常温総菜');
    const toCells = ids => ids.map(id => ({ itemId: id, stock: 0, cookTime: null }));

    STORE_MASTER = [{ id: 'fm71789', name: '福岡清川二丁目店', area: '福岡中央', memo: '' }];
    currentStoreId = 'fm71789';

    const schedule = { weekday: {}, saturday: {}, sunday: {} };
    ITEMS.forEach(i => {
      if (i.id !== 0) schedule.weekday[i.id] = { morning: 3, lunch: 5, evening: 6, minQty: 1 };
    });

    STORES_CONFIG['fm71789'] = {
      fixtures: [
        { name: '中華まん', category: '中華まん', cols: 1, rows: 6, cells: toCells(manIds) },
        { name: 'ホッターズ', category: 'ホッターズ', cols: 6, rows: 3, cells: toCells(hotIds) },
        { name: '常温総菜', category: '常温総菜', cols: 2, rows: 4, cells: toCells(coldIds) }
      ],
      schedule,
      timeSlots: { morning: { startHour: 6 }, lunch: { startHour: 11 }, evening: { startHour: 16 } }
    };

    window.__cloudSaves = 0;
    saveStoreConfigToCloud = async () => { window.__cloudSaves++; };
    saveSnapshotToCloud = async () => {};

    applyCurrentStoreData();
    switchView('home');
  }, FIXTURE_LAYOUT);

  await ensureLoggedInView(page);
  // autoFitTitles が走り終わるのを待つ(描画後にsetTimeoutで実行される)
  await page.waitForTimeout(400);
}

/**
 * 商品2件だけの最小構成でアプリを開く。
 * スケジュール目標や画面遷移など、什器レイアウトに依存しない検証用。
 */
async function openAppMinimal(page, viewName = 'home') {
  await blockFirebaseSdk(page);
  await page.goto(APP_URL);
  await page.evaluate((view) => {
    document.getElementById('login-overlay').style.display = 'none';
    currentUser = { uid: 'test' };
    // クラウドからの読み込みに成功した状態を再現する。false のままだと保存処理が
    // 中止されてしまい、保存経路を通らないテストになってしまう
    initialDataLoaded = true;
    ITEMS = [
      { id: 0, name: '（空き）', category: '-', price: 0, limitHour: 0 },
      { id: 1, name: 'ファミチキ', category: 'ホッターズ', price: 230, limitHour: 4, imageUrl: '' },
      { id: 2, name: '肉まん', category: '中華まん', price: 150, limitHour: 6, imageUrl: '' },
      { id: 3, name: 'あんバター', category: '中華まん', price: 160, limitHour: 6, imageUrl: '' }
    ];
    STORE_MASTER = [{ id: 'fm71661', name: '博多住吉通り店', area: '博多', memo: '' }];
    currentStoreId = 'fm71661';
    STORES_CONFIG['fm71661'] = {
      fixtures: [],
      schedule: {
        weekday: {
          1: { morning: 0, lunch: 0, evening: 0, minQty: 4 },
          2: { morning: 0, lunch: 0, evening: 0, minQty: 0 }
        },
        saturday: {
          1: { morning: 9, lunch: 9, evening: 9, minQty: 9 },
          2: { morning: 9, lunch: 9, evening: 9, minQty: 9 }
        },
        sunday: {
          1: { morning: 7, lunch: 7, evening: 7, minQty: 7 },
          2: { morning: 7, lunch: 7, evening: 7, minQty: 7 }
        }
      },
      timeSlots: { morning: { startHour: 6 }, lunch: { startHour: 11 }, evening: { startHour: 16 } }
    };

    window.__cloudSaves = 0;
    saveStoreConfigToCloud = async () => { window.__cloudSaves++; };
    saveSnapshotToCloud = async () => {};
    migrateRenamedStoreConfigs = async () => {};

    applyCurrentStoreData();
    switchView(view);
  }, viewName);
  await ensureLoggedInView(page);
  await page.waitForTimeout(250);
}

/** 現在のスケジュール設定を取り出す */
function readSchedule(page, dayType) {
  return page.evaluate(
    d => JSON.parse(JSON.stringify(STORES_CONFIG['fm71661'].schedule[d] || {})),
    dayType
  );
}

/** confirm/alert を自動応答させる。返り値のログで表示内容を検証できる */
function autoHandleDialogs(page, { accept = true } = {}) {
  const messages = [];
  const state = { accept };
  page.on('dialog', async dialog => {
    messages.push(dialog.message());
    if (dialog.type() === 'confirm' && !state.accept) await dialog.dismiss();
    else await dialog.accept();
  });
  return {
    messages,
    setAccept(value) { state.accept = value; },
    clear() { messages.length = 0; }
  };
}

module.exports = {
  APP_URL,
  blockFirebaseSdk,
  ensureLoggedInView,
  openHomeWithFixtures,
  openAppMinimal,
  readSchedule,
  autoHandleDialogs
};
