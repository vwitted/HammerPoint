import { scrapeHibidLotsWithTimeout } from "./server.ts";

async function run() {
  const keyword = "3d scanner";
  const lots = await scrapeHibidLotsWithTimeout(keyword);
  console.log("HiBid lots:", lots.map(l => ({ title: l.title, current: l.currentPrice, start: l.startPrice, unpriced: l.isUnpriced, url: l.url })));
}
run();
