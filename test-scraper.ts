const { fetchEasyLiveAuctionLots, enrichEasyLiveTimedBidding, scrapeBpiLots, scrapeHibidLotsWithTimeout, scrapeBidspotterLots, scrapeTheSaleroomLots, fetchLiveAuctioneersLots } = require('./dist/server.cjs');

async function testSource(name, fn) {
  try {
    const lots = await fn("3d scanner");
    console.log(`--- ${name} ---`);
    lots.forEach(l => {
        console.log(`Title: ${l.title}`);
        console.log(`Prices: start=${l.startPrice}, current=${l.currentPrice}, estimate=${l.estimateStr}`);
        console.log(`URL: ${l.url}`);
    });
  } catch(e) {
    console.error(e);
  }
}

async function main() {
  await testSource("EasyLive", (k) => fetchEasyLiveAuctionLots(k, 10, 0));
  await testSource("BPI", (k) => scrapeBpiLots(k, 1));
  await testSource("Bidspotter", scrapeBidspotterLots);
  await testSource("TheSaleroom", scrapeTheSaleroomLots);
  await testSource("LiveAuctioneers", fetchLiveAuctioneersLots);
}
main();
