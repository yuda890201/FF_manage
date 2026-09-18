// ホーム画面の什器タイル。
// 「商品名が見切れて読めない」「文字が小さすぎる」という12.3インチタブレットからの
// 不具合報告への対応が、今後も壊れないことを守るためのテスト。

const { test, expect } = require('@playwright/test');
const { openHomeWithFixtures } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await openHomeWithFixtures(page);
});

/** タイルごとの商品名の状態をまとめて取り出す */
function collectTitles(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.cell-capsule')].map(capsule => {
      const title = capsule.querySelector('.item-title-large');
      const capsuleRect = capsule.getBoundingClientRect();
      const titleRect = title.getBoundingClientRect();
      return {
        name: title.innerText,
        fontSize: parseFloat(getComputedStyle(title).fontSize),
        height: Math.round(titleRect.height),
        clippedTop: titleRect.top < capsuleRect.top - 0.5,
        clippedBottom: titleRect.bottom > capsuleRect.bottom + 0.5,
        transform: getComputedStyle(title).transform
      };
    }).filter(t => t.name && t.name !== '（空き）')
  );
}

test('商品名がタイルの外にはみ出して切れない', async ({ page }) => {
  const titles = await collectTitles(page);
  expect(titles.length).toBeGreaterThan(10);
  expect(titles.filter(t => t.clippedTop).map(t => t.name)).toEqual([]);
  expect(titles.filter(t => t.clippedBottom).map(t => t.name)).toEqual([]);
});

test('商品名を横方向に圧縮しない', async ({ page }) => {
  // 以前は transform: scale() で横に潰しており、狭いタイルで判読不能になっていた
  const titles = await collectTitles(page);
  expect(titles.filter(t => t.transform !== 'none').map(t => t.name)).toEqual([]);
});

test('商品名の文字サイズが下限を下回らない', async ({ page }) => {
  const titles = await collectTitles(page);
  expect(titles.filter(t => t.fontSize < 13).map(t => `${t.name}:${t.fontSize}px`)).toEqual([]);
  expect(titles.filter(t => t.height < 12).map(t => t.name)).toEqual([]);
});

test('同じ商品名でも、高さに余裕がある什器では大きい文字になる', async ({ page }) => {
  // 什器の幅はどれもほぼ同じで、違うのは段数による高さ。
  // 低い什器(中華まん6段)に引きずられて高い什器(ホッターズ3段)まで小さくならないこと。
  const sizes = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('.fixture-section-container').forEach(section => {
      const title = [...section.querySelectorAll('.item-title-large')]
        .find(el => el.innerText.includes('ファミチキ焼'));
      if (title) out[section.getAttribute('data-cat')] = parseFloat(getComputedStyle(title).fontSize);
    });
    return out;
  });
  expect(sizes['ホッターズ']).toBeGreaterThan(sizes['中華まん']);
  expect(sizes['中華まん']).toBeGreaterThanOrEqual(13);
});

test('個数バッジが調理ボタンと販売ボタンの境目にまたがる', async ({ page }) => {
  const badge = await page.evaluate(() => {
    const capsule = [...document.querySelectorAll('.cell-capsule')]
      .find(c => c.querySelector('.item-title-large').innerText.includes('ファミチキ焼'));
    const box = capsule.querySelector('.stock-box').getBoundingClientRect();
    const cook = capsule.querySelector('.btn-top-cook').getBoundingClientRect();
    const sell = capsule.querySelector('.btn-bottom-sell').getBoundingClientRect();
    const capsuleRect = capsule.getBoundingClientRect();
    return {
      straddles: box.top < cook.bottom && box.bottom > sell.top,
      insideCapsule: box.top >= capsuleRect.top && box.bottom <= capsuleRect.bottom,
      valueFontSize: parseFloat(getComputedStyle(capsule.querySelector('.stock-val')).fontSize)
    };
  });
  expect(badge.straddles).toBe(true);
  expect(badge.insideCapsule).toBe(true);
  expect(badge.valueFontSize).toBeGreaterThanOrEqual(24);
});

test('個数バッジが商品名や販売ラベルに重ならない', async ({ page }) => {
  const overlaps = await page.evaluate(() => {
    const hit = (a, b) =>
      a.top < b.bottom - 1 && a.bottom > b.top + 1 && a.left < b.right - 1 && a.right > b.left + 1;
    const bad = [];
    document.querySelectorAll('.cell-capsule').forEach(capsule => {
      const box = capsule.querySelector('.stock-box').getBoundingClientRect();
      const name = capsule.querySelector('.item-title-large');
      const sellLabel = capsule.querySelector('.action-bottom-label');
      if (hit(box, name.getBoundingClientRect())) bad.push(`${name.innerText}:商品名`);
      if (sellLabel && hit(box, sellLabel.getBoundingClientRect())) bad.push(`${name.innerText}:販売ラベル`);
    });
    return bad;
  });
  expect(overlaps).toEqual([]);
});

test('タイル内の要素が枠からはみ出さない', async ({ page }) => {
  const overflowed = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('.cell-capsule').forEach(capsule => {
      const capsuleRect = capsule.getBoundingClientRect();
      capsule.querySelectorAll('.item-title-large, .action-top-label, .action-bottom-label, .stock-box')
        .forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.top < capsuleRect.top - 0.5 || rect.bottom > capsuleRect.bottom + 0.5) {
            bad.push(`${capsule.querySelector('.item-title-large').innerText}:${el.className}`);
          }
        });
    });
    return bad;
  });
  expect(overflowed).toEqual([]);
});

test('個数バッジがタップを遮らず、調理・販売ボタンが反応する', async ({ page }) => {
  // バッジは境目に浮いているため、pointer-events を通さないと操作を妨げてしまう
  const pointerEvents = await page.evaluate(
    () => getComputedStyle(document.querySelector('.stock-box')).pointerEvents
  );
  expect(pointerEvents).toBe('none');

  const capsule = page.locator('.cell-capsule').filter({ hasText: 'チーズチキン' }).first();
  const stockOf = () => page.evaluate(() => {
    const cell = getActiveStoreConfig().fixtures[1].cells
      .find((c, i) => ITEMS.find(x => x.id === c.itemId)?.name === 'チーズチキン');
    return cell.stock;
  });

  const before = await stockOf();
  await capsule.locator('.btn-top-cook').click();
  await page.waitForTimeout(150);
  expect(await stockOf()).toBe(before + 1);

  await capsule.locator('.btn-bottom-sell').click();
  await page.waitForTimeout(150);
  expect(await stockOf()).toBe(before);
});
