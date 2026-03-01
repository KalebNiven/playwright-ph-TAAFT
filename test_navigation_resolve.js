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

  const page = await context.newPage();
  const testUrl = "https://www.producthunt.com/r/p/1084409";
  
  console.log(`Navigating to ${testUrl}...`);
  const start = Date.now();
  
  try {
    await page.goto(testUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
    const end = Date.now();
    console.log(`Final URL: ${page.url()}`);
    console.log(`Time taken: ${end - start}ms`);
  } catch (e) {
    console.error(`Navigation failed: ${e.message}`);
  }

  await context.close();
}

run();
