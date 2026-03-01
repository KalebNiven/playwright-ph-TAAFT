const { chromium } = require("playwright");
const path = require("path");

async function run() {
  const userDataDir = path.join(__dirname, ".chrome-profile");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: "chrome",
    args: [
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const page = context.pages()[0] || (await context.newPage());
  console.log("Navigating to Product Hunt...");
  // We need to go to the leaderboard page to get the relevant data for products
  await page.goto("https://www.producthunt.com/leaderboard/daily/2026/2/26/all", { waitUntil: "domcontentloaded" });
  
  // Extract and parse Apollo Data
  console.log("\nExtracting Apollo Data...");
  const productData = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll("script"));
    let foundData = [];
    
    for (const s of scripts) {
      if (s.innerHTML.includes("ApolloSSRDataTransport")) {
         const match = s.innerHTML.match(/\.push\((\{.*\})\)/);
         if (match && match[1]) {
           try {
             const cleanJsonStr = match[1].replace(/:undefined/g, ":null");
             const json = JSON.parse(cleanJsonStr);
             
             // Traverse to find Post objects
             const traverse = (obj) => {
                if (!obj || typeof obj !== "object") return;
                if (obj.__typename === "Post") {
                   foundData.push(obj);
                }
                Object.values(obj).forEach(value => {
                  if (Array.isArray(value)) {
                    value.forEach(item => traverse(item));
                  } else if (typeof value === "object") {
                    traverse(value);
                  }
                });
             };
             traverse(json);
           } catch (e) {
             // ignore
           }
         }
      }
    }
    return foundData;
  });

  console.log(`Found ${productData.length} products in SSR data.`);
  
  if (productData.length > 0) {
    // Log the first product's URL fields
    const p = productData[0];
    console.log("\nSample Product Data (Fields related to URL):");
    console.log(`Name: ${p.name}`);
    console.log(`ID: ${p.id}`);
    console.log(`Slug: ${p.slug}`);
    console.log(`Website: ${p.website}`);
    console.log(`Url: ${p.url}`);
    console.log(`ShortenedUrl: ${p.shortenedUrl}`);
    console.log(`RedirectUrl: ${p.redirectUrl}`); // Guessing field names
    console.log(`ExternalUrl: ${p.externalUrl}`); // Guessing field names
    console.log("Full Object keys:", Object.keys(p));
  }

  await context.close();
}

run();
