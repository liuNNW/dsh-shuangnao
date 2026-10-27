// Read-only probe of the running DSH web UI: does the page load, and does the
// preset roster mention our preset? No clicks, no writes.
import { chromium } from 'playwright-core';

const URL = 'http://127.0.0.1:19387';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const logs = [];
page.on('console', (msg) => logs.push(msg.type() + ': ' + msg.text().slice(0, 200)));
page.on('pageerror', (error) => logs.push('pageerror: ' + String(error).slice(0, 300)));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
} catch (error) {
  console.log('goto failed:', String(error).slice(0, 200));
}
await page.waitForTimeout(4000);

const info = await page.evaluate(() => {
  const text = (document.body && document.body.innerText) ? document.body.innerText : '';
  return {
    title: document.title,
    hasBoot: typeof window.__DSH_BOOT__ !== 'undefined',
    chars: text.length,
    head: text.slice(0, 800),
    mentions: {
      presetWord: text.includes('预设') || text.includes('模式'),
      ours: text.includes('双脑'),
      standard: text.includes('标准'),
    },
  };
});
console.log(JSON.stringify(info, null, 2));
console.log('--- console tail');
console.log(logs.slice(-12).join('\n'));
await browser.close();
