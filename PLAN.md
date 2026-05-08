 MWI Market Price Archival — GitHub Repo + Actions      

 Context

 Create a standalone GitHub repo that automatically fetches MWI market price data every ~40 minutes via GitHub Actions, stores hourly granularity for 7
 days, then aggregates into daily OHLCV files. Old hourly data gets pruned to keep the repo clean.

 Data source: https://www.milkywayidle.com/game_data/marketplace.json
 - No auth required
 - Response: { marketData: { "/items/foo": { 0: { a, b, v }, 5: { a, b, v } } }, timestamp }
 - Fields: a = ask, b = bid, v = volume, keyed by enhancement level

 ---
 Repo Structure

 mwi-market-archive/
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
 ├── package.json               # Node 20, no deps needed (native fetch)
 └── README.md

 ---
 Workflow: fetch.yml (every 40 min)

 name: Fetch Market Data
 on:
   schedule:
     - cron: '3,43 * * * *'   # :03 and :43 past each hour (avoids :00/:30)
   workflow_dispatch: {}        # Manual trigger

 jobs:
   fetch:
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v4
       - uses: actions/setup-node@v4
         with: { node-version: '20' }
       - run: node scripts/fetch.js
       - name: Commit if changed
         run: |
           git config user.name "github-actions[bot]"
           git config user.email "github-actions[bot]@users.noreply.github.com"
           git add data/hourly/
           git diff --cached --quiet || git commit -m "data: $(date -u +%Y-%m-%dT%H:%M)Z"
           git push

 ---
 Workflow: aggregate.yml (daily at 00:17 UTC)

 name: Daily Aggregate
 on:
   schedule:
     - cron: '17 0 * * *'
   workflow_dispatch: {}

 jobs:
   aggregate:
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v4
         with: { fetch-depth: 0 }
       - uses: actions/setup-node@v4
         with: { node-version: '20' }
       - run: node scripts/aggregate.js
       - run: node scripts/prune.js
       - name: Commit
         run: |
           git config user.name "github-actions[bot]"
           git config user.email "github-actions[bot]@users.noreply.github.com"
           git add data/
           git diff --cached --quiet || git commit -m "aggregate: $(date -u +%Y-%m-%d)"
           git push

 ---
 scripts/fetch.js

 1. Fetch https://www.milkywayidle.com/game_data/marketplace.json
 2. Extract marketData and timestamp
 3. Determine output path: data/hourly/YYYY-MM-DD/HH-MM.json
 4. Deduplication: Read last file in same day folder. If timestamp matches → exit (don't write). This handles Mooo's artificial delays where the API returns
  stale data.
 5. Write file:
 {
   "timestamp": 1234567890,
   "fetchedAt": "2026-05-07T14:03:00Z",
   "data": {
     "/items/cheese": { "0": { "a": 100, "b": 90, "v": 5000 } }
   }
 }

 ---
 scripts/aggregate.js

 For yesterday's date (or --date YYYY-MM-DD arg):
 1. Read all hourly files in data/hourly/YYYY-MM-DD/
 2. For each item + enhancement level, compute:
   - Open: first snapshot's ask/bid
   - High: max ask/bid across all snapshots
   - Low: min ask/bid across all snapshots (excluding negatives/null)
   - Close: last snapshot's ask/bid
   - Volume: last snapshot's volume (cumulative from game, so close-open = daily delta)
 3. Write to data/daily/YYYY-MM-DD.json:
 {
   "date": "2026-05-07",
   "items": {
     "/items/cheese": {
       "0": { "oa": 100, "ob": 90, "ha": 110, "hb": 95, "la": 95, "lb": 85, "ca": 105, "cb": 92, "v": 5200 }
     }
   }
 }
 3. Keys: oa=open ask, ob=open bid, ha=high ask, hb=high bid, la=low ask, lb=low bid, ca=close ask, cb=close bid, v=volume

 ---
 scripts/prune.js

 1. List directories in data/hourly/
 2. Delete any directory with a date older than 7 days
 3. Log pruned directories to stdout

 ---
 Design Decisions

 - Public repo → unlimited GitHub Actions minutes, data is already public
 - ~40 min interval (cron: '3,43 * * * *') → 2 fetches/hour at off-minutes; ~48 runs/day well within limits
 - Dedup by API timestamp → if API hasn't refreshed, skip commit; keeps git history clean
 - Compact keys in daily → oa/ob/ha/hb/la/lb/ca/cb/v to minimize file size at scale
 - No dependencies → Node 20 has native fetch and fs; zero install step
 - Hourly filenames HH-MM.json → supports multiple snapshots per hour without collision

 ---
 Verification

 1. Create repo, push initial structure
 2. workflow_dispatch on fetch.yml → confirm data/hourly/YYYY-MM-DD/HH-MM.json appears
 3. Trigger again → confirm dedup skips when timestamp matches
 4. workflow_dispatch on aggregate.yml → confirm data/daily/YYYY-MM-DD.json with OHLCV
 5. After 7+ days, confirm prune removes old hourly directories
