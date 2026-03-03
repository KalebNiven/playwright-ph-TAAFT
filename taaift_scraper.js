const { chromium } = require("playwright");
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");

const TAAIFT_URL = "https://theresanaiforthat.com/just-released/";
const OUTPUT_DIR = "/Users/nastyabalashova/Desktop/APPSUMO/SOURCING";

async function scrape() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Navigating to", TAAIFT_URL);
  await page.goto(TAAIFT_URL, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  // Wait for the tool list to render
  await page.waitForSelector("ul.tasks > li", { timeout: 15000 });

  console.log("Scrolling to load items from the last 7 days...");

  let stopScrolling = false;
  let scrollAttempts = 0;
  const MAX_SCROLLS = 50; // Safety limit

  while (!stopScrolling && scrollAttempts < MAX_SCROLLS) {
    // Check the last item's date
    const lastItemDate = await page.evaluate(() => {
      const items = document.querySelectorAll("ul.tasks > li");
      if (items.length === 0) return null;
      const last = items[items.length - 1];
      const r = last.querySelector("div.released span.relative");
      return r ? r.textContent.trim() : null;
    });

    if (lastItemDate) {
      // Parse date to check if we exceeded 7 days
      let daysAgo = 0;
      if (lastItemDate.includes("mo ago") || lastItemDate.includes("y ago")) {
        daysAgo = 30; // Treat as > 7
      } else if (/\d+d ago/.test(lastItemDate)) {
        const match = lastItemDate.match(/(\d+)d ago/);
        daysAgo = match ? parseInt(match[1]) : 0;
      }

      if (daysAgo > 7) {
        console.log(
          `Reached item from "${lastItemDate}" (> 7 days). Stopping scroll.`,
        );
        stopScrolling = true;
        break;
      }
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000); // Wait for load
    scrollAttempts++;
    console.log(
      `  Scrolled ${scrollAttempts}/${MAX_SCROLLS}... Last item: ${lastItemDate || "unknown"}`,
    );
  }

  console.log("Extracting items...");
  const items = await page.evaluate(() => {
    const results = [];
    const listItems = document.querySelectorAll("ul.tasks > li");

    for (const li of listItems) {
      const nameEl = li.querySelector("a.ai_link");
      const taglineEl = li.querySelector("div.short_desc");
      const viewsEl = li.querySelector("div.stats_views");
      const websiteEl = li.querySelector("a.external_ai_link");
      const releasedEl = li.querySelector("div.released span.relative");
      const savesEl = li.querySelector("div.saves");

      const released = releasedEl?.textContent?.trim() || "";

      // Check if released within 7 days
      let isWithin7Days = false;
      if (/^\d+[mh] ago$/.test(released)) {
        isWithin7Days = true; // Minutes or hours ago
      } else if (/Just released/i.test(released)) {
        isWithin7Days = true;
      } else if (/(\d+)d ago/.test(released)) {
        const match = released.match(/(\d+)d ago/);
        const days = match ? parseInt(match[1]) : 999;
        if (days <= 7) isWithin7Days = true;
      }

      if (isWithin7Days) {
        // Prefer external link, fallback to internal detail link
        let website = websiteEl?.href || nameEl?.href || "";
        
        results.push({
          name: nameEl?.textContent?.trim() || "",
          tagline: taglineEl?.textContent?.trim() || "",
          views: viewsEl?.textContent?.trim() || "0",
          saves: savesEl?.textContent?.trim() || "0",
          website: website,
          released,
        });
      }
    }
    return results;
  });

  // Second pass: Resolve internal links
  console.log(`Initial scrape complete. Found ${items.length} items.`);
  console.log("Checking for internal links that need resolution...");

  const internalLinks = items.filter(item => 
    item.website && item.website.includes("theresanaiforthat.com/ai/")
  );

  if (internalLinks.length > 0) {
    console.log(`Found ${internalLinks.length} items with internal links. Resolving...`);
    
    // Process in chunks to avoid overwhelming the browser/server
    const CHUNK_SIZE = 5;
    for (let i = 0; i < internalLinks.length; i += CHUNK_SIZE) {
      const chunk = internalLinks.slice(i, i + CHUNK_SIZE);
      console.log(`Resolving batch ${i + 1} to ${Math.min(i + CHUNK_SIZE, internalLinks.length)}...`);
      
      await Promise.all(chunk.map(async (item) => {
        try {
          const newPage = await browser.newPage();
          await newPage.goto(item.website, { waitUntil: 'domcontentloaded', timeout: 30000 });
          
          // Try to find the external link button
          // Priority: .visit_website_btn (Use tool) > .visit_ai_website_link (Domain text)
          const externalUrl = await newPage.evaluate(() => {
            const btn = document.querySelector('a.visit_website_btn') || 
                        document.querySelector('a.visit_ai_website_link');
            return btn ? btn.href : null;
          });

          if (externalUrl) {
            console.log(`  Resolved ${item.name}: ${externalUrl}`);
            item.website = externalUrl;
          } else {
            console.log(`  Could not resolve external link for ${item.name}`);
          }
          
          await newPage.close();
        } catch (err) {
          console.error(`  Error resolving ${item.name}: ${err.message}`);
        }
      }));
    }
  } else {
    console.log("No internal links found needing resolution.");
  }

  await browser.close();

  console.log(`Found ${items.length} items released within the last 7 days.`);

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];

  // Build Excel output
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("TAAIFT Releases");

  sheet.columns = [
    { header: "Company", key: "name", width: 25 },
    { header: "Tagline", key: "tagline", width: 50 },
    { header: "Upvotes", key: "views", width: 10 },
    { header: "Traffic", key: "traffic", width: 15 },
    { header: "Website", key: "website", width: 40 },
    { header: "Source", key: "source", width: 15 },
    { header: "in HubSpot", key: "hubspot", width: 15 },
    { header: "BDA", key: "bda", width: 15 },
    { header: "comments", key: "comments", width: 30 },
  ];

  // Style header row
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF4472C4" },
  };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

  for (const item of items) {
    // Strip UTM params from website URL
    let url = item.website;
    try {
      const u = new URL(url);
      u.searchParams.delete("ref");
      u.searchParams.delete("utm_source");
      u.searchParams.delete("utm_medium");
      u.searchParams.delete("utm_campaign");
      url = u.toString();
      if (url.endsWith("?")) url = url.slice(0, -1);
    } catch {}

    const row = sheet.addRow({
      name: item.name,
      tagline: item.tagline,
      views: parseInt(item.views) || 0,
      traffic: "",
      website: url,
      source: "TAAFT",
      hubspot: "",
      bda: "",
      comments: "",
    });

    // Make website column a clickable hyperlink
    row.getCell("website").value = { text: url, hyperlink: url };
    row.getCell("website").font = {
      color: { argb: "FF0563C1" },
      underline: true,
    };
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const xlsxFile = path.join(OUTPUT_DIR, `taaift-${dateStr}.xlsx`);
  await workbook.xlsx.writeFile(xlsxFile);
  console.log(`Excel written to ${xlsxFile}`);

  // Print summary to stdout
  for (const item of items) {
    console.log(`  ${item.released.padEnd(10)} ${item.name} — ${item.tagline}`);
  }
}

scrape().catch((err) => {
  console.error("Scraper failed:", err);
  process.exit(1);
});
