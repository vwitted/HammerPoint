import fetch from "node-fetch";

async function testUrl(name: string, url: string) {
  console.log(`\n=== Testing ${name} ===`);
  console.log("URL:", url);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
      }
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Length of response:", text.length);
    console.log("Snippet (first 500 chars):", text.slice(0, 500).replace(/\s+/g, " "));
    
    // Look for keywords in text
    const mentionsLot = text.toLowerCase().includes("lot");
    const mentionsAuction = text.toLowerCase().includes("auction");
    console.log("Contains 'lot':", mentionsLot, "| Contains 'auction':", mentionsAuction);
  } catch (err: any) {
    console.error(`Error fetching ${name}:`, err.message);
  }
}

async function run() {
  await testUrl("BPI Auctions", "https://bpiauctions.com/auctions/?filter=lathe");
  await testUrl("Ritchie Bros", "https://www.rbauction.co.uk/s/lathe");
  await testUrl("Copart UK", "https://www.copart.co.uk/public/v1/search/products?q=ford");
  await testUrl("Wilsons Auctions", "https://www.wilsonsauctions.com/search?query=lathe");
}

run();
