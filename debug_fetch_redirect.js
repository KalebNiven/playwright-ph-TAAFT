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
  await page.goto("https://www.producthunt.com", { waitUntil: "domcontentloaded" });

  const testUrl = "https://www.producthunt.com/r/p/1084409";
  
  console.log(`Testing fetch for ${testUrl} inside page...`);

  const result = await page.evaluate(async (url) => {
    try {
      const response = await fetch(url, { method: 'HEAD' }); // default redirect: follow
      return {
        url: response.url,
        status: response.status,
        redirected: response.redirected
      };
    } catch (e) {
      return { error: e.message };
    }
  }, testUrl);

  console.log("Fetch Result:", result);

  await context.close();
}

run();
