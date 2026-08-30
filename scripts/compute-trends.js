#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'public');
const ITEMS_DIR = path.join(DATA_DIR, 'items');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

const WINDOWS = [
  { key: '12h', label: '12 Hours', ms: 12 * 3600 * 1000 },
  { key: '24h', label: '24 Hours', ms: 24 * 3600 * 1000 },
  { key: '3d', label: '3 Days', ms: 3 * 24 * 3600 * 1000 },
  { key: '7d', label: '7 Days', ms: 7 * 24 * 3600 * 1000 },
  { key: '14d', label: '14 Days', ms: 14 * 24 * 3600 * 1000 },
  { key: '30d', label: '30 Days', ms: 30 * 24 * 3600 * 1000 },
];

const MIN_POINTS_IN_WINDOW = 3;

function pickPrice(ask, bid) {
  if (typeof ask === 'number' && ask > 0 && typeof bid === 'number' && bid > 0) {
    return (ask + bid) / 2;
  }
  return null;
}

function parsePoint(point) {
  let ts, ask, bid, vol;
  if (Array.isArray(point)) {
    [ts, ask, bid, vol] = point;
  } else if (point && typeof point === 'object') {
    ts = point.timestamp || point.t;
    ask = point.ask ?? point.a;
    bid = point.bid ?? point.b;
    vol = point.volume ?? point.v;
  }
  if (typeof ts !== 'number' || ts <= 0) return null;
  return {
    ts,
    ask,
    bid,
    vol: typeof vol === 'number' && vol > 0 ? vol : 0,
    price: pickPrice(ask, bid),
  };
}

function buildLevelSeries(levelData) {
  const dailyRaw = levelData.d || levelData.daily || [];
  const hourlyRaw = levelData.h || levelData.hourly || [];

  const series = [];
  for (const raw of [...dailyRaw, ...hourlyRaw]) {
    const point = parsePoint(raw);
    if (!point || point.price == null) continue;
    const last = series[series.length - 1];
    if (last && last.ts === point.ts) {
      series[series.length - 1] = point;
    } else {
      series.push(point);
    }
  }

  series.sort((a, b) => a.ts - b.ts);

  const deduped = [];
  for (const point of series) {
    const last = deduped[deduped.length - 1];
    if (last && last.ts === point.ts) {
      deduped[deduped.length - 1] = point;
    } else {
      deduped.push(point);
    }
  }

  return deduped;
}

function windowChange(series, windowMs, globalNow) {
  if (series.length < 2) return null;

  const current = series[series.length - 1];
  if (current.price == null || current.price <= 0) return null;

  const cutoff = globalNow - windowMs;
  if (current.ts <= cutoff) return null;

  let inWindow = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].ts <= cutoff) break;
    inWindow++;
  }
  if (inWindow < MIN_POINTS_IN_WINDOW) return null;

  let past = null;
  for (let i = series.length - 2; i >= 0; i--) {
    if (series[i].ts <= cutoff) {
      past = series[i];
      break;
    }
  }

  if (!past || past.price == null || past.price <= 0) return null;
  if (past.ts < cutoff - windowMs) return null;

  const pct = ((current.price - past.price) / past.price) * 100;
  if (!Number.isFinite(pct)) return null;

  return { pct, price: current.price, ts: current.ts };
}

function windowVolume(series, windowMs) {
  if (series.length === 0) return 0;
  const cutoff = series[series.length - 1].ts - windowMs;
  let vol = 0;
  for (const point of series) {
    if (point.ts > cutoff) vol += point.vol;
  }
  return vol;
}

function volChangePct(current, base) {
  if (base <= 0) return null;
  return Math.round(((current - base) / base) * 1000) / 10;
}

function dailyVolumeMetrics(levelData) {
  const dailyRaw = levelData.d || levelData.daily || [];
  const vols = [];
  for (const raw of dailyRaw) {
    let ts, v;
    if (Array.isArray(raw)) {
      [ts, , , v] = raw;
    } else if (raw && typeof raw === 'object') {
      ts = raw.timestamp || raw.t;
      v = raw.volume ?? raw.v;
    }
    if (typeof ts === 'number' && ts > 0 && typeof v === 'number' && v > 0) {
      vols.push({ ts, v });
    }
  }
  vols.sort((a, b) => a.ts - b.ts);
  if (vols.length === 0) return null;

  const lastDay = vols[vols.length - 1].v;
  const prevDay = vols.length > 1 ? vols[vols.length - 2].v : 0;
  const sum = (arr) => arr.reduce((acc, p) => acc + p.v, 0);
  const vol7d = sum(vols.slice(-7));
  const vol7dPrev = sum(vols.slice(-14, -7));

  return {
    vol1d: { vol: lastDay, pct: volChangePct(lastDay, prevDay) },
    vol7d: { vol: vol7d, pct: volChangePct(vol7d, vol7dPrev) },
  };
}

function computeTrends() {
  const t0 = Date.now();

  const indexData = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
  const slugToName = {};
  for (const item of indexData.items || []) {
    slugToName[item.slug] = item.name;
  }

  const fileList = fs.readdirSync(ITEMS_DIR).filter((f) => f.endsWith('.json'));
  console.log(`[trends] Scanning ${fileList.length} item files`);

  let latestDataTimestamp = 0;
  const items = [];

  for (const file of fileList) {
    let itemData;
    try {
      itemData = JSON.parse(fs.readFileSync(path.join(ITEMS_DIR, file), 'utf-8'));
    } catch {
      continue;
    }

    const slug = itemData.slug || file.replace('.json', '');
    const name = itemData.name || slugToName[slug] || slug.replace(/_/g, ' ');
    const levels = itemData.levels || ['0'];
    const data = itemData.data || {};

    const levelSeries = {};
    for (const level of levels) {
      const levelData = data[level];
      if (!levelData) continue;
      const series = buildLevelSeries(levelData);
      if (series.length > 0 && series[series.length - 1].ts > latestDataTimestamp) {
        latestDataTimestamp = series[series.length - 1].ts;
      }
      if (series.length < 2) continue;
      levelSeries[level] = series;
    }

    if (Object.keys(levelSeries).length === 0) continue;

    const levelsOut = {};
    for (const [level, series] of Object.entries(levelSeries)) {
      const windowOut = {};
      for (const window of WINDOWS) {
        const change = windowChange(series, window.ms, latestDataTimestamp);
        if (!change) continue;

        windowOut[window.key] = {
          pct: Math.round(change.pct * 100) / 100,
          price: Math.round(change.price),
          vol: Math.round(windowVolume(series, window.ms)),
        };
      }
      if (Object.keys(windowOut).length === 0) continue;

      const volMetrics = dailyVolumeMetrics(data[level]);
      levelsOut[level] = Object.assign(windowOut, volMetrics || {});
    }

    if (Object.keys(levelsOut).length === 0) continue;

    items.push({ slug, name, levels: levelsOut });
  }

  items.sort((a, b) => a.name.localeCompare(b.name));

  const output = {
    generatedAt: new Date(latestDataTimestamp || Date.now()).toISOString(),
    windows: WINDOWS.map((w) => ({ key: w.key, label: w.label, ms: w.ms })),
    itemCount: items.length,
    items,
  };

  const outputFile = path.join(DATA_DIR, 'trends.json');
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`[trends] Wrote ${outputFile} with ${items.length} items in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

computeTrends();