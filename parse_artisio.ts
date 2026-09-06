const data = require('./final_test.json');
console.log("Count:", data.data.length);

data.data.forEach(d => {
  if (d.auctioneer.includes("BPI")) {
    console.log(`BPI: ${d.title} - Bid: ${d.currentPrice} Start: ${d.startPrice}`);
  } else {
    console.log(`${d.auctioneer}: ${d.title} - Bid: ${d.currentPrice} Start: ${d.startPrice} Est: ${d.estimateStr}`);
  }
});
