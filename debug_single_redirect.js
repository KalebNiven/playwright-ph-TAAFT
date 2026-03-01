const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const userDataDir = path.join(__dirname, ".chrome-profile-debug-redirect");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: "chrome",
    ignoreHTTPSErrors: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const page = await context.newPage();
  const testUrl = "https://www.producthunt.com/r/p/1086135";

  console.log(`Navigating to ${testUrl}...`);
  try {
      await page.goto(testUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      console.log(`URL after goto: ${page.url()}`);
      
      await page.waitForTimeout(5000);
      console.log(`URL after 5s wait: ${page.url()}`);

      const content = await page.content();
      if (content.includes("Just a moment") || content.includes("Challenge")) {
          console.log("Cloudflare Challenge detected!");
      }
  } catch (e) {
      console.error("Error:", e.message);
  }

  await context.close();
})();