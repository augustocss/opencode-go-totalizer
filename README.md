# OpenCode Go Usage Totalizer

[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-✅-brightgreen)](https://www.tampermonkey.net/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> 🇧🇷 [Leia em português](README.pt-BR.md)

A Tampermonkey userscript that adds a floating panel to the OpenCode Console logs page (`/console/wrk_.../logs`), showing:

- **Grand total** of all usage costs in the current billing period
- **Previous period card** — totals for the last closed billing cycle (subject to server log retention)
- **Breakdown by model** — cost and tokens (in/out) per AI model
- **Breakdown by day** — spending grouped by date
- **Live Go limits** — usage percentages (Rolling, Weekly, Monthly) captured from the `/go` tab
- **30-day projection** — warns if your current burn rate will exceed the $60 monthly cap

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser:
   - [Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
   - [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

2. Open [`opencode-go-totalizer.user.js`](opencode-go-totalizer.user.js) and click the **Raw** button (or copy the contents).

3. Tampermonkey should automatically recognize it and open the install screen. Click **Install**.

   Alternatively, in Tampermonkey click **Add new script**, paste the code, and press `Ctrl+S` to save.

4. Navigate to the Console logs page (`/console/wrk_.../logs`). The panel appears above the logs table. Open the Go tab (`/console/wrk_.../go`) at least once so the script can capture your billing period and live limits (it auto-captures while you are on that tab).

## Usage

- On page load, the script restores the last saved totals and the billing period
- Click **Refresh totals** to fetch the current + previous billing period straight from the `request-logs` API (fast — no table pagination involved)
- Click **Reset** to clear stored data and rescan
- The **previous period** card may show a "partial" or "no logs available" note: the server only keeps logs for ~30 days (often less), so tip — refresh right after your reset day (e.g., the 18th) to snapshot the just-closed cycle while it is still retained

## Features

| Feature | Description |
|---|---|
| **Grand total** | Sum of all costs in USD |
| **By model** | Cost and tokens (in/out) grouped by AI model |
| **By day** | Spending aggregated by date |
| **Go limits** | Live progress bars for Continuous, Weekly, and Monthly usage |
| **30-day projection** | Estimates if current pace will exceed the monthly cap |
| **i18n** | Auto-detects browser language — panel in English or Portuguese |
| **Persistent cache** | Data survives page navigation and browser restarts (via GM_setValue) |
| **API-based scanning** | Fetches the full period from the `request-logs` API with cursor pagination — no table scraping |
| **Retention-aware** | Flags the previous period as partial (or empty) when server log retention no longer covers it |

## Compatibility

- Requires the OpenCode Console (`https://opencode.ai/console/wrk_...`)
- Tested on Chrome, Firefox, and Edge with Tampermonkey
- May work with Violentmonkey/Greasemonkey (not tested)

## License

MIT
