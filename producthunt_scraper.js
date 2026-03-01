const { chromium } = require("playwright");
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");

// Function to get local date parts
function getLocalDate() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

// Parse command line argument or default to today
let targetYear, targetMonth, targetDay;
const arg = process.argv[2];

if (arg) {
  // Try parsing URL: .../daily/YYYY/M/D...
  const urlMatch = arg.match(/daily\/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (urlMatch) {
    [, targetYear, targetMonth, targetDay] = urlMatch.map(Number);
    console.log(
      `Using date from URL: ${targetYear}-${targetMonth}-${targetDay}`,
    );
  } else {
    // Try parsing date string: YYYY-MM-DD or YYYY/MM/DD
    const dateMatch = arg.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (dateMatch) {
      [, targetYear, targetMonth, targetDay] = dateMatch.map(Number);
      console.log(
        `Using date from argument: ${targetYear}-${targetMonth}-${targetDay}`,
      );
    } else {
      console.log("Invalid format. Defaulting to 2026-02-25 (Target Date).");
      targetYear = 2026;
      targetMonth = 2;
      targetDay = 25;
    }
  }
} else {
  console.log("No date provided. Defaulting to 2026-02-25 (Target Date).");
  targetYear = 2026;
  targetMonth = 2;
  targetDay = 25;
}

const PH_URL = `https://www.producthunt.com/leaderboard/daily/${targetYear}/${targetMonth}/${targetDay}/all`;
const OUTPUT_DIR = path.join(__dirname, "output");

// Helper to resolve redirects using a page instance
async function resolveRedirectWithPage(page, shortPath) {
  if (!shortPath) return "";
  const fullUrl = `https://www.producthunt.com${shortPath}`;
  try {
    // Navigate and wait for redirect
    // We use domcontentloaded which is usually enough after a redirect
    await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    const finalUrl = page.url();
    
    // Check if we are still on producthunt (failed redirect or internal page)
    // If it's a /posts/ page, then it wasn't a redirect link or it failed
    if (finalUrl.includes("producthunt.com/posts/") || finalUrl.includes("producthunt.com/products/")) {
        // If we were trying to resolve a /r/p/ link and ended up on a post page, 
        // it might mean the redirect failed or requires clicking "Visit"
        // But usually /r/p/ redirects to external.
        // If shortPath was /posts/..., then we are on the post page.
        return finalUrl;
    }

    // Clean URL
    try {
        const urlObj = new URL(finalUrl);
        urlObj.searchParams.delete("ref");
        urlObj.searchParams.delete("utm_source");
        urlObj.searchParams.delete("utm_medium");
        urlObj.searchParams.delete("utm_campaign");
        // Remove trailing slash
        let clean = urlObj.toString();
        if (clean.endsWith("/")) clean = clean.slice(0, -1);
        return clean;
    } catch (e) {
        return finalUrl;
    }
  } catch (e) {
    // console.error(`Failed to resolve ${shortPath}: ${e.message}`);
    return fullUrl;
  }
}

async function scrape() {
  const userDataDir = path.join(__dirname, ".chrome-profile");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: "chrome",
    ignoreHTTPSErrors: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  const page = context.pages()[0] || (await context.newPage());
  console.log(`Navigating to ${PH_URL}...`);

  const capturedProducts = new Map(); // ID -> product data
  const orderedIds = new Set(); // Preserves visual order

  // Intercept GraphQL responses to capture product data
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("graphql")) {
      try {
        const json = await response.json();
        if (
          json.data &&
          json.data.homefeedItems &&
          json.data.homefeedItems.edges
        ) {
          const items = json.data.homefeedItems.edges;
          process.stdout.write(`+${items.length} `);
          items.forEach((edge) => {
            if (edge.node && edge.node.id) {
              capturedProducts.set(edge.node.id, edge.node);
            }
          });
        }
      } catch (e) {
        // ignore
      }
    }
  });

  try {
    await page.goto(PH_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);

    // Extract initial data from Apollo SSR script
    console.log("Extracting initial data from page source...");
    const scriptContent = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll("script"));
      for (const s of scripts) {
        if (s.innerHTML.includes("ApolloSSRDataTransport")) {
          return s.innerHTML;
        }
      }
      return null;
    });

    if (scriptContent) {
      const match = scriptContent.match(/\.push\((\{.*\})\)/);
      if (match && match[1]) {
        try {
          const cleanJsonStr = match[1].replace(/:undefined/g, ":null");
          const json = JSON.parse(cleanJsonStr);

          const traverse = (obj) => {
            if (!obj || typeof obj !== "object") return;
            if (obj.__typename === "Post" && obj.id) {
              capturedProducts.set(obj.id, obj);
            }
            Object.values(obj).forEach((value) => {
              if (Array.isArray(value)) {
                value.forEach((item) => traverse(item));
              } else if (typeof value === "object") {
                traverse(value);
              }
            });
          };
          traverse(json);
          console.log(`Extracted products from SSR state.`);
        } catch (e) {
          console.error("Failed to parse SSR JSON:", e.message);
        }
      }
    }

    console.log("Starting infinite scroll to capture visual order...");

    let lastHeight = await page.evaluate(() => document.body.scrollHeight);
    let scrollCount = 0;
    const maxScrolls = 100;
    let noChangeCount = 0;

    // Helper to scrape visible IDs
    const scrapeVisibleIds = async () => {
      const items = await page.evaluate(() => {
        // Find all product links
        const anchors = Array.from(
          document.querySelectorAll(
            'main a[href^="/posts/"], main a[href^="/products/"]',
          ),
        );
        return anchors
          .map((a) => {
            // Look for ID in parent hierarchy
            let el = a;
            let id = null;
            while (el && el !== document.body) {
              const testId = el.getAttribute("data-test");
              if (testId && testId.startsWith("post-name-")) {
                id = testId.replace("post-name-", "");
                break;
              }
              el = el.parentElement;
            }
            return { id, href: a.getAttribute("href"), text: a.innerText };
          })
          .filter((item) => item.id !== null);
      });
      return items;
    };

    while (scrollCount < maxScrolls) {
      // Capture visible IDs BEFORE scrolling further
      const currentItems = await scrapeVisibleIds();
      currentItems.forEach((item) => orderedIds.add(item.id));

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);

      let newHeight = await page.evaluate(() => document.body.scrollHeight);

      if (newHeight === lastHeight) {
        noChangeCount++;
        const showMore = await page.$('button:has-text("Show more")');
        if (showMore) {
          console.log('\nFound "Show more" button, clicking...');
          await showMore.click();
          await page.waitForTimeout(3000);
          newHeight = await page.evaluate(() => document.body.scrollHeight);
          noChangeCount = 0;
        } else {
          if (noChangeCount > 2) {
            console.log("\nReached bottom or no new content loaded.");
            break;
          }
          await page.evaluate(() => window.scrollBy(0, -500));
          await page.waitForTimeout(500);
          await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight),
          );
          await page.waitForTimeout(2000);
        }
      } else {
        noChangeCount = 0;
      }

      lastHeight = newHeight;
      scrollCount++;
      process.stdout.write(".");
    }

    // Final capture
    const finalItems = await scrapeVisibleIds();
    finalItems.forEach((item) => orderedIds.add(item.id));

    console.log(`\nTotal unique ordered products: ${orderedIds.size}`);
    console.log(`Total captured data points: ${capturedProducts.size}`);

    // Build final list in order
    const productList = [];
    for (const id of orderedIds) {
      const data = capturedProducts.get(id);
      if (data) {
        productList.push(data);
      } else {
        productList.push({
          name: `Unknown Product ${id}`,
          id: id,
          shortenedUrl: `/posts/${id}`, // fallback
          votesCount: 0,
          tagline: "Data missing - check manual",
        });
      }
    }

    // Resolve redirects using a pool of pages
    console.log("Resolving external websites (using page navigation)...");
    
    const CONCURRENCY = 5;
    const workerPages = [];
    for (let i = 0; i < CONCURRENCY; i++) {
        workerPages.push(await context.newPage());
    }

    const resolvedProducts = new Array(productList.length);
    let currentIndex = 0;

    // Worker function
    const worker = async (pageInstance) => {
        while (currentIndex < productList.length) {
            const index = currentIndex++;
            const p = productList[index];
            
            // Only resolve if it looks like a redirect link (/r/p/)
            // If it's a post link, we might want to skip or try to find the "Visit" button?
            // Actually, if we only have /posts/..., we can't easily resolve without parsing the post page.
            // But let's try to resolve whatever shortenedUrl we have.
            
            let website = p.shortenedUrl ? `https://www.producthunt.com${p.shortenedUrl}` : "";
            
            if (p.shortenedUrl && p.shortenedUrl.startsWith("/r/p/")) {
                process.stdout.write(`R`); // R for Resolving
                website = await resolveRedirectWithPage(pageInstance, p.shortenedUrl);
            } else {
                process.stdout.write(`.`); // . for Skipping/Already resolved
                // If it's not a redirect link, check if we have 'website' in data?
                if (p.website) website = p.website;
            }

            resolvedProducts[index] = {
              name: p.name,
              tagline: p.tagline,
              upvotes: p.votesCount || p.latestScore || 0,
              website: website,
            };
        }
    };

    // Run workers
    await Promise.all(workerPages.map(p => worker(p)));
    
    // Close worker pages
    for (const p of workerPages) {
        await p.close();
    }
    
    console.log("\nResolution complete.");

    // Save to Excel
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const dateStr = `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
    const filename = `ProductHunt_Leaderboard_${dateStr}.xlsx`;
    const filepath = path.join(OUTPUT_DIR, filename);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Products");

    worksheet.columns = [
      { header: "Name", key: "name", width: 30 },
      { header: "Tagline", key: "tagline", width: 50 },
      { header: "Upvotes", key: "upvotes", width: 15 },
      { header: "Website", key: "website", width: 50 },
    ];

    worksheet.addRows(resolvedProducts);

    await workbook.xlsx.writeFile(filepath);
    console.log(`Saved ${resolvedProducts.length} products to ${filepath}`);
  } catch (error) {
    console.error("Error during scraping:", error);
  } finally {
    await context.close();
  }
}

scrape();
