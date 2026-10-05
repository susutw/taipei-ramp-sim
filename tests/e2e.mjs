// 端對端測試：開地圖頁，再讓每個任務自動駕駛跑完，確認會成功抵達終點。
//
//   npm run serve        （另一個終端機）
//   npm run test:e2e
//
// 需要 Chromium：設定 CHROMIUM_PATH，或先執行 npx playwright-core install chromium。
// 在 macOS 上會用 GPU（Metal）；無頭的軟體繪圖（SwiftShader）偶爾會漏畫整個 mesh，截圖不準，但不影響判定。

import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8931';
const args = process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failed++;
};

await page.goto(`${BASE}/index.html`);
await page.waitForSelector('#list li[data-id]');
const count = await page.textContent('#count');
check(parseInt(count, 10) > 100, `地圖列出出入口：${count}`);

const scenarios = JSON.parse(readFileSync('data/scenarios.json', 'utf8'));
for (const s of scenarios) {
  await page.goto(`${BASE}/drive.html?s=${s.id}&auto=1&fast=1`);
  await page.waitForFunction(() => window.__drive, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__drive.status === 'done', null, { timeout: 240000 });
  const result = await page.evaluate(() => window.__drive.overlayText().split('\n')[0]);
  check(result.includes('成功'), `任務 ${s.id}：${result}`);
}

// 塞車模式：精選任務在塞車時也要能切進去、開到終點
{
  const s = scenarios[0];
  await page.goto(`${BASE}/drive.html?s=${s.id}&auto=1&fast=20&traffic=jam`);
  await page.waitForFunction(() => window.__drive, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__drive.status === 'done', null, { timeout: 300000 });
  const result = await page.evaluate(() => window.__drive.overlayText().split('\n')[0]);
  check(result.includes('成功'), `塞車模式 ${s.id}：${result}`);
}

// 自動任務：抽幾個已驗證可試開的出入口，在瀏覽器裡實際跑一次
const drivable = Object.keys(JSON.parse(readFileSync('data/drivable.json', 'utf8')));
const sample = [...new Set([drivable[0], drivable[Math.floor(drivable.length / 2)], drivable.at(-1)])].filter(Boolean);
for (const id of sample) {
  await page.goto(`${BASE}/drive.html?r=${id}&auto=1&fast=1`);
  await page.waitForFunction(() => window.__drive, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__drive.status === 'done', null, { timeout: 240000 });
  const result = await page.evaluate(() => window.__drive.overlayText().split('\n')[0]);
  check(result.includes('成功'), `自動任務 ${id}：${result}`);
}

check(errors.length === 0, `沒有 JavaScript 錯誤${errors.length ? `：${errors.join(' / ')}` : ''}`);
await browser.close();
process.exit(failed ? 1 : 0);
