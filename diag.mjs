import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
await page.goto('http://127.0.0.1:4173/driver', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.locator('.seg > button', { hasText: '12' }).first().click();
await page.waitForTimeout(16000);
const info = await page.evaluate(() => {
  const s = window.urus.getState().state;
  const d = s.drivers[s.session.driverId];
  const trips = Object.values(s.trips);
  const searching = trips.filter(t => ['requested','searching','no_drivers'].includes(t.status));
  const offers = Object.values(s.offers);
  return {
    driver: { id: d.id, status: d.status, opted: d.optedProductIds, vehicle: d.vehicle.classId, rating: d.rating, at: d.at, active: d.activeJobId },
    searchingCount: searching.length,
    searchingSample: searching.slice(0,4).map(t => ({ id: t.id, product: t.productId, status: t.status, pickup: t.stops[0].place.at })),
    offersTotal: offers.length,
    offersByStatus: offers.reduce((a,o)=>({...a,[o.status]:(a[o.status]||0)+1}),{}),
    offersToMe: offers.filter(o=>o.driverId===d.id).length,
    onlineDrivers: Object.values(s.drivers).filter(x=>x.status==='online').length,
    ordersByStatus: Object.values(s.orders).reduce((a,o)=>({...a,[o.status]:(a[o.status]||0)+1}),{}),
    tripsByStatus: trips.reduce((a,t)=>({...a,[t.status]:(a[t.status]||0)+1}),{}),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
