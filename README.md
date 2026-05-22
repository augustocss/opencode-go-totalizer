# OpenCode Go Usage Totalizer

[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-✅-brightgreen)](https://www.tampermonkey.net/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> 🇧🇷 [Leia em português](README.pt-BR.md)

A Tampermonkey userscript that adds a floating panel to the OpenCode usage page, showing:

- **Grand total** of all usage costs
- **Breakdown by model** — cost and tokens (in/out) per AI model
- **Breakdown by day** — spending grouped by date
- **Live Go limits** — fetches usage percentages (Continuous, Weekly, Monthly) from the `/go` page
- **30-day projection** — warns if your current burn rate will exceed the $60 monthly cap

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser:
   - [Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
   - [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

2. Open [`opencode-go-totalizer.user.js`](opencode-go-totalizer.user.js) and click the **Raw** button (or copy the contents).

3. Tampermonkey should automatically recognize it and open the install screen. Click **Install**.

   Alternatively, in Tampermonkey click **Add new script**, paste the code, and press `Ctrl+S` to save.

4. Navigate to your OpenCode workspace usage page (`/workspace/wrk_.../go`). The panel will appear automatically at the top of the usage table.

## Usage

- On page load, the script scans the current page and displays totals
- Click **Scan all pages** to paginate through the full history
- Click **Reset** to clear cached data and start fresh
- Go limits refresh automatically in the background

## Features

| Feature | Description |
|---|---|
| **Grand total** | Sum of all costs in USD |
| **By model** | Cost and tokens (in/out) grouped by AI model |
| **By day** | Spending aggregated by date |
| **Go limits** | Live progress bars for Continuous, Weekly, and Monthly usage |
| **30-day projection** | Estimates if current pace will exceed the monthly cap |
| **Persistent cache** | Data survives page navigation (via GM_setValue) |
| **Paginated scanning** | Automatically fetches all history pages |

## Compatibility

- Works on all `https://opencode.ai/*` pages
- Tested on Chrome, Firefox, and Edge with Tampermonkey
- May work with Violentmonkey/Greasemonkey (not tested)

## License

MIT
