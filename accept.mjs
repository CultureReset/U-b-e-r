import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:4173/driver', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.locator('.seg > button', { hasText: '12' }).first().click();
for (let i = 0; i < 40; i++) {
  const has = await page.evaluate(() => {
    const s = window.urus.getState().state;
    return Object.values(s.offers).some(o => o.driverId === s.session.driverId && o.status === 'pending');
  });
  if (has) break;
  await page.waitForTimeout(400);
}
await page.locator('.seg > button', { hasText: '4×' }).first().click();
await page.getByRole('button', { name: 'Accept' }).click();
await page.waitForTimeout(1200);
console.log('after accept:', (await page.locator('.sheet').innerText()).slice(0,300).replace(/\n+/g,' | '));
await page.screenshot({ path: process.argv[2] });
// Drive the job through to completion by pressing whatever primary action shows.
for (let step = 0; step < 8; step++) {
  await page.waitForTimeout(2500);
  const state = await page.evaluate(() => {
    const s = window.urus.getState().state;
    const d = s.drivers[s.session.driverId];
    const job = d.activeJobId ? (s.trips[d.activeJobId] ?? s.orders[d.activeJobId]) : null;
    return job ? { id: job.id, status: job.status } : null;
  });
  if (!state) { console.log('job finished at step', step); break; }
  console.log('step', step, state.status);
  const btns = ['I have arrived','Start trip','Complete trip','Arrived at store','Confirm pickup','Complete delivery','Complete · photo proof'];
  for (const label of btns) {
    const b = page.getByRole('button', { name: label, exact: true });
    if (await b.count() && await b.first().isEnabled()) { await b.first().click(); break; }
  }
}
await page.screenshot({ path: process.argv[3] });
console.log('errors:', errs.slice(0,4).join(' || ') || 'none');
await browser.close();
