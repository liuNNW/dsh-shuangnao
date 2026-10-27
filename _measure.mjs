// Deterministic layout check for the preview page: measures the real geometry with
// playwright-core driving Chrome, so alignment is a number, not an opinion.
import { chromium } from 'playwright-core';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const page_url = pathToFileURL(path.resolve('_preview.html')).href;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let failed = 0;

for (const width of [820, 390]) {
  const page = await browser.newPage({ viewport: { width, height: 1100 } });
  await page.goto(page_url);
  const data = await page.evaluate(() => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top * 10) / 10, left: Math.round(r.left * 10) / 10, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
    };
    const triggers = [...document.querySelectorAll('.dbl-trigger')].map(rect);
    const hints = [...document.querySelectorAll('.dbl-brain-hint')].map(rect);
    const efforts = [...document.querySelectorAll('.dbl-effort')].map(rect);
    const grid = getComputedStyle(document.querySelector('.dbl-grid'));
    const desc = document.querySelector('.dbl-desc');
    const card = document.querySelector('.dbl-card');
    return {
      triggers, hints, efforts,
      columns: grid.gridTemplateColumns,
      descWidth: Math.round(desc.getBoundingClientRect().width),
      cardInner: Math.round(card.getBoundingClientRect().width - 34),
      hintTextOverflow: [...document.querySelectorAll('.dbl-brain-hint')].map((el) => el.scrollHeight > el.clientHeight + 1),
    };
  });

  const [a, b] = data.triggers;
  const delta = Math.abs(a.top - b.top);
  const hintDelta = Math.abs(data.hints[0].height - data.hints[1].height);
  const effortDelta = Math.abs(data.efforts[0].top - data.efforts[1].top);
  const columns = data.columns.trim().split(/\s+/).length;

  console.log('--- width ' + width);
  console.log('  columns        : ' + data.columns + '  (' + columns + ' col)');
  console.log('  trigger tops   : ' + a.top + ' / ' + b.top + '  Δ=' + delta);
  console.log('  hint heights   : ' + data.hints[0].height + ' / ' + data.hints[1].height + '  Δ=' + hintDelta);
  console.log('  effort tops    : ' + data.efforts[0].top + ' / ' + data.efforts[1].top + '  Δ=' + effortDelta);
  console.log('  desc vs card   : ' + data.descWidth + ' / ' + data.cardInner);
  console.log('  hint clamped   : ' + JSON.stringify(data.hintTextOverflow));

  const expectCols = width > 640 ? 2 : 1;
  const checks = [];
  if (expectCols === 2) {
    checks.push(['two columns', columns === 2]);
    checks.push(['triggers aligned (Δ<=1px)', delta <= 1]);
    checks.push(['hints equal height', hintDelta <= 1]);
    checks.push(['effort rows aligned (Δ<=1px)', effortDelta <= 1]);
  } else {
    checks.push(['single column', columns === 1]);
  }
  checks.push(['desc spans card', Math.abs(data.descWidth - data.cardInner) <= 2]);
  for (const [name, ok] of checks) {
    if (!ok) failed += 1;
    console.log('  ' + (ok ? 'PASS  ' : 'FAIL  ') + name);
  }
  await page.close();
}

await browser.close();
if (failed > 0) process.exitCode = 1;
