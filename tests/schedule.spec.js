// スケジュール目標の曜日切り替え・曜日間コピー・一括貼り付け。

const { test, expect } = require('@playwright/test');
const { openAppMinimal, readSchedule, autoHandleDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await openAppMinimal(page, 'scheduleMaster');
});

/** 平日の入力欄に値を入れる */
async function fillWeekday(page) {
  await page.selectOption('#scheduleDaySelect', 'weekday');
  await page.waitForTimeout(120);
  await page.fill('#sm-m-1', '12');
  await page.fill('#sm-l-1', '13');
  await page.fill('#sm-e-1', '14');
  await page.fill('#sm-min-1', '3');
  await page.fill('#sm-m-2', '20');
  await page.waitForTimeout(80);
}

test('曜日を切り替えて戻っても、入力した値が消えない', async ({ page }) => {
  await fillWeekday(page);
  await page.selectOption('#scheduleDaySelect', 'saturday');
  await page.waitForTimeout(150);
  await page.selectOption('#scheduleDaySelect', 'weekday');
  await page.waitForTimeout(150);

  await expect(page.locator('#sm-m-1')).toHaveValue('12');
  await expect(page.locator('#sm-min-1')).toHaveValue('3');
  await expect(page.locator('#sm-m-2')).toHaveValue('20');
});

test('曜日を切り替えても、切り替え先の設定が入力値で汚染されない', async ({ page }) => {
  // onchange は値が変わった後に発火するため、書き込み先を間違えると
  // 直前の入力が切り替え先の曜日を上書きしてしまう
  await fillWeekday(page);
  await page.selectOption('#scheduleDaySelect', 'saturday');
  await page.waitForTimeout(150);

  const saturday = await readSchedule(page, 'saturday');
  expect(saturday['1'].morning).toBe(9);
  expect(saturday['1'].minQty).toBe(9);
});

test('平日の内容を土曜と日祝へまとめてコピーできる', async ({ page }) => {
  autoHandleDialogs(page);
  await fillWeekday(page);
  await page.selectOption('#scheduleCopyTarget', 'weekend');
  await page.locator('button', { hasText: '表示中の曜日をコピー' }).click();
  await page.waitForTimeout(300);

  for (const day of ['saturday', 'sunday']) {
    const copied = await readSchedule(page, day);
    expect(copied['1'].morning, day).toBe(12);
    expect(copied['1'].minQty, day).toBe(3);
    expect(copied['2'].morning, day).toBe(20);
  }
  // コピー元は変わらない
  await expect(page.locator('#sm-m-1')).toHaveValue('12');
});

test('コピーは値の複製で、あとから片方を変えても他方に影響しない', async ({ page }) => {
  autoHandleDialogs(page);
  await fillWeekday(page);
  await page.selectOption('#scheduleCopyTarget', 'weekend');
  await page.locator('button', { hasText: '表示中の曜日をコピー' }).click();
  await page.waitForTimeout(300);

  await page.evaluate(() => { STORES_CONFIG['fm71661'].schedule.saturday['1'].morning = 99; });
  const weekday = await readSchedule(page, 'weekday');
  expect(weekday['1'].morning).toBe(12);
});

test('コピー元と同じ曜日を指定したら実行せずに知らせる', async ({ page }) => {
  const dialogs = autoHandleDialogs(page);
  await page.selectOption('#scheduleCopyTarget', 'weekday');
  await page.locator('button', { hasText: '表示中の曜日をコピー' }).click();
  await page.waitForTimeout(250);
  expect(dialogs.messages.join('\n')).toContain('同じ曜日');
});

test('コピーの確認をキャンセルすると何も変わらない', async ({ page }) => {
  const dialogs = autoHandleDialogs(page, { accept: false });
  await page.evaluate(() => {
    STORES_CONFIG['fm71661'].schedule.sunday = { 1: { morning: 1, lunch: 1, evening: 1, minQty: 1 } };
  });
  await fillWeekday(page);
  dialogs.setAccept(false);
  await page.selectOption('#scheduleCopyTarget', 'sunday');
  await page.locator('button', { hasText: '表示中の曜日をコピー' }).click();
  await page.waitForTimeout(250);

  const sunday = await readSchedule(page, 'sunday');
  expect(sunday['1'].morning).toBe(1);
});

test('保存すると、表示中の曜日の入力値が反映される', async ({ page }) => {
  autoHandleDialogs(page);
  await fillWeekday(page);
  await page.evaluate(() => { window.__cloudSaves = 0; });
  await page.fill('#sm-m-1', '55');
  await page.evaluate(() => saveScheduleMaster());
  await page.waitForTimeout(250);

  const weekday = await readSchedule(page, 'weekday');
  expect(weekday['1'].morning).toBe(55);
  expect(await page.evaluate(() => window.__cloudSaves)).toBe(1);
});

test.describe('一括貼り付け', () => {
  async function paste(page, text) {
    await page.evaluate(() => {
      document.getElementById('scheduleBulkPanel').style.display = 'block';
    });
    await page.fill('#scheduleBulkInput', text);
    await page.locator('button', { hasText: 'この内容で反映する' }).click();
    await page.waitForTimeout(350);
  }

  test('3曜日分をまとめて取り込める', async ({ page }) => {
    autoHandleDialogs(page);
    await paste(page, [
      '曜日,商品名,朝,昼,夕',
      '平日,ファミチキ,3,5,5',
      '平日,肉まん,1,2,1',
      '土曜,ファミチキ,2,2,4',
      '日祝,ファミチキ,1,1,3'
    ].join('\n'));

    const weekday = await readSchedule(page, 'weekday');
    expect(weekday['1'].morning).toBe(3);
    expect(weekday['1'].evening).toBe(5);
    expect(weekday['2'].lunch).toBe(2);
    expect((await readSchedule(page, 'saturday'))['1'].evening).toBe(4);
    expect((await readSchedule(page, 'sunday'))['1'].morning).toBe(1);
  });

  test('最低個数を省略した行は、現在の設定を引き継ぐ', async ({ page }) => {
    autoHandleDialogs(page);
    await paste(page, '平日,ファミチキ,3,5,5');
    expect((await readSchedule(page, 'weekday'))['1'].minQty).toBe(4);

    await paste(page, '平日,ファミチキ,3,5,5,7');
    expect((await readSchedule(page, 'weekday'))['1'].minQty).toBe(7);
  });

  test('商品マスタに無い商品名は取り込まず、知らせる', async ({ page }) => {
    const dialogs = autoHandleDialogs(page);
    await paste(page, '平日,存在しない商品,1,1,1\n平日,肉まん,9,9,9');
    expect(dialogs.messages.join('\n')).toContain('存在しない商品');
    // 登録済みの行はきちんと反映される
    expect((await readSchedule(page, 'weekday'))['2'].morning).toBe(9);
  });

  test('タブ区切りでも読める', async ({ page }) => {
    autoHandleDialogs(page);
    await paste(page, '土曜\t肉まん\t4\t4\t4');
    expect((await readSchedule(page, 'saturday'))['2'].morning).toBe(4);
  });

  test('読める行が無ければ何も変更しない', async ({ page }) => {
    const dialogs = autoHandleDialogs(page);
    const before = await readSchedule(page, 'weekday');
    await paste(page, 'でたらめな文章');
    expect(dialogs.messages.join('\n')).toContain('取り込める行がありませんでした');
    expect(await readSchedule(page, 'weekday')).toEqual(before);
  });
});

// 個数の入力欄は、タブレットを指で操作しながら打ち替える。
// 欄が小さいと隣の欄を触ってしまい、気づかないまま別の商品の目標を書き換えてしまう。
test.describe('個数入力欄の大きさ', () => {
  // 指で確実に押せる大きさの目安（Apple/Googleのガイドラインがいずれも44px以上）
  const MIN_TAP_PX = 44;

  test('4つの個数欄すべてが、指で押せる大きさになっている', async ({ page }) => {
    for (const id of ['#sm-m-1', '#sm-l-1', '#sm-e-1', '#sm-min-1']) {
      const box = await page.locator(id).boundingBox();
      expect(box.height, `${id} の高さ`).toBeGreaterThanOrEqual(MIN_TAP_PX);
      expect(box.width, `${id} の幅`).toBeGreaterThanOrEqual(MIN_TAP_PX);
    }
  });

  test('隣り合う個数欄が重ならず、間隔が空いている', async ({ page }) => {
    const left = await page.locator('#sm-m-1').boundingBox();
    const right = await page.locator('#sm-l-1').boundingBox();
    expect(right.x).toBeGreaterThan(left.x + left.width);
  });

  test('上下の行の個数欄が、指1本分離れている', async ({ page }) => {
    const upper = await page.locator('#sm-m-1').boundingBox();
    const lower = await page.locator('#sm-m-2').boundingBox();
    expect(lower.y).toBeGreaterThan(upper.y + upper.height);
  });

  test('欄をタッチすると今の値が選択され、そのまま打ち替えられる', async ({ page }) => {
    await page.fill('#sm-m-1', '12');
    await page.locator('#sm-l-1').click();
    await page.locator('#sm-m-1').click();
    // 選択された状態なら、続けて入力した数字が古い値を置き換える
    await page.keyboard.type('7');
    expect(await page.inputValue('#sm-m-1')).toBe('7');
  });

  test('欄を大きくしても、横スクロールしないと入力できない状態にはならない', async ({ page }) => {
    const overflow = await page.evaluate(() => {
      const scroll = document.querySelector('#scheduleMasterView .table-scroll');
      return scroll.scrollWidth - scroll.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
