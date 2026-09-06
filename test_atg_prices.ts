import puppeteer from "puppeteer";

async function testPrices() {
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  });
  const page = await browser.newPage();
  await page.goto("https://www.bidspotter.co.uk/en-gb/search-results?searchTerm=lathe", { waitUntil: 'networkidle2' });
  
  const html = await page.content();
  console.log("HTML length:", html.length);
  console.log("Snippet:", html.substring(1000, 1500));
  await browser.close();
}
testPrices();
