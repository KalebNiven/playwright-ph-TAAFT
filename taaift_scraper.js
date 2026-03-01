const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const TAAIFT_URL = 'https://theresanaiforthat.com/just-released/';
const OUTPUT_DIR = path.join(__dirname, 'output');

async function scrape() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Navigating to', TAAIFT_URL);
  await page.goto(TAAIFT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Wait for the tool list to render
  await page.waitForSelector('ul.tasks > li', { timeout: 15000 });

  console.log('Extracting items...');
  const items = await page.evaluate(() => {
    const results = [];
    const listItems = document.querySelectorAll('ul.tasks > li');

    for (const li of listItems) {
      const nameEl = li.querySelector('a.ai_link');
      const taglineEl = li.querySelector('div.short_desc');
      const viewsEl = li.querySelector('div.stats_views');
      const websiteEl = li.querySelector('a.external_ai_link');
      const releasedEl = li.querySelector('div.released span.relative');
      const savesEl = li.querySelector('div.saves');

      const released = releasedEl?.textContent?.trim() || '';

      // Only include items released within 24 hours (minutes or hours ago)
      if (/^\d+[mh] ago$/.test(released)) {
        results.push({
          name: nameEl?.textContent?.trim() || '',
          tagline: taglineEl?.textContent?.trim() || '',
          views: viewsEl?.textContent?.trim() || '0',
          saves: savesEl?.textContent?.trim() || '0',
          website: websiteEl?.href || nameEl?.href || '',
          released,
        });
      }
    }
    return results;
  });

  await browser.close();

  console.log(`Found ${items.length} items released within the last 24 hours.`);

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;

  // Build Excel output
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('TAAIFT Releases');

  sheet.columns = [
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Tagline', key: 'tagline', width: 50 },
    { header: 'Views', key: 'views', width: 10 },
    { header: 'Website', key: 'website', width: 40 },
    { header: 'Released', key: 'released', width: 12 },
  ];

  // Style header row
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  for (const item of items) {
    // Strip UTM params from website URL
    let url = item.website;
    try {
      const u = new URL(url);
      u.searchParams.delete('ref');
      u.searchParams.delete('utm_source');
      u.searchParams.delete('utm_medium');
      u.searchParams.delete('utm_campaign');
      url = u.toString();
      if (url.endsWith('?')) url = url.slice(0, -1);
    } catch {}

    const row = sheet.addRow({
      name: item.name,
      tagline: item.tagline,
      views: parseInt(item.views) || 0,
      website: url,
      released: item.released,
    });

    // Make website column a clickable hyperlink
    row.getCell('website').value = { text: url, hyperlink: url };
    row.getCell('website').font = { color: { argb: 'FF0563C1' }, underline: true };
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const xlsxFile = path.join(OUTPUT_DIR, `taaift-${dateStr}.xlsx`);
  await workbook.xlsx.writeFile(xlsxFile);
  console.log(`Excel written to ${xlsxFile}`);

  // Build Markdown output
  let md = `# TAAIFT Daily Releases — ${dateStr}\n\n`;
  md += `> Scraped at ${now.toISOString()} — ${items.length} items within 24 hours\n\n`;
  md += `| Name | Tagline | Views | Website | Released |\n`;
  md += `| --- | --- | --- | --- | --- |\n`;
  for (const item of items) {
    let url = item.website;
    try {
      const u = new URL(url);
      u.searchParams.delete('ref');
      u.searchParams.delete('utm_source');
      u.searchParams.delete('utm_medium');
      u.searchParams.delete('utm_campaign');
      url = u.toString();
      if (url.endsWith('?')) url = url.slice(0, -1);
    } catch {}
    const esc = (s) => s.replace(/\|/g, '\\|');
    md += `| ${esc(item.name)} | ${esc(item.tagline)} | ${item.views} | ${url} | ${item.released} |\n`;
  }

  const mdFile = path.join(OUTPUT_DIR, `taaift-${dateStr}.md`);
  fs.writeFileSync(mdFile, md, 'utf-8');
  console.log(`Markdown written to ${mdFile}`);

  // Print summary to stdout
  for (const item of items) {
    console.log(`  ${item.released.padEnd(10)} ${item.name} — ${item.tagline}`);
  }
}

scrape().catch((err) => {
  console.error('Scraper failed:', err);
  process.exit(1);
});
