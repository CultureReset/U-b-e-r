import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('http://127.0.0.1:4173/merchant', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
const t0 = Date.now();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.console-body');
console.log('boot ms', Date.now() - t0);
await page.locator('.seg > button', { hasText: '12' }).first().click();
await page.waitForTimeout(20000);
const info = await page.evaluate(() => {
  const s = window.urus.getState().state;
  const trips = Object.values(s.trips), orders = Object.values(s.orders);
  const count = (arr, k) => arr.reduce((a,x)=>({...a,[x[k]]:(a[x[k]]||0)+1}),{});
  const drivers = Object.values(s.drivers);
  return {
    tripStatuses: count(trips,'status'),
    orderStatuses: count(orders,'status'),
    myMerchantLive: orders.filter(o=>o.merchantId===s.session.merchantId && !['delivered','cancelled'].includes(o.status)).length,
    drivers: count(drivers,'status'),
    busy: drivers.filter(d=>d.activeJobId).length,
    pendingOffers: Object.values(s.offers).filter(o=>o.status==='pending').length,
    avgSurge: (Object.values(s.zoneSnapshots).reduce((a,z)=>a+z.surgeMultiplier,0)/Object.values(s.zoneSnapshots).length).toFixed(2),
  };
});
console.log(JSON.stringify(info));
console.log('errors:', errs.slice(0,3).join(' || ') || 'none');
await browser.close();
