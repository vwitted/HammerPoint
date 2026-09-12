import puppeteer from "puppeteer";

async function run() {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
  
  await page.goto("https://www.bidspotter.co.uk/en-gb/search-results?searchterm=3d%20scanner", { waitUntil: "networkidle2" });
  
  const text = await page.evaluate(() => document.body.innerText);
  console.log("Found 3d scanner in text:", text.toLowerCase().includes("3d scanner") || text.toLowerCase().includes("3d"));
  const lots = text.split('\n').filter(l => l.includes('£') || l.toLowerCase().includes('bid'));
  console.log("Prices in text:", lots.slice(0, 10));
  await browser.close();
}
run();
