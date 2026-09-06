import fs from 'fs';
const html = fs.readFileSync('bs.html', 'utf8');

// Find any divs containing a pound sign near a lot card
const cards = html.split('lot-card').slice(1);
cards.slice(0, 2).forEach((c, i) => {
  console.log(`--- Card ${i} ---`);
  const lines = c.split('\n');
  const priceLines = lines.filter(l => l.includes('£') || l.includes('amount') || l.includes('price') || l.includes('bid'));
  console.log(priceLines.join('\n').substring(0, 500));
});
