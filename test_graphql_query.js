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
  await page.goto("https://www.producthunt.com/leaderboard/daily/2026/2/26/all", { waitUntil: "domcontentloaded" });

  console.log("Attempting GraphQL query...");

  const result = await page.evaluate(async () => {
    // Get CSRF token if needed (often in meta tags or cookies)
    // Product Hunt usually sends it in headers like 'x-csrf-token' or similar
    // But let's try to find a previous request to copy headers?
    // Or just try a simple fetch.
    
    // Actually, looking at network tab (mental model), PH uses 'Authorization: Bearer ...' sometimes or just cookies.
    // Let's try a basic query.
    
    const query = `
      query GetPostWebsite {
        post(id: "1084409") {
          id
          name
          website
          url
          redirectUrl
        }
      }
    `;

    // We need to find the correct endpoint and headers.
    // Let's try the standard endpoint.
    const endpoint = "/frontend/graphql";
    
    // We need to get the APIToken or similar.
    // Often found in window.__APOLLO_STATE__ or similar, or just cookies.
    // Let's try without specific headers first (relying on cookies).
    
    // But wait, GraphQL usually requires a specific client ID or token.
    // Let's look for 'api_token' in localStorage or cookies?
    
    try {
        // Try to find the CSRF token from meta tag
        const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
        const headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        };
        if (csrf) headers["X-CSRF-Token"] = csrf;
        
        // Also look for authorization header in client-side config?
        // Let's just try.
        
        const response = await fetch(endpoint, {
            method: "POST",
            headers: headers,
            body: JSON.stringify({ query })
        });
        
        return {
            status: response.status,
            data: await response.json()
        };
    } catch (e) {
        return { error: e.toString() };
    }
  });

  console.log("GraphQL Result:", JSON.stringify(result, null, 2));

  await context.close();
}

run();
