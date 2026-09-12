import { scrapeBidspotterLots, fetchLiveAuctioneersLots, scrapeTheSaleroomLots, fetchEasyLiveAuctionLots } from "./server.ts";

async function run() {
  const keyword = "3d scanner";
  try {
    const l1 = await fetchLiveAuctioneersLots(keyword);
    console.log("LA:", l1.length, l1.map(l => ({ title: l.title, current: l.currentPrice, start: l.startPrice })));
  } catch(e) {}
  try {
    const l2 = await scrapeTheSaleroomLots(keyword);
    console.log("Saleroom:", l2.length, l2.map(l => ({ title: l.title, current: l.currentPrice, start: l.startPrice })));
  } catch(e) {}
  try {
    const l3 = await scrapeBidspotterLots(keyword);
    console.log("Bidspotter:", l3.length, l3.map(l => ({ title: l.title, current: l.currentPrice, start: l.startPrice })));
  } catch(e) {}
  try {
    const l4 = await fetchEasyLiveAuctionLots(keyword, 10, 0);
    console.log("EasyLive:", l4.length, l4.map(l => ({ title: l.title, current: l.currentPrice, start: l.startPrice })));
  } catch(e) {}
  process.exit(0);
}
run();
