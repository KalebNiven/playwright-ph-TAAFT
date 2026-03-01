
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
    
    // Wait for a bit
    await page.waitForTimeout(5000);

    const content = await page.content();
    fs.writeFileSync('leaderboard_page.html', content);
    console.log(`Saved HTML (size: ${content.length}).`);

    const lowerContent = content.toLowerCase();
    
    const targets = ['kiloclaw', 'arzul', 'notion', 'custom agents'];
    
    targets.forEach(t => {
        if (lowerContent.includes(t)) {
            console.log(`FOUND TARGET "${t}" IN HTML!`);
            // Print context
            const idx = lowerContent.indexOf(t);
            console.log(content.substring(idx - 100, idx + 100));
        } else {
            console.log(`Target "${t}" NOT found in HTML.`);
        }
    });
    
    // Also check for "Next.js" data script
    if (content.includes('__NEXT_DATA__')) {
        console.log('Found __NEXT_DATA__ script.');
    }
    if (content.includes('__APOLLO_STATE__')) {
        console.log('Found __APOLLO_STATE__ script.');
    }

    await browser.close();
})();
