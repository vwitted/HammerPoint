const fs = require('fs');
const html = fs.readFileSync('bs.html', 'utf8');

const titles = html.match(/class="lot-title"[^>]*>([^<]+)</g);
const currentBids = html.match(/class="current-bid"[^>]*>([^<]+)</g);
const startingBids = html.match(/class="starting-bid"[^>]*>([^<]+)</g);

console.log("Titles:", titles ? titles.slice(0, 3) : "none");
console.log("Current bids:", currentBids ? currentBids.slice(0, 3) : "none");
console.log("Starting bids:", startingBids ? startingBids.slice(0, 3) : "none");

