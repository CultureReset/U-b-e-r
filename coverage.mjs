import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
await page.goto('http://127.0.0.1:4173/admin', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.locator('.seg > button', { hasText: '12' }).first().click();
await page.waitForTimeout(20000);
const info = await page.evaluate(() => {
  const s = window.urus.getState().state;
  const drivers = Object.values(s.drivers).filter(d => d.marketId === s.marketId);
  const byProduct = {};
  for (const d of drivers) for (const p of d.optedProductIds) {
    byProduct[p] = byProduct[p] || { total: 0, online: 0 };
    byProduct[p].total++;
    if (d.status !== 'offline') byProduct[p].online++;
  }
  const trips = Object.values(s.trips);
  const noDrivers = trips.filter(t => t.status === 'no_drivers');
  return {
    byProduct,
    noDriversNow: noDrivers.length,
    noDriversByProduct: noDrivers.reduce((a,t)=>({...a,[t.productId]:(a[t.productId]||0)+1}),{}),
    cancelledNoDrivers: trips.filter(t=>t.cancellationReason==='no-drivers').length,
    completedRecent: trips.filter(t=>t.status==='completed').length,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
