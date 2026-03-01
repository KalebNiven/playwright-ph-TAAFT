const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const PH_URL = 'https://www.producthunt.com';
const OUTPUT_DIR = path.join(__dirname, 'output');

async function scrape() {
  const userDataDir = path.join(__dirname, '.chrome-profile');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  const page = context.pages()[0] || (await context.newPage());

  console.log('Navigating to', PH_URL);
  await page.goto(PH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for Cloudflare challenge to resolve and products to load
  console.log('Waiting for Cloudflare challenge to resolve...');
  await page.waitForSelector('section a[href*="/products/"]', { timeout: 60000 });
  console.log('Page loaded, waiting for products to render...');

  // Give initial products time to fully render (they load slowly)
  await page.waitForTimeout(3000);

  // Scroll down repeatedly to trigger infinite scroll and load ALL products
  console.log('Scrolling to load all products...');
  let previousCount = 0;
  let stableRounds = 0;
  const MAX_STABLE_ROUNDS = 5; // stop after 5 rounds with no new products
  while (stableRounds < MAX_STABLE_ROUNDS) {
    const currentCount = await page.evaluate(() => {
      const h = document.querySelector('h1');
      if (!h) return 0;
      const c = h.parentElement;
      if (!c) return 0;
      return c.querySelectorAll('section a[href*="/products/"]').length;
    });

    if (currentCount > previousCount) {
      console.log(`  … ${currentCount} products loaded so far`);
      previousCount = currentCount;
      stableRounds = 0;
    } else {
      stableRounds++;
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);
  }
  console.log(`Finished scrolling. Total products found: ${previousCount}`);

  // Final wait to let the last batch of rows fully render
  await page.waitForTimeout(2000);

  const products = await page.evaluate(() => {
    const results = [];

    // Find the "Top Products Launching Today" heading and its parent container
    const heading = document.querySelector('h1');
    if (!heading) return results;
    const container = heading.parentElement;
    if (!container) return results;

    for (const section of container.children) {
      if (section.tagName !== 'SECTION') continue;
      const nameLink = section.querySelector('a[href*="/products/"]');
      if (!nameLink) continue;

      // Name (strip rank prefix like "1. ")
      const rawName = nameLink.textContent.trim();
      // Only include items with a rank prefix ("1. Name", "2. Name", etc.)
      if (!/^\d+\.\s/.test(rawName)) continue;
      const name = rawName.replace(/^\d+\.\s*/, '');

      // PH product URL
      const phPath = nameLink.getAttribute('href');
      const phUrl = 'https://www.producthunt.com' + phPath;

      // Tagline — try multiple selectors since the page structure can vary
      const taglineEl = section.querySelector('span.text-secondary')
        || section.querySelector('[class*="tagline"]');
      let tagline = taglineEl?.textContent?.trim() || '';
      // Fallback: grab the first generic div text after the name link
      if (!tagline) {
        const parent = nameLink.parentElement;
        if (parent) {
          const divs = parent.querySelectorAll('div');
          for (const d of divs) {
            const t = d.textContent.trim();
            if (t && t !== rawName && !t.includes('•') && t.length > 5) {
              tagline = t;
              break;
            }
          }
        }
      }

      // Buttons: first = comments, second = upvotes
      const buttons = section.querySelectorAll('button');
      const upvotes = parseInt((buttons[1]?.textContent?.trim() || '0').replace(/,/g, '')) || 0;

      results.push({ name, tagline, upvotes, phUrl });
    }

    return results;
  });

  console.log(`Found ${products.length} products launched today.`);

  // Resolve external website links by visiting each product page
  console.log('Resolving external website links...');
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    try {
      await page.goto(p.phUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const website = await page.evaluate(() => {
        // Look for the "Visit" or external website link on the product page
        const visitLink = document.querySelector('a[href*="?ref=producthunt"]');
        if (visitLink) return visitLink.href;
        // Fallback: any external link in the main content
        const links = document.querySelectorAll('a[target="_blank"]');
        for (const link of links) {
          const href = link.href;
          if (href && !href.includes('producthunt.com') && href.startsWith('http')) {
            return href;
          }
        }
        return '';
      });

      // Clean UTM params
      let cleanUrl = website;
      try {
        const u = new URL(website);
        u.searchParams.delete('ref');
        u.searchParams.delete('utm_source');
        u.searchParams.delete('utm_medium');
        u.searchParams.delete('utm_campaign');
        cleanUrl = u.toString();
        if (cleanUrl.endsWith('?')) cleanUrl = cleanUrl.slice(0, -1);
      } catch {}

      products[i].website = cleanUrl;
      process.stdout.write(`  [${i + 1}/${products.length}] ${p.name} → ${cleanUrl || 'no link'}\n`);
    } catch {
      products[i].website = '';
      process.stdout.write(`  [${i + 1}/${products.length}] ${p.name} → failed\n`);
    }
  }

  await context.close();

  // Build Excel output
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Product Hunt Launches');

  sheet.columns = [
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Tagline', key: 'tagline', width: 50 },
    { header: 'Upvotes', key: 'upvotes', width: 10 },
    { header: 'Website', key: 'website', width: 40 },
  ];

  // Style header row
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFDA552F' }, // PH orange
  };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const row = sheet.addRow({
      name: p.name,
      tagline: p.tagline,
      upvotes: p.upvotes,
      website: p.website || '',
    });

    // Make links clickable
    if (p.website) {
      row.getCell('website').value = { text: p.website, hyperlink: p.website };
      row.getCell('website').font = { color: { argb: 'FF0563C1' }, underline: true };
    }
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const xlsxFile = path.join(OUTPUT_DIR, `producthunt-${dateStr}.xlsx`);
  await workbook.xlsx.writeFile(xlsxFile);
  console.log(`\nExcel written to ${xlsxFile}`);

  // Build Markdown output
  let md = `# Product Hunt — Top Launches ${dateStr}\n\n`;
  md += `> Scraped at ${now.toISOString()} — ${products.length} products\n\n`;
  md += `| Name | Tagline | Upvotes | Website |\n`;
  md += `| --- | --- | --- | --- |\n`;
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const esc = (s) => (s || '').replace(/\|/g, '\\|');
    md += `| ${esc(p.name)} | ${esc(p.tagline)} | ${p.upvotes} | ${p.website || ''} |\n`;
  }

  const mdFile = path.join(OUTPUT_DIR, `producthunt-${dateStr}.md`);
  fs.writeFileSync(mdFile, md, 'utf-8');
  console.log(`Markdown written to ${mdFile}`);
}

scrape().catch((err) => {
  console.error('Scraper failed:', err);
  process.exit(1);
});
