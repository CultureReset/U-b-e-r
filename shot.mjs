import { chromium } from 'playwright';
const url = process.argv[2], out = process.argv[3], clear = process.argv[4] === 'clear';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
await page.goto(url, { waitUntil: 'domcontentloaded' });
if (clear) { await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle' }); }
await page.waitForTimeout(3500);
await page.screenshot({ path: out });
console.log('ERRORS:', errors.length ? errors.slice(0,6).join(' || ') : 'none');
console.log('TEXT:', (await page.locator('body').innerText()).slice(0, 300).replace(/\n+/g,' | '));
await browser.close();
