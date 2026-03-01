
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

(async () => {
    // Use a temporary directory
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-inspect-'));
    console.log(`Using temp profile: ${userDataDir}`);
    
    const browser = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
        channel: 'chrome' 
    });

    const page = await browser.newPage();
    
    const targetUrl = 'https://www.producthunt.com/leaderboard/daily/2026/2/25/all';
    console.log(`Navigating to ${targetUrl}...`);
    
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    // Try to access window.__APOLLO_STATE__
    const apolloState = await page.evaluate(() => window.__APOLLO_STATE__);
    
    if (apolloState) {
        console.log('SUCCESS: window.__APOLLO_STATE__ is accessible.');
        fs.writeFileSync('apollo_state.json', JSON.stringify(apolloState, null, 2));
        console.log(`Saved apollo_state.json (keys: ${Object.keys(apolloState).length})`);
    } else {
        console.log('FAILURE: window.__APOLLO_STATE__ is NOT accessible.');
    }
    
    // Also try __NEXT_DATA__
    const nextData = await page.evaluate(() => window.__NEXT_DATA__);
    if (nextData) {
        console.log('SUCCESS: window.__NEXT_DATA__ is accessible.');
        fs.writeFileSync('next_data.json', JSON.stringify(nextData, null, 2));
        console.log('Saved next_data.json');
    }

    await browser.close();
})();
