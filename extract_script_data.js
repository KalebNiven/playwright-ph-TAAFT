
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

    // Get all script tags
    const scripts = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('script')).map(s => ({
            id: s.id,
            type: s.type,
            content: s.innerHTML
        }));
    });

    console.log(`Found ${scripts.length} script tags.`);
    
    let found = false;
    for (const s of scripts) {
        if (s.content.includes('HomefeedItemEdge')) {
            console.log(`Found 'HomefeedItemEdge' in script (ID: ${s.id}, Type: ${s.type})`);
            fs.writeFileSync('found_script.js', s.content);
            console.log(`Saved script content to found_script.js (Length: ${s.content.length})`);
            found = true;
            
            // Check if it's JSON
            if (s.type === 'application/json' || s.content.trim().startsWith('{')) {
                try {
                    const json = JSON.parse(s.content);
                    console.log('Script content is valid JSON.');
                } catch (e) {
                    console.log('Script content is NOT valid JSON.');
                }
            }
        }
    }
    
    if (!found) {
        console.log('HomefeedItemEdge NOT found in any script tag.');
    }

    await browser.close();
})();
