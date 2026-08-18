# MWI Market Observatory

Automated market data collection for [Milky Way Idle](https://www.milkywayidle.com/) marketplace.

## Overview

This repository automatically:
- **Fetches** market price data every ~30 minutes through cron-job.org-triggered GitHub Actions
- **Stores** hourly snapshots for 16 days (kept for comparison)
- **Aggregates** hourly data into daily OHLCV (Open, High, Low, Close, Volume) files, kept forever
- **Builds** public site data and icon manifests at build time
- **Deploys** the static site to GitHub Pages
- **Squashes** the data branch history so the repository stays small

The repository is split across **two branches** to keep history lean:

- **`main`** holds the code only: `site/`, `scripts/`, workflows, config. Clean, small, meaningful history.
- **`data`** holds the data only: `data/hourly/` (16-day window) and `data/daily/` (kept forever). Squashed to a single snapshot on every aggregate.

## Site

The website is available at [https://star-in-a-galaxy.github.io/mwi-market-observatory/](https://star-in-a-galaxy.github.io/mwi-market-observatory/)

## Data Source

Data is fetched from the public MWI marketplace API:
```
https://www.milkywayidle.com/game_data/marketplace.json
```

## Repository Structure

```
main (code)
├── .github/workflows/
│   ├── aggregate.yml          # Daily aggregate + prune + squash
│   ├── fetch.yml              # Fetches marketplace snapshots
│   └── pages.yml              # Builds and deploys site
├── scripts/
│   ├── aggregate.js           # Combine hourly files into daily OHLCV
│   ├── analyze.js             # Build public data bundles and icon manifests
│   ├── compute-arbitrage.js   # Compute flip/arbitrage opportunities
│   ├── fetch.js               # Fetch API, dedupe, write hourly file
│   ├── prune.js               # Delete hourly files older than 16 days
│   ├── serve.js               # Local static server
│   └── squash-data.js         # Collapse the data branch to one snapshot
└── site/                      # The page source (index.html, assets/, ...)

data (data branch)
└── data/
    ├── daily/                 # YYYY-MM-DD.json (kept forever)
    └── hourly/                # YYYY-MM-DD.json + YYYY-MM-DD/HH-MM.json (16 days)
```

`data/public/` is **derived** and not stored in the repo; it is regenerated at build time.

## Workflows

### fetch.yml (Every 30 Minutes)

Checks out the `data` branch, overlays the code from `main`, and runs `fetch.js`.

**Steps:**
1. Fetch marketplace data from the API
2. Deduplicate by API timestamp (skip if data hasn't changed)
3. Write hourly snapshot to `data/hourly/`
4. Commit and push to the `data` branch if data changed
5. Trigger a pages deploy **only if** new data was committed

### aggregate.yml (Daily)

Checks out the `data` branch, overlays the code from `main`.

**Steps:**
1. Read all hourly files from yesterday
2. Compute OHLCV for each item and enhancement level
3. Write daily summary to `data/daily/YYYY-MM-DD.json`
4. Prune hourly data older than 16 days
5. Collapse the `data` branch to a single snapshot commit (`squash-data.js`)
6. Force-push the `data` branch

### pages.yml (Build And Deploy Pages)

Combines `main` (code) and `data` (data) at build time.

**Steps:**
1. Check out `main`
2. Overlay `data/` from the `data` branch
3. Run `analyze.js` and `compute-arbitrage.js` to generate `data/public/`
4. Assemble `_site/` from `site/` + `data/public/` + `data/daily/`
5. Deploy to GitHub Pages

The UI is item-first: the home page is a searchable item browser and item pages live at `/items/<item_slug>`.

## Data Format

### Hourly File Structure

`data/hourly/YYYY-MM-DD.json` (consolidated) and `data/hourly/YYYY-MM-DD/HH-MM.json` (individual):
```json
{
  "timestamp": 1234567890,
  "fetchedAt": "2026-05-07T14:03:00Z",
  "data": {
    "/items/cheese": {
      "0": { "a": 100, "b": 90, "v": 5000 },
      "5": { "a": 105, "b": 95, "v": 4500 }
    }
  }
}
```

**Fields:**
- `a` = ask price
- `b` = bid price
- `v` = volume
- Enhancement level is the key (0, 5, etc.)

### Daily OHLCV File Structure

`data/daily/YYYY-MM-DD.json`:
```json
{
  "date": "2026-05-07",
  "items": {
    "/items/cheese": {
      "0": {
        "oa": 100, "ob": 90,   # Open ask/bid
        "ha": 110, "hb": 95,   # High ask/bid
        "la": 95, "lb": 85,    # Low ask/bid
        "ca": 105, "cb": 92,   # Close ask/bid
        "v": 5200              # Volume
      }
    }
  }
}
```

**Keys:**
- `oa` = open ask
- `ob` = open bid
- `ha` = high ask
- `hb` = high bid
- `la` = low ask
- `lb` = low bid
- `ca` = close ask
- `cb` = close bid
- `v` = volume

## Local Testing

The data lives on the `data` branch, so to test locally you need both branches. From a fresh clone:

```bash
# checkout the code
git checkout main
# overlay the data branch
git fetch origin data
git checkout FETCH_HEAD -- data
```

Then generate the public data and serve:

```bash
npm run analyze
npm run serve
```

Open:
- `http://localhost:4173/` for the item browser
- `http://localhost:4173/items/cursed_bow` for an item detail page

Optional refresh commands:
```bash
npm run fetch
npm run aggregate -- --date=2026-05-06
npm run prune
```

## License

MIT
