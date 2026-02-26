# Fresh Leads Scrapers

Daily scrapers for **TAAIFT** (There's An AI For That) and **Product Hunt** that extract newly launched products and output both Excel and Markdown files.

## Setup

```bash
npm install
npx playwright install chromium
```

## Scrapers

### TAAIFT — `taaift_scraper.js`

Scrapes all tools released within the last 24 hours from [theresanaiforthat.com/just-released](https://theresanaiforthat.com/just-released/).

```bash
node taaift_scraper.js
```

- **Runs headless** (~5 seconds)
- **Extracts:** Name, Tagline, Views, Website URL, Release time
- **Filters:** Only items showing "Released Xm ago" or "Released Xh ago"
- **Output:** `output/taaift-YYYY-MM-DD.xlsx` and `output/taaift-YYYY-MM-DD.md`

### Product Hunt — `producthunt_scraper.js`

Scrapes all products launched today from [producthunt.com](https://www.producthunt.com/).

```bash
node producthunt_scraper.js
```

- **Opens a visible Chrome window** (~90 seconds) — required to pass Cloudflare bot protection
- **Extracts:** Name, Tagline, Upvotes, Comments, Topics, Website URL, PH Page link
- **Resolves external website links** by visiting each product's PH page
- **Output:** `output/producthunt-YYYY-MM-DD.xlsx` and `output/producthunt-YYYY-MM-DD.md`
- **Note:** Uses a persistent Chrome profile (`.chrome-profile/`) to cache Cloudflare cookies

## Output

Both scrapers write to the `output/` directory with date-stamped filenames:

```
output/
  taaift-2026-02-26.xlsx
  taaift-2026-02-26.md
  producthunt-2026-02-26.xlsx
  producthunt-2026-02-26.md
```

### Excel files
- Styled header rows with colored backgrounds
- Clickable hyperlinks in website/URL columns
- Numeric columns (Views, Upvotes) stored as numbers for sorting/filtering

### Markdown files
- Table format with all extracted fields
- Includes scrape timestamp and item count

## Backup

Both scrapers also have BrowserAct workflows configured as a no-code backup option at [browseract.com](https://www.browseract.com/):

- **TAAIFT Daily Releases Scraper** — Loop + Scroll + Extract with "Visible Area" capture
- **Product Hunt scraper** — Configured with infinite scroll and Markdown output

## Dependencies

- [Playwright](https://playwright.dev/) — Browser automation
- [ExcelJS](https://github.com/exceljs/exceljs) — Excel file generation
