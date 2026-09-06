import fetch from "node-fetch";

async function run() {
  const url = "https://bpiauctions.com/auctions/";
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      }
    });
    const text = await res.text();
    
    // Find all inline script tags (not containing src)
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    let count = 0;
    while ((match = scriptRegex.exec(text)) !== null) {
      const content = match[1];
      const tagOpen = match[0].slice(0, match[0].indexOf(">") + 1);
      if (!tagOpen.includes("src=")) {
        console.log(`\n--- Inline Script ${count + 1} (${content.length} chars) ---`);
        console.log(content.slice(0, 1000).trim() + (content.length > 1000 ? "\n..." : ""));
        count++;
      }
    }
  } catch (err: any) {
    console.error("Error:", err);
  }
}

run();
