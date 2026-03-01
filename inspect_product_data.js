const { chromium } = require("playwright");
const path = require("path");

async function inspectData() {
  const userDataDir = path.join(__dirname, ".chrome-profile");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: "chrome",
    args: [
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const page = context.pages()[0] || (await context.newPage());
  // Go to a specific post to check its data in __APOLLO_STATE__ or similar
  await page.goto("https://www.producthunt.com/posts/chatpal", { waitUntil: "domcontentloaded" });
  
  // Extract data from Apollo State
  const data = await page.evaluate(() => {
    // Try to find the post data in window.__APOLLO_STATE__
    if (window.__APOLLO_STATE__) {
      const keys = Object.keys(window.__APOLLO_STATE__);
      const postKey = keys.find(k => k.startsWith("Post:") && window.__APOLLO_STATE__[k].slug === "chatpal");
      if (postKey) {
        return window.__APOLLO_STATE__[postKey];
      }
    }
    return null;
  });

  console.log("Extracted Product Data:");
  console.log(JSON.stringify(data, null, 2));

  await context.close();
}

inspectData();
