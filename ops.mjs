import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type()==='error') errs.push('C:'+m.text()); });
await page.goto('http://127.0.0.1:4173/admin', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.locator('.seg > button', { hasText: '12' }).first().click();
await page.waitForTimeout(14000);
await page.locator('.seg > button', { hasText: '1×' }).first().click();
await page.waitForTimeout(600);
await page.screenshot({ path: process.argv[2] });
for (const [name, file] of [['Dispatch', process.argv[3]], ['Demand', process.argv[4]], ['Configuration', process.argv[5]]]) {
  await page.getByRole('button', { name, exact: false }).first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: file });
}
console.log('errors:', errs.slice(0,5).join(' || ') || 'none');
await browser.close();
