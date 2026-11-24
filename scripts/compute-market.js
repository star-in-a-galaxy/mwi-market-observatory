#!/usr/bin/env node
'use strict';

// Market page data: daily market turnover and a chained price index, for the whole
// market, per category and per top-N item tier, plus enhancement-level breakdowns.
// Reads data/daily/*.json, writes data/public/market.json.
// Usage: node scripts/compute-market.js [--daily-dir=<dir>] [--out=<file>]

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const DAILY_DIR = path.resolve(args['daily-dir'] || path.join(ROOT, 'data', 'daily'));
const OUT_FILE = path.resolve(args.out || path.join(ROOT, 'data', 'public', 'market.json'));
const CATEGORY_DIR = path.join(ROOT, 'site', 'assets', 'item_categories');
const ITEM_LEVELS_FILE = path.join(__dirname, 'data', 'item_levels.json');

const VERSION = 1;
const START = '2026-07-06'; // first Monday with complete daily data
const TIERS = [10, 30, 50, 100, 200, 0]; // top N items by turnover that day; 0 = all items
const CAP = 2; // a daily price relative is clamped to [1/CAP, CAP] so thin items can't swing the index
const PARTIAL_DAY = 0.7; // a day with fewer items traded than this share of its neighbours' median is treated as missing
const ITEM_TIERS = { all: () => true, early: (l) => l < 65, mid: (l) => l >= 65 && l < 95, end: (l) => l >= 95 };
const BANDS = [['0', 0, 0], ['1-5', 1, 5], ['6-9', 6, 9], ['10-12', 10, 12], ['13+', 13, Infinity]];

const DAY_MS = 864e5;
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);

function loadCategories() {
  const order = [];
  const categoryOf = {};
  for (const file of fs.readdirSync(CATEGORY_DIR).filter((f) => f.endsWith('.txt')).sort()) {
    const name = file.replace(/^\d+_|\.txt$/g, '');
    order.push(name);
    for (const line of fs.readFileSync(path.join(CATEGORY_DIR, file), 'utf8').split(/\r?\n/)) {
      const itemName = line.trim();
      if (itemName) categoryOf['/items/' + itemName.toLowerCase().replace(/[^a-z0-9]+/g, '_')] = name;
    }
  }
  return { order, categoryOf };
}

function loadDays(categoryOf) {
  const files = fs.readdirSync(DAILY_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(0, 10) >= START).sort();
  return files.map((file) => {
    const json = JSON.parse(fs.readFileSync(path.join(DAILY_DIR, file), 'utf8'));
    const entries = {};
    for (const [id, levels] of Object.entries(json.items || {})) {
      const cat = categoryOf[id] || 'other';
      for (const [lvl, x] of Object.entries(levels)) {
        // turnover of an item-level on a day: volume-weighted price x volume
        if (x && x.vp > 0 && x.v > 0) entries[id + '+' + lvl] = { id, lvl: +lvl, cat, p: x.vp, t: x.vp * x.v };
      }
    }
    return { date: json.date || file.slice(0, 10), entries };
  });
}

const median = (a) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };

// Chain-linked price index: each day, the turnover-weighted (previous day's turnover) average
// price relative of the entries traded on both days. Returns { date: index }.
function chainIndex(validDays, pick, topN = 0) {
  let index = 100;
  const out = { [validDays[0].date]: 100 };
  for (let i = 1; i < validDays.length; i++) {
    const a = validDays[i - 1].entries;
    const b = validDays[i].entries;
    let keys = Object.keys(a).filter((k) => b[k] && pick(a[k]));
    if (topN) keys = keys.sort((x, y) => a[y].t - a[x].t).slice(0, topN);
    const weight = keys.reduce((acc, k) => acc + a[k].t, 0);
    if (weight > 0) {
      let rel = 0;
      for (const k of keys) rel += (a[k].t / weight) * Math.min(Math.max(b[k].p / a[k].p, 1 / CAP), CAP);
      index *= rel;
    }
    out[validDays[i].date] = Math.round(index * 100) / 100;
  }
  return out;
}

function main() {
  if (!fs.existsSync(DAILY_DIR)) {
    console.error(`[market] no daily data at ${DAILY_DIR}`);
    process.exit(1);
  }
  const { order: categories, categoryOf } = loadCategories();
  const itemLevels = JSON.parse(fs.readFileSync(ITEM_LEVELS_FILE, 'utf8')).items;
  const days = loadDays(categoryOf);
  if (days.length < 8) {
    console.error(`[market] need at least 8 days of data since ${START}, found ${days.length}`);
    process.exit(1);
  }

  // calendar from START to the last day; missing and partial days become gaps (null)
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  const dates = [];
  for (let t = Date.parse(START + 'T00:00:00Z'); t <= Date.parse(days[days.length - 1].date + 'T00:00:00Z'); t += DAY_MS) dates.push(isoDay(t));
  const counts = days.map((d) => Object.keys(d.entries).length);
  const valid = {};
  days.forEach((d, i) => { valid[d.date] = counts[i] >= PARTIAL_DAY * median(counts.slice(Math.max(0, i - 7), i + 8)); });
  const gaps = dates.filter((d) => !byDate[d] || !valid[d]).map((d) => ({ date: d, reason: byDate[d] ? 'partial' : 'missing' }));
  const validDays = days.filter((d) => valid[d.date]);
  const dayAt = (date) => (valid[date] ? byDate[date] : null);

  const sumSeries = (pick) => dates.map((date) => {
    const d = dayAt(date);
    if (!d) return null;
    let s = 0;
    for (const x of Object.values(d.entries)) if (pick(x)) s += x.t;
    return Math.round(s);
  });
  const countSeries = (pick) => dates.map((date) => {
    const d = dayAt(date);
    return d ? Object.values(d.entries).filter(pick).length : null;
  });
  const indexSeries = (pick, topN) => { const m = chainIndex(validDays, pick, topN); return dates.map((d) => m[d] ?? null); };

  // whole market and categories, per top-N tier
  const hasOther = days.some((d) => Object.values(d.entries).some((x) => x.cat === 'other'));
  const scopeKeys = ['all', ...categories, ...(hasOther ? ['other'] : [])];
  const scopes = {};
  for (const scope of scopeKeys) {
    const pick = (x) => scope === 'all' || x.cat === scope;
    const sc = { turnover: {}, price: {}, count: countSeries(pick) };
    for (const n of TIERS) {
      const key = n ? 'top' + n : 'all';
      sc.turnover[key] = dates.map((date) => {
        const d = dayAt(date);
        if (!d) return null;
        const t = Object.values(d.entries).filter(pick).map((x) => x.t).sort((a, b) => b - a);
        return Math.round((n ? t.slice(0, n) : t).reduce((a, b) => a + b, 0));
      });
      sc.price[key] = indexSeries(pick, n);
    }
    scopes[scope] = sc;
  }

  // enhancement levels: enhanceable items only, by item level tier and enhancement band
  const unknown = new Set();
  const enh = { bands: BANDS.map((b) => b[0]), tiers: Object.keys(ITEM_TIERS), data: {} };
  for (const [tier, inTier] of Object.entries(ITEM_TIERS)) {
    enh.data[tier] = {};
    for (const [band, lo, hi] of [...BANDS, ['all', 0, Infinity]]) {
      const pick = (x) => {
        const level = itemLevels[x.id];
        if (level == null) { if (x.lvl > 0) unknown.add(x.id); return false; }
        return inTier(level) && x.lvl >= lo && x.lvl <= hi;
      };
      enh.data[tier][band] = { turnover: sumSeries(pick), price: indexSeries(pick, 0), count: countSeries(pick) };
    }
  }
  if (unknown.size) console.warn(`[market] enhanced but missing from item_levels.json (run update-item-levels.js): ${[...unknown].join(', ')}`);

  const out = { v: VERSION, generatedAt: new Date().toISOString(), dates, gaps, categories, tiers: TIERS, scopes, enh };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out));
  console.log(`[market] ${dates[0]}..${dates[dates.length - 1]}, ${validDays.length} valid days, ${gaps.length} gaps -> ${path.relative(process.cwd(), OUT_FILE)} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(0)} KB)`);
}

main();
