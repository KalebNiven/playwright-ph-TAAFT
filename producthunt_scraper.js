const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

// Clean tracking params from a URL
function cleanWebsiteUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    u.searchParams.delete('ref');
    u.searchParams.delete('utm_source');
    u.searchParams.delete('utm_medium');
    u.searchParams.delete('utm_campaign');
    let cleaned = u.toString();
    if (cleaned.endsWith('?')) cleaned = cleaned.slice(0, -1);
    return cleaned;
  } catch {
    return rawUrl;
  }
}


const PH_URL = process.argv[2] || 'https://www.producthunt.com';
const IS_LEADERBOARD = PH_URL.includes('/leaderboard/');
const OUTPUT_DIR = '/Users/nastyabalashova/Desktop/APPSUMO/SOURCING';

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

  console.log(`Navigating to ${PH_URL}${IS_LEADERBOARD ? ' (leaderboard)' : ' (homepage)'}`);
  await page.goto(PH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for Cloudflare challenge to resolve and products to load
  console.log('Waiting for Cloudflare challenge to resolve...');
  await page.waitForSelector('a[href*="/products/"]', { timeout: 60000 });
  console.log('Page loaded, waiting for products to render...');

  // Give initial products time to fully render (they load slowly)
  await page.waitForTimeout(3000);

  // Scroll down repeatedly to trigger infinite scroll and load ALL products
  console.log('Scrolling to load all products...');
  let previousCount = 0;
  let stableRounds = 0;
  const MAX_STABLE_ROUNDS = 10; // stop after 10 rounds with no new products
  const SCROLL_TIMEOUT = 15 * 60 * 1000; // 15 minute safety limit
  const scrollStart = Date.now();

  while (stableRounds < MAX_STABLE_ROUNDS) {
    if (Date.now() - scrollStart > SCROLL_TIMEOUT) {
      console.log('  ⏱ Scroll timeout reached (15 min). Proceeding with what we have.');
      break;
    }

    const currentCount = await page.evaluate(() => {
      const main = document.querySelector('main');
      if (!main) return 0;
      return main.querySelectorAll('a[href*="/products/"]').length;
    });

    if (currentCount > previousCount) {
      console.log(`  … ${currentCount} product links loaded so far`);
      previousCount = currentCount;
      stableRounds = 0;
    } else {
      stableRounds++;
    }

    // Scroll the last product card into view — this keeps us near the
    // infinite-scroll trigger zone no matter how long the page gets.
    await page.evaluate(() => {
      const main = document.querySelector('main');
      if (!main) return;
      const links = main.querySelectorAll('a[href*="/products/"]');
      if (links.length > 0) {
        links[links.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    await page.waitForTimeout(2000);
  }

  const elapsed = Math.round((Date.now() - scrollStart) / 1000);
  console.log(`Finished scrolling in ${elapsed}s. Total product links found: ${previousCount}`);

  // Final wait to let the last batch of rows fully render
  await page.waitForTimeout(3000);

  let products;

  if (IS_LEADERBOARD) {
    // ── Leaderboard: extract from Apollo cache (fast & reliable) ──
    products = await page.evaluate(() => {
      const cache = window.__APOLLO_CLIENT__?.cache?.extract?.();
      if (!cache) return [];
      const keys = Object.keys(cache);
      const postKeys = keys.filter((k) => /^Post\d+$/.test(k));
      const results = [];
      for (const pk of postKeys) {
        const post = cache[pk];
        if (!post.name || !post.slug) continue;
        const tagline =
          post['tagline({"respectEmbargo":true})'] || post.tagline || '';
        const upvotes = post.latestScore || 0;
        // Construct redirect URL from post ID (cache key like "Post:1080572")
        const postId = pk.replace(/^Post:?/, '');
        const shortenedUrl = postId ? `/r/p/${postId}` : (post.shortenedUrl || null);
        const phUrl = 'https://www.producthunt.com/products/' + (cache[post.product?.__ref]?.slug || post.slug);
        results.push({ name: post.name, tagline, upvotes, shortenedUrl, phUrl });
      }
      // Sort by upvotes descending (leaderboard order)
      results.sort((a, b) => b.upvotes - a.upvotes);
      return results;
    });
    console.log(`Found ${products.length} products in Apollo cache.`);
    products = products.filter((p) => p.tagline);
    console.log(`After filtering empty taglines: ${products.length} products.`);
  } else {
    // ── Homepage: extract from DOM ──
    products = await page.evaluate(() => {
      const results = [];
      const heading = document.querySelector('h1');
      if (!heading) return results;
      const container = heading.parentElement;
      if (!container) return results;

      for (const section of container.children) {
        if (section.tagName !== 'SECTION') continue;
        const nameLink = section.querySelector('a[href*="/products/"]');
        if (!nameLink) continue;

        const rawName = nameLink.textContent.trim();
        if (!/^\d+\.\s/.test(rawName)) continue;
        const name = rawName.replace(/^\d+\.\s*/, '');

        const phPath = nameLink.getAttribute('href');
        const phUrl = 'https://www.producthunt.com' + phPath;

        const taglineEl = section.querySelector('span.text-secondary')
          || section.querySelector('[class*="tagline"]');
        let tagline = taglineEl?.textContent?.trim() || '';
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

        const buttons = section.querySelectorAll('button');
        const upvotes = parseInt((buttons[1]?.textContent?.trim() || '0').replace(/,/g, '')) || 0;

        results.push({ name, tagline, upvotes, phUrl });
      }
      return results;
    });
    console.log(`Found ${products.length} products.`);
  }

  // ── Resolve external website links ──
  if (IS_LEADERBOARD) {
    // Use CDP to intercept redirect responses at the raw network level.
    // This bypasses CORS filtering and avoids Playwright buffer corruption.
    console.log('Resolving website links via CDP network interception...');

    // Warm up CF session for /r/p/ path by navigating to the first redirect URL
    const firstWithUrl = products.find((p) => p.shortenedUrl);
    if (firstWithUrl) {
      console.log('  Warming up Cloudflare session for redirect path...');
      const warmupPage = await context.newPage();
      try {
        await warmupPage.goto('https://www.producthunt.com' + firstWithUrl.shortenedUrl, {
          waitUntil: 'domcontentloaded', timeout: 15000,
        });
        await warmupPage.waitForTimeout(3000);
      } catch {}
      await warmupPage.close();
    }

    const client = await context.newCDPSession(page);
    await client.send('Network.enable');

    // Map: original URL → redirect target URL
    const redirectMap = new Map();
    client.on('Network.requestWillBeSent', (event) => {
      if (event.redirectResponse) {
        redirectMap.set(event.redirectResponse.url, event.request.url);
      }
    });

    const BATCH = 5;
    for (let start = 0; start < products.length; start += BATCH) {
      const batch = products.slice(start, start + BATCH);
      const shortUrls = batch.map((p) => p.shortenedUrl || '');

      await page.evaluate(async (urls) => {
        await Promise.all(urls.map(async (u) => {
          if (!u) return;
          try { await fetch(u, { mode: 'no-cors', redirect: 'follow' }); } catch {}
        }));
      }, shortUrls);

      await new Promise((r) => setTimeout(r, 200));

      for (let j = 0; j < batch.length; j++) {
        const shortUrl = shortUrls[j];
        if (!shortUrl) continue;
        const fullShortUrl = 'https://www.producthunt.com' + shortUrl;
        const target = redirectMap.get(fullShortUrl);
        if (target && !target.includes('producthunt.com')) {
          products[start + j].website = cleanWebsiteUrl(target);
        }
      }

      // After first 50, check if CDP approach is working; if not, switch to fallback
      if (start + BATCH === 50) {
        const done = products.filter((p) => p.website).length;
        if (done === 0) {
          console.log('  CDP redirect interception not working — falling back to product page visits...');
          break;
        }
      }

      if ((start + BATCH) % 50 < BATCH) {
        const done = products.filter((p) => p.website).length;
        console.log(`  … ${Math.min(start + BATCH, products.length)}/${products.length} (${done} with URLs)`);
      }
    }

    await client.detach().catch(() => {});

    // Fallback: visit product pages for any unresolved URLs
    const unresolved = products.filter((p) => !p.website);
    if (unresolved.length > products.length * 0.5) {
      console.log(`Falling back to product page visits for ${unresolved.length} products...`);
      const navPage = await context.newPage();
      for (let i = 0; i < products.length; i++) {
        if (products[i].website) continue;
        const p = products[i];
        try {
          await navPage.goto(p.phUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          // Extract website from Apollo cache on product page
          const url = await navPage.evaluate(() => {
            const c = window.__APOLLO_CLIENT__?.cache?.extract?.();
            if (!c) return '';
            // Look for ProductLink entries with type 'website'
            for (const [k, v] of Object.entries(c)) {
              if (k.startsWith('ProductLink') && v.type === 'website' && v.url) return v.url;
            }
            // Fallback: look for external link in the page
            const link = document.querySelector('a[rel*="nofollow"][href^="http"]:not([href*="producthunt"])');
            return link?.href || '';
          });
          if (url && !url.includes('producthunt.com') && !url.includes('cloudflare.com')) {
            products[i].website = cleanWebsiteUrl(url);
          }
        } catch {}
        if ((i + 1) % 50 === 0) {
          const done = products.filter((p) => p.website).length;
          console.log(`  … ${i + 1}/${products.length} (${done} with URLs)`);
        }
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 1000));
      }
      await navPage.close();
    }

    const resolved = products.filter((p) => p.website).length;
    console.log(`Website links resolved: ${resolved}/${products.length}`);
  } else {
    // Homepage fallback: visit each product page to resolve website link
    console.log('Resolving external website links...');

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      try {
        await page.goto(p.phUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const website = await page.evaluate(() => {
          const visitLink = document.querySelector('a[href*="?ref=producthunt"]');
          if (visitLink) return visitLink.href;
          const links = document.querySelectorAll('a[target="_blank"]');
          for (const link of links) {
            const href = link.href;
            if (href && !href.includes('producthunt.com') && href.startsWith('http')) {
              return href;
            }
          }
          return '';
        });

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

      if (i < products.length - 1) {
        await page.waitForTimeout(3000);
      }
    }
  }

  await context.close();

  // Build Excel output
  const now = new Date();
  // Extract date from leaderboard URL (e.g. /leaderboard/daily/2025/2/25/all → 2025-02-25)
  const urlDateMatch = PH_URL.match(/\/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  const dateStr = urlDateMatch
    ? `${urlDateMatch[1]}-${urlDateMatch[2].padStart(2, '0')}-${urlDateMatch[3].padStart(2, '0')}`
    : now.toISOString().split('T')[0];

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Product Hunt Launches');

  sheet.columns = [
    { header: 'Company', key: 'name', width: 25 },
    { header: 'Tagline', key: 'tagline', width: 50 },
    { header: 'Upvotes', key: 'upvotes', width: 10 },
    { header: 'Traffic', key: 'traffic', width: 15 },
    { header: 'Website', key: 'website', width: 40 },
    { header: 'Source', key: 'source', width: 15 },
    { header: 'in HubSpot', key: 'hubspot', width: 15 },
    { header: 'BDA', key: 'bda', width: 15 },
    { header: 'comments', key: 'comments', width: 30 },
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
      traffic: '',
      website: p.website || '',
      source: 'Product Hunt',
      hubspot: '',
      bda: '',
      comments: '',
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


}

scrape().catch((err) => {
  console.error('Scraper failed:', err);
  process.exit(1);
});
