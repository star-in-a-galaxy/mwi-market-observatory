#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'public');
const ITEMS_DIR = path.join(DATA_DIR, 'items');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const CAT_DIR = path.join(__dirname, '..', 'site', 'assets', 'item_categories');

const WINDOW_PRESETS = [1, 3, 5, 7, 14];

const CATEGORY_FILES = [
  { file: '01_resources.txt', label: 'Resources' },
  { file: '02_consumables.txt', label: 'Consumables' },
  { file: '03_books.txt', label: 'Books' },
  { file: '04_labyrinth.txt', label: 'Labyrinth' },
  { file: '05_keys.txt', label: 'Keys' },
  { file: '06_equipment.txt', label: 'Equipment' },
  { file: '07_accessories.txt', label: 'Accessories' },
  { file: '08_tools.txt', label: 'Tools' },
];

const PRICE_TIERS = [
  [50, 1], [100, 2], [300, 5], [500, 10], [1000, 20], [3000, 50], 
  [5000, 100], [10000, 200], [30000, 500], [50000, 1000], [100000, 2000], [300000, 5000], 
  [500000, 10000], [1000000, 20000],  [3000000, 50000], [5000000, 100000], [10000000, 200000], [30000000, 500000],
  [50000000, 1000000], [100000000, 2000000], [300000000, 5000000], [500000000, 10000000], [1000000000, 20000000], [3000000000, 50000000],
  [5000000000, 100000000], [10000000000, 200000000], [30000000000, 500000000], [50000000000, 1000000000], [100000000000, 2000000000]
];

const MARKET_TAX_RATE = 0.02;
const MIN_SNAPSHOTS = 6;
const MIN_VOLUME = 10;
const MIN_FILL_CONFIDENCE = 0.3;

function getPriceStep(price) {
  for (const [maxPrice, step] of PRICE_TIERS) {
    if (price <= maxPrice) return step;
  }
  return PRICE_TIERS[PRICE_TIERS.length - 1][1];
}

function snapAsk(price) {
  const step = getPriceStep(price);
  return Math.floor(price / step) * step;
}

function snapBid(price) {
  const step = getPriceStep(price);
  return Math.ceil(price / step) * step;
}

function flipProfit(ask, bid) {
  const validAsk = snapAsk(ask);
  const validBid = snapBid(bid);
  const tax = Math.max(1, Math.floor(validAsk * MARKET_TAX_RATE));
  return validAsk - tax - validBid;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function computeTemporalMetrics(snaps) {
  if (snaps.length < 8) return null;

  const asks = snaps.map(s => snapAsk(s.ask));
  const bids = snaps.map(s => snapBid(s.bid));

  const meanAsk = asks.reduce((a, b) => a + b, 0) / asks.length;
  const meanBid = bids.reduce((a, b) => a + b, 0) / bids.length;

  const varAsk = asks.reduce((a, v) => a + (v - meanAsk) ** 2, 0) / asks.length;
  const varBid = bids.reduce((a, v) => a + (v - meanBid) ** 2, 0) / bids.length;
  const stdAsk = Math.sqrt(varAsk);
  const stdBid = Math.sqrt(varBid);

  const cur = snaps[snaps.length - 1];
  const curAsk = snapAsk(cur.ask);
  const curBid = snapBid(cur.bid);

  const askZ = stdAsk > 0 ? (curAsk - meanAsk) / stdAsk : 0;
  const bidZ = stdBid > 0 ? (curBid - meanBid) / stdBid : 0;
  const spreadZ = askZ - bidZ;

  let signal = '';
  if (bidZ < -1 && askZ > 1) signal = 'flip';
  else if (bidZ < -1) signal = 'buy';
  else if (askZ > 1) signal = 'sell';

  return {
    askZ: Math.round(askZ * 100) / 100,
    bidZ: Math.round(bidZ * 100) / 100,
    spreadZ: Math.round(spreadZ * 100) / 100,
    signal,
  };
}

function loadCategories() {
  const slugToCat = {};
  for (let i = 0; i < CATEGORY_FILES.length; i++) {
    const filePath = path.join(CAT_DIR, CATEGORY_FILES[i].file);
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, 'utf-8');
    for (const line of text.split('\n')) {
      const name = line.trim().toLowerCase().replace(/\s+/g, '_');
      if (name) slugToCat[name] = i;
    }
  }
  return slugToCat;
}

function computeItemArbitrage(hourlySnapshots, dailyVolume, minVolume) {
  const validSnaps = hourlySnapshots.filter(s => {
    if (s.ask == null || s.ask <= 0 || s.bid == null || s.bid <= 0) return false;
    if (s.vol != null && s.vol < minVolume) return false;
    return true;
  });

  if (validSnaps.length < MIN_SNAPSHOTS) return null;

  const profits = validSnaps.map(s => flipProfit(s.ask, s.bid));
  profits.sort((a, b) => a - b);

  const p25 = percentile(profits, 0.25);
  const p50 = percentile(profits, 0.50);
  const p75 = percentile(profits, 0.75);

  if (p25 <= 0) return null;

  const p25Snaps = validSnaps.filter(s => flipProfit(s.ask, s.bid) >= p25);
  const entryBids = p25Snaps.map(s => snapBid(s.bid)).sort((a, b) => a - b);
  const exitAsks = p25Snaps.map(s => snapAsk(s.ask)).sort((a, b) => a - b);
  const p25EntryBid = entryBids[Math.floor(entryBids.length * 0.5)];
  const p25ExitAsk = exitAsks[Math.floor(exitAsks.length * 0.5)];

  const roiValues = validSnaps.map(s => {
    const cost = snapBid(s.bid);
    return cost > 0 ? flipProfit(s.ask, s.bid) / cost : 0;
  });
  const meanROI = roiValues.reduce((a, b) => a + b, 0) / roiValues.length;
  const downsideVar = roiValues.reduce((a, r) => a + (r < meanROI ? (r - meanROI) ** 2 : 0), 0) / roiValues.length;
  const downsideStddev = Math.sqrt(downsideVar);
  const reliability = meanROI > 0 ? Math.max(0, Math.min(1, 1 - (downsideStddev / meanROI))) : 0;

  const fillable = p25Snaps.filter(s => s.vol >= minVolume);
  const fillConfidence = fillable.length / Math.max(validSnaps.length, 1);

  if (fillConfidence < MIN_FILL_CONFIDENCE) return null;

  const hourlyBuckets = {};
  for (const s of validSnaps) {
    const d = new Date(s.timestamp);
    const hour = d.getUTCHours();
    if (!hourlyBuckets[hour]) hourlyBuckets[hour] = [];
    hourlyBuckets[hour].push(flipProfit(s.ask, s.bid));
  }
  let bestHour = null;
  let bestMean = -Infinity;
  for (const [hour, arr] of Object.entries(hourlyBuckets)) {
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    if (m > bestMean) { bestMean = m; bestHour = hour; }
  }

  const volSnaps = validSnaps.filter(s => s.vol > 0);
  const meanVol = volSnaps.length > 0 ? volSnaps.reduce((a, s) => a + s.vol, 0) / volSnaps.length : 0;
  const est24hVol = dailyVolume || Math.round(meanVol * 24);

  if (est24hVol < minVolume * 24) return null;

  const p25Spread = percentile(
    validSnaps.map(s => s.ask - s.bid).sort((a, b) => a - b),
    0.25
  );

  const p25ROI = (p25 / p25EntryBid || 1) * 100;

  const temporal = computeTemporalMetrics(validSnaps);

  return {
    profit: {
      p25: Math.round(p25),
      p50: Math.round(p50),
      p75: Math.round(p75),
    },
    spread: Math.round(p25Spread),
    roi: {
      p25: Math.round(p25ROI * 10) / 10,
    },
    prices: {
      entryBid: p25EntryBid,
      exitAsk: p25ExitAsk,
      tax: Math.max(1, Math.floor(p25ExitAsk * MARKET_TAX_RATE)),
    },
    reliability: Math.round(reliability * 1000) / 1000,
    fillConfidence: Math.round(fillConfidence * 1000) / 1000,
    vol24h: Math.round(est24hVol),
    bestHour: bestHour ? `${bestHour}:00` : null,
    snapCount: validSnaps.length,
    temporal,
  };
}

function computeArbitrage(windowDays) {
  const minVol = MIN_VOLUME;

  const t0 = Date.now();
  console.log(`[arbitrage] Computing: window=${windowDays}d, minVol=${minVol}`);

  const indexData = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
  const items = indexData.items || [];
  const slugToName = {};
  for (const item of items) {
    slugToName[item.slug] = item.name;
  }

  const slugToCat = loadCategories();

  const fileList = fs.readdirSync(ITEMS_DIR).filter(f => f.endsWith('.json'));
  console.log(`[arbitrage] Scanning ${fileList.length} item files`);

  const now = Date.now();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const cutoff = now - windowMs;

  const allResults = [];
  let skipLowSnap = 0, skipNoProfit = 0, skipLowVol = 0, skipLowFill = 0, noLevelData = 0;

  for (const file of fileList) {
    const filePath = path.join(ITEMS_DIR, file);
    let itemData;
    try {
      itemData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      continue;
    }

    const slug = itemData.slug || file.replace('.json', '');
    const name = itemData.name || slugToName[slug] || slug.replace(/_/g, ' ');
    const levels = itemData.levels || ['0'];
    const data = itemData.data || {};

    const catIdx = typeof slugToCat[slug] === 'number' ? slugToCat[slug] : -1;

    for (const level of levels) {
      const levelData = data[level];
      if (!levelData) { noLevelData++; continue; }

      const hourlyRaw = levelData.h || levelData.hourly || [];
      const dailyRaw = levelData.d || levelData.daily || [];

      const hourlySnaps = [];
      for (const point of hourlyRaw) {
        let ts, ask, bid, vol;
        if (Array.isArray(point)) {
          [ts, ask, bid, vol] = point;
        } else if (point && typeof point === 'object') {
          ts = point.timestamp || point.t;
          ask = point.ask || point.a;
          bid = point.bid || point.b;
          vol = point.volume || point.v;
        }
        if (typeof ts !== 'number' || ts <= cutoff) continue;
        if (typeof ask !== 'number' || ask <= 0) continue;
        if (typeof bid !== 'number' || bid <= 0) continue;
        hourlySnaps.push({ timestamp: ts, ask, bid, vol: vol || 0 });
      }

      if (hourlySnaps.length < MIN_SNAPSHOTS) { skipLowSnap++; continue; }

      let dailyVolume = 0;
      for (const point of dailyRaw) {
        let v;
        if (Array.isArray(point)) {
          v = point[3];
        } else if (point && typeof point === 'object') {
          v = point.volume || point.v;
        }
        if (typeof v === 'number' && v > 0) dailyVolume += v;
      }

      const result = computeItemArbitrage(hourlySnaps, dailyVolume, minVol);
      if (!result) {
        if (dailyVolume < minVol * 24 && hourlySnaps.reduce((s, x) => s + x.vol, 0) < minVol * 24) {
          skipLowVol++;
        } else {
          skipNoProfit++;
        }
        continue;
      }

      allResults.push({
        slug,
        name,
        catIdx,
        level: parseInt(level),
        ...result,
      });
    }
  }

  const totalSkipped = skipLowSnap + skipNoProfit + skipLowVol + skipLowFill;
  console.log(`[arbitrage] Results: ${allResults.length} tradeable / ${totalSkipped} skipped`);
  console.log(`[arbitrage]   Skips: low_snap=${skipLowSnap}, no_profit=${skipNoProfit}, low_vol=${skipLowVol}, no_data=${noLevelData}`);

  if (allResults.length === 0) {
    const output = {
      generatedAt: new Date().toISOString(),
      windowDays,
      itemCount: 0,
      items: [],
    };
    const outputFile = path.join(DATA_DIR, `arbitrage-${windowDays}d.json`);
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
    console.log(`[arbitrage] Written ${outputFile} (no tradeable items) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return;
  }

  const rawScores = allResults.map(r => (r.roi.p25 / 100) * r.reliability * r.fillConfidence);
  const maxRaw = Math.max(...rawScores, 0.001);

  for (let i = 0; i < allResults.length; i++) {
    allResults[i].score = Math.round(1000 * rawScores[i] / maxRaw) / 1000;
  }

  allResults.sort((a, b) => b.score - a.score);

  const catCounts = {};
  for (const r of allResults) {
    const cat = r.catIdx >= 0 ? CATEGORY_FILES[r.catIdx]?.label || 'Other' : 'Uncategorized';
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  }

  const top = allResults.slice(0, 5);
  console.log(`[arbitrage] ${windowDays}d Top ${top.length}:`);
  for (const r of top) {
    const cat = r.catIdx >= 0 ? CATEGORY_FILES[r.catIdx]?.label || '?' : '?';
    console.log(`  #${top.indexOf(r) + 1} ${r.name}+${r.level} [${cat}] score=${r.score} roi=${r.roi.p25}% rel=${r.reliability} fill=${r.fillConfidence} vol=${r.vol24h}`);
  }

  console.log(`[arbitrage] By category: ${Object.entries(catCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`);

  const output = {
    generatedAt: new Date().toISOString(),
    windowDays,
    itemCount: allResults.length,
    items: allResults,
  };

  const outputFile = path.join(DATA_DIR, `arbitrage-${windowDays}d.json`);
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`[arbitrage] Written ${outputFile} with ${allResults.length} items in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

const args = process.argv.slice(2);
const daysArg = args.find(a => a.startsWith('--days='));
if (daysArg) {
  const days = parseInt(daysArg.split('=')[1]);
  computeArbitrage(days);
} else {
  for (const days of WINDOW_PRESETS) {
    computeArbitrage(days);
  }
}