
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

(async () => {
    // Use a temporary directory
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-inspect-'));
    const browser = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
        channel: 'chrome' 
    });

    const page = await browser.newPage();
    const targetUrl = 'https://www.producthunt.com/leaderboard/daily/2026/2/25/all';
    
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    // Try to access window[Symbol.for("ApolloSSRDataTransport")]
    const apolloData = await page.evaluate(() => {
        const symbol = Symbol.for("ApolloSSRDataTransport");
        return window[symbol];
    });
    
    if (apolloData) {
        console.log('SUCCESS: window[Symbol.for("ApolloSSRDataTransport")] is accessible.');
        console.log(`Array length: ${apolloData.length}`);
        fs.writeFileSync('apollo_symbol_data.json', JSON.stringify(apolloData, null, 2));
        
        // Search for "KiloClaw" in it
        const str = JSON.stringify(apolloData).toLowerCase();
        if (str.includes('kiloclaw')) {
            console.log('FOUND "KiloClaw" in Apollo Data!');
        } else {
            console.log('WARNING: "KiloClaw" NOT found in Apollo Data.');
        }
    } else {
        console.log('FAILURE: window[Symbol.for("ApolloSSRDataTransport")] is NOT accessible.');
    }

    await browser.close();
})();
