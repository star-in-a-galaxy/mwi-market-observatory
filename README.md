# MWI Market Observatory

Automated data collection and analytics for [Milky Way Idle](https://www.milkywayidle.com/) marketplace using GitHub Actions.

## Overview

This repository automatically:
- **Fetches** market price data every ~40 minutes via GitHub Actions
- **Stores** hourly snapshots for 7 days (kept for comparison)
- **Aggregates** hourly data into daily OHLCV (Open, High, Low, Close, Volume) files
- **Prunes** old hourly data to keep the repository clean

## Data Source

Data is fetched from the public MWI marketplace API:
```
https://www.milkywayidle.com/game_data/marketplace.json
```

No authentication is required.

## Repository Structure

```
mwi-market-observatory/
├── .github/
│   └── workflows/
│       ├── fetch.yml          # Runs every 40 min — fetch + commit
│       └── aggregate.yml      # Runs daily — aggregate hourly → daily, prune old hourly
├── scripts/
│   ├── fetch.js               # Fetch API, dedupe, write hourly file
│   ├── aggregate.js           # Combine hourly files into daily OHLCV
│   └── prune.js               # Delete hourly files older than 7 days
├── data/
│   ├── hourly/                # YYYY-MM-DD/HH-MM.json (kept for 7 days)
│   └── daily/                 # YYYY-MM-DD.json (kept forever)
├── package.json
└── README.md
```

## Workflows

### fetch.yml (Every 30 Minutes)

Runs at :10 and :40 past each hour (to avoid congestion at :00 and :30).

**Steps:**
1. Fetch marketplace data from the API
2. Deduplicate by API timestamp (skip if data hasn't changed)
3. Write hourly snapshot to `data/hourly/YYYY-MM-DD/HH-MM.json`
4. Commit and push if data changed

### aggregate.yml (Daily at 3:00 UTC)

**Steps:**
1. Read all hourly files from yesterday
2. Compute OHLCV for each item and enhancement level
3. Write daily summary to `data/daily/YYYY-MM-DD.json`
4. Prune hourly directories older than 7 days
5. Commit and push

### pages.yml (Branch-aware Pages pipeline)

This workflow supports your side-branch experiment flow:

1. Pushes to `web` build the static site artifact for validation, but do not deploy.
2. Pushes to `main` build and deploy to GitHub Pages.
3. Pull requests targeting `main` run build validation only.

The site source is in `site/`. The UI is item-first: the home page is a searchable item browser and item pages live at `/items/<item_slug>`.
During workflow execution, `data/daily/` and `data/public/` (if present) are copied into the deploy artifact.


## Data Format

### Hourly File Structure

`data/hourly/YYYY-MM-DD/HH-MM.json`:
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
- `v` = volume (last snapshot value)

## Local Testing

The item chart always uses hourly data. The selected range controls the total span shown, with options for 1 Day, 7 Days, 15 Days, 30 Days, 60 Days, 90 Days, and 120 Days.

Generate data for the site:
```bash
npm run aggregate
npm run analyze
```

Serve the site locally:
```bash
npm run serve
```

Then open:
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
