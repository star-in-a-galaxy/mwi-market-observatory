# MWI Market Observatory - Analysis Plan for Secondary Website

## Goal

Prepare market data into website-ready datasets and host an item-first secondary website via GitHub Pages.

## Can This Run on GitHub Hosting?

Yes. The secondary website can run on **GitHub Pages**.

Recommended setup:
- Keep this repo as the data + processing repo.
- Publish a static website from GitHub Actions.
- Use a root item list page and item detail pages at `/items/<item_slug>`.
- Serve precomputed JSON files so the browser does minimal processing.

## Inspiration

The important interaction pattern is:
- Start with a searchable item list.
- Open one item on its own page.
- Show a price graph by default.
- Allow switching the time window above the graph.
- Allow switching enhancement level above the graph when the item supports levels.

## Product Requirements for the Secondary Website

The website should provide:
- An item directory page with search and filtering.
- Item detail pages at `/items/<item_slug>`.
- A price graph on each item page.
- Hourly data as the chart source for every item page.
- Default range of the past 15 days.
- Switchable views such as 1 Day, 7 Days, 15 Days, 30 Days, 60 Days, 90 Days, and 120 Days.
- Enhancement-level selection above the graph when levels exist.
- Fast initial load with lightweight payloads.

## Data Available Today

Current inputs:
- Hourly snapshots: `data/hourly/YYYY-MM-DD/HH-MM.json`
- Daily OHLCV: `data/daily/YYYY-MM-DD.json`

Current fields:
- Hourly: `a`, `b`, `v`
- Daily: `oa`, `ob`, `ha`, `hb`, `la`, `lb`, `ca`, `cb`, `v`

## Analysis Outputs to Add

Create website-facing outputs under `data/public/`:

1. Catalog and metadata
- `data/public/catalog.json`
- Contains item IDs, enhancement levels, date ranges, and last update timestamp.

2. Item detail bundles
- `data/public/items/<item_slug>.json`
- Contains all enhancement levels and all chart points for one item.
- Example structure:
  - `slug`: `cursed_bow`
  - `name`: `Cursed Bow`
  - `levels`: `{ "0": { ... }, "5": { ... } }`
  - `levels[level].points[]`:
    - `t`: ISO date or timestamp bucket
    - `a`: ask
    - `b`: bid
    - `v`: volume
    - `sp`: spread (`a - b`)
    - `spPct`: spread percent (`sp / b`, when `b > 0`)
    - `retA`: ask return vs previous point
    - `retB`: bid return vs previous point
    - `range`: `12h`, `1d`, or `15d` view tag when helpful for prefiltering

3. Market summaries
- `data/public/summaries/top_movers.json`
- `data/public/summaries/top_volume.json`
- `data/public/summaries/widest_spreads.json`

4. UI index data
- `data/public/index.json`
- Contains item names, slugs, and level availability for the item browser page.

## Transform Rules

For each item + level:
- Sort by time ascending.
- Keep rows with valid positive prices.
- Compute:
  - `sp = a - b`
  - `spPct = sp / b` when `b > 0`, else `null`
  - `retA = (a_t / a_{t-1}) - 1` when prior value exists
  - `retB = (b_t / b_{t-1}) - 1` when prior value exists
- Derive chart windows for:
  - `1d`
  - `7d`
  - `15d`
  - `30d`
  - `60d`
  - `90d`
  - `120d`
- The graph should always use hourly data, and the selected range should only change the visible span.

## Data Quality Checks

Before publishing:
- Validate JSON parse for all input files.
- Ensure time order is monotonic in each output series.
- Filter invalid/non-positive prices from derived fields when needed.
- Handle missing buckets by leaving gaps (do not forward-fill by default).
- Emit a `generatedAt` UTC timestamp and source date range in each summary file.

## Processing Pipeline

Add a new script:
- `scripts/analyze.js`

Responsibilities:
- Read all files in `data/daily/`.
- Build in-memory map by item + level.
- Compute derived metrics.
- Write `data/public/` outputs.

Recommended `package.json` script:
- `"analyze": "node scripts/analyze.js"`

## GitHub Actions Integration

Integrate analysis into daily pipeline:

Option A (simple, preferred now):
- Update existing daily workflow to run:
  1. `node scripts/aggregate.js`
  2. `node scripts/prune.js`
  3. `node scripts/analyze.js`
  4. Commit `data/` changes

Option B (separate workflow):
- Trigger `analyze.yml` after aggregate workflow completes.

## GitHub Pages Deployment Plan

### Hosting Mode

Use GitHub Pages from **GitHub Actions** (modern, flexible).

### Suggested Site Structure

- `site/` (source for static site)
- `site/index.html` for item browsing
- `site/items/` for item detail routes
- `site/assets/*`
- `site/assets/app.js`

At build/deploy time, include `data/public/` as site assets so the UI fetches local JSON paths.
The build should generate per-item subpages so direct links like `/items/cursed_bow` work on GitHub Pages.

### Deployment Workflow

Create `.github/workflows/pages.yml`:
- Trigger on pushes to `main` (or after analysis workflow).
- Build step runs `node scripts/analyze.js` so the public item bundles are always fresh.
- Build step copies `site/` + `data/public/` to an output folder.
- The UI uses a 404 fallback route for `/items/<item_slug>`.
- Deploy with:
  - `actions/configure-pages@v5`
  - `actions/upload-pages-artifact@v3`
  - `actions/deploy-pages@v4`

Result:
- Site available at `https://<username>.github.io/<repo>/`.

## Performance Targets

- Keep initial payload under ~500 KB compressed.
- Split data by item and load only the selected item page.
- Use summary files for the item browser and rankings.
- Cache static JSON aggressively (`Cache-Control` is managed by Pages/CDN behavior).

## Proposed Milestones

1. Implement `scripts/analyze.js` and generate `data/public/`.
2. Add/extend workflow to run analysis daily.
3. Create an item browser and item detail page scaffolding in `site/`.
4. Add GitHub Pages deployment workflow.
5. Validate end-to-end: data refresh -> analysis output -> live Pages update.

## Definition of Done

- `data/public/` is generated automatically in Actions.
- GitHub Pages site is live and loads data without manual steps.
- Item browser page lists all items.
- Item detail pages at `/items/<item_slug>` render an hourly graph with a default 15 day window.
- Enhancement selector appears when item levels exist.
- Time window selector supports 1 Day, 7 Days, 15 Days, 30 Days, 60 Days, 90 Days, and 120 Days.
- New daily data appears on the website within one daily pipeline cycle.

## Local Testing

1. Run `npm run aggregate` to build the daily OHLCV files from hourly snapshots.
2. Run `npm run analyze` to generate `data/public/`.
3. Run `npm run serve` to open the local site.
4. Visit `http://localhost:4173/` and then a detail page like `http://localhost:4173/items/cursed_bow`.
