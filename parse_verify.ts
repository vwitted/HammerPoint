const data = require('./verify_res.json');

data.data.forEach(d => {
  console.log(`${d.auctioneer}: ${d.title.substring(0, 30)} - Bid: ${d.currentPrice} Start: ${d.startPrice} URL: ${d.url}`);
});
