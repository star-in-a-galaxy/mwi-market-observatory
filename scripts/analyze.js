#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { computeAllVwaps } = require('./lib/vwap');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeJsonAsync(filePath, value) {
  const dir = path.dirname(filePath);
  return fs.promises.mkdir(dir, { recursive: true }).then(() =>
    fs.promises.writeFile(filePath, JSON.stringify(value, null, 2))
  );
}

function slugFromItemId(itemId) {
  return itemId.replace(/^\/items\//, '').replaceAll('/', '_');
}

function titleFromSlug(slug) {
  return slug
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDayLabel(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  });
}

function formatHourLabel(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  });
}

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function buildPoint({ t, label, ask, bid, volume, price, previousAsk, previousBid }) {
  return {
    t,
    ask,
    bid,
    a: ask,
    b: bid,
    v: volume,
    p: price,
  };
}

function serializeSeriesPoint(point) {
  return [point.timestamp, point.ask, point.bid, point.v, point.p];
}

function getTrailingDailySeries(series, limit = 120) {
  if (!Array.isArray(series) || limit <= 0) {
    return [];
  }

  return series.slice(-limit);
}

function appendPoint(series, point) {
  if (!point || (!point.ask && !point.bid)) {
    return;
  }

  const last = series[series.length - 1];
  if (last && last.t === point.t) {
    series[series.length - 1] = point;
    return;
  }

  series.push(point);
}

function listFilesRecursive(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const results = [];

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      results.push(fullPath);
    }
  }

  return results;
}

function loadDailyFiles() {
  const dailyDir = path.join('data', 'daily');
  const files = fs.existsSync(dailyDir)
    ? fs.readdirSync(dailyDir)
        .filter((file) => file.endsWith('.json') && file !== 'index.json')
        .sort()
    : [];

  return files.map((file) => path.join(dailyDir, file));
}

function loadHourlySnapshots() {
  const hourlyDir = path.join('data', 'hourly');
  const snapshots = [];

  // Prefer new consolidated format: data/hourly/*.json (top-level daily files)
  if (fs.existsSync(hourlyDir)) {
    const entries = fs.readdirSync(hourlyDir).sort();
    const consolidatedFiles = entries.filter(e => e.endsWith('.json') && fs.statSync(path.join(hourlyDir, e)).isFile());
    
    if (consolidatedFiles.length > 0) {
      for (const file of consolidatedFiles) {
        const dailyData = JSON.parse(fs.readFileSync(path.join(hourlyDir, file), 'utf8'));
        const daySnapshots = dailyData.snapshots || {};
        const keys = Object.keys(daySnapshots).sort();
        for (const key of keys) {
          snapshots.push(daySnapshots[key]);
        }
      }
      return snapshots;
    }
  }

  // Fallback to old format: recursive directory listing (transition period)
  const oldFiles = listFilesRecursive(hourlyDir).sort();
  for (const filePath of oldFiles) {
    snapshots.push(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  }
  return snapshots;
}

function loadItemIconFiles() {
  const iconDir = path.join('site', 'assets', 'item_icons');
  const iconFiles = {};

  if (!fs.existsSync(iconDir)) {
    return iconFiles;
  }

  const entries = fs.readdirSync(iconDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const extension = path.extname(entry.name).slice(1).toLowerCase();
    if (!extension) {
      continue;
    }

    const slug = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
    if (!iconFiles[slug]) {
      iconFiles[slug] = {};
    }

    const currentName = iconFiles[slug][extension];
    const exactLowercaseName = `${slug}.${extension}`;
    if (!currentName || entry.name === exactLowercaseName) {
      iconFiles[slug][extension] = entry.name;
    }
  }

  return iconFiles;
}

function ensureBundle(bundles, itemId) {
  const slug = slugFromItemId(itemId);
  if (!bundles.has(slug)) {
    bundles.set(slug, {
      slug,
      itemId,
      name: titleFromSlug(slug),
      levels: new Map(),
    });
  }

  return bundles.get(slug);
}

function ensureLevel(bundle, level) {
  if (!bundle.levels.has(level)) {
    bundle.levels.set(level, {
      daily: [],
      hourly: [],
    });
  }

  return bundle.levels.get(level);
}

async function analyze() {
  const generatedAt = new Date().toISOString();
  const bundles = new Map();
  const itemIndex = [];
  let earliestDaily = null;
  let latestDaily = null;
  let earliestHourly = null;
  let latestHourly = null;

  for (const filePath of loadDailyFiles()) {
    const daily = readJson(filePath);
    const dateStr = daily.date || path.basename(filePath, '.json');

    if (!earliestDaily || dateStr < earliestDaily) {
      earliestDaily = dateStr;
    }
    if (!latestDaily || dateStr > latestDaily) {
      latestDaily = dateStr;
    }

    const items = daily.items || {};
    for (const [itemId, levels] of Object.entries(items)) {
      const bundle = ensureBundle(bundles, itemId);
      const levelEntries = Object.entries(levels || {});

      for (const [level, levelData] of levelEntries) {
        const series = ensureLevel(bundle, level);
        const previous = series.daily[series.daily.length - 1];
        const point = buildPoint({
          t: dateStr,
          label: formatDayLabel(dateStr),
          ask: safeNumber(levelData.ca),
          bid: safeNumber(levelData.cb),
          volume: safeNumber(levelData.v),
          price: safeNumber(levelData.vp),
          previousAsk: previous?.ask,
          previousBid: previous?.bid,
        });

        point.timestamp = Date.parse(dateStr);
        appendPoint(series.daily, point);
      }
    }
  }

  const allHourlySnapshots = loadHourlySnapshots();

  for (const hourly of allHourlySnapshots) {
    const fetchedAt = hourly.fetchedAt || new Date((hourly.timestamp || 0) * 1000).toISOString();
    const timestamp = Date.parse(fetchedAt) || (hourly.timestamp ? hourly.timestamp * 1000 : 0);

    if (!earliestHourly || fetchedAt < earliestHourly) {
      earliestHourly = fetchedAt;
    }
    if (!latestHourly || fetchedAt > latestHourly) {
      latestHourly = fetchedAt;
    }

    const items = hourly.data || {};
    for (const [itemId, levels] of Object.entries(items)) {
      const bundle = ensureBundle(bundles, itemId);
      const levelEntries = Object.entries(levels || {});

      for (const [level, levelData] of levelEntries) {
        const series = ensureLevel(bundle, level);
        const previous = series.hourly[series.hourly.length - 1];
        const point = buildPoint({
          t: fetchedAt,
          label: formatHourLabel(fetchedAt),
          ask: safeNumber(levelData.a),
          bid: safeNumber(levelData.b),
          volume: safeNumber(levelData.v),
          price: safeNumber(levelData.p),
          previousAsk: previous?.ask,
          previousBid: previous?.bid,
        });

        point.timestamp = timestamp;
        appendPoint(series.hourly, point);
      }
    }
  }

  for (const bundle of bundles.values()) {
    for (const series of bundle.levels.values()) {
      series.daily.sort((left, right) => Date.parse(left.t) - Date.parse(right.t));
      series.hourly.sort((left, right) => Date.parse(left.t) - Date.parse(right.t));
    }

    for (const [level, series] of bundle.levels.entries()) {
      series.vwap = { p1d: null, p3d: null, p7d: null };

      const timedPoints = series.hourly
        .filter(p => p.timestamp > 0 && typeof p.p === 'number' && p.p > 0 && typeof p.v === 'number' && p.v > 0)
        .map(p => ({ ts: p.timestamp, p: p.p, v: p.v }));

      if (timedPoints.length > 0) {
        const latestTs = timedPoints[timedPoints.length - 1].ts;
        const windows = { p1d: 24 * 3600 * 1000, p3d: 72 * 3600 * 1000, p7d: 7 * 24 * 3600 * 1000 };

        for (const [key, windowMs] of Object.entries(windows)) {
          const cutoff = latestTs - windowMs;
          let totalVol = 0;
          let totalValue = 0;
          for (let i = timedPoints.length - 1; i >= 0; i--) {
            const p = timedPoints[i];
            if (p.ts <= cutoff) break;
            totalVol += p.v;
            totalValue += p.p * p.v;
          }
          series.vwap[key] = totalVol > 0 ? Math.round(totalValue / totalVol) : null;
        }
      }
    }

    itemIndex.push({
      slug: bundle.slug,
      itemId: bundle.itemId,
      name: bundle.name,
      levels: Array.from(bundle.levels.keys()).sort((left, right) => Number(left) - Number(right)),
    });
  }

  itemIndex.sort((left, right) => left.name.localeCompare(right.name));

  const publicDir = path.join('data', 'public');
  fs.mkdirSync(publicDir, { recursive: true });

  const iconFiles = loadItemIconFiles();
  const writePromises = [];

  // Slim index: only slug and name for homepage search, no itemId or levels
  writePromises.push(writeJsonAsync(path.join(publicDir, 'index.json'), {
    generatedAt,
    source: {
      dailyRange: earliestDaily && latestDaily ? { start: earliestDaily, end: latestDaily } : null,
      hourlyRange: earliestHourly && latestHourly ? { start: earliestHourly, end: latestHourly } : null,
    },
    iconFiles,
    items: itemIndex.map((item) => ({ slug: item.slug, name: item.name })),
  }));

  for (const bundle of bundles.values()) {
    const data = {};

    for (const [level, series] of bundle.levels.entries()) {
      data[level] = {
        d: getTrailingDailySeries(series.daily).map(serializeSeriesPoint),
        h: series.hourly.map(serializeSeriesPoint),
        vwap: series.vwap,
      };
    }

    writePromises.push(writeJsonAsync(path.join(publicDir, 'items', `${bundle.slug}.json`), {
      generatedAt,
      v: 2,
      slug: bundle.slug,
      itemId: bundle.itemId,
      name: bundle.name,
      levels: Array.from(bundle.levels.keys()).sort((left, right) => Number(left) - Number(right)),
      data,
    }));
  }

  await Promise.all(writePromises);
  console.log(`[analyze] Wrote ${itemIndex.length} item bundles to ${publicDir}`);

  const vwapMap = computeAllVwaps(allHourlySnapshots);
  writeVwapsToLatestHourly(vwapMap);
}

function writeVwapsToLatestHourly(vwapMap) {
  const hourlyDir = path.join('data', 'hourly');
  if (!fs.existsSync(hourlyDir)) return;

  const entries = fs.readdirSync(hourlyDir).sort();
  const consolidatedFiles = entries.filter(e => e.endsWith('.json') && fs.statSync(path.join(hourlyDir, e)).isFile());
  if (consolidatedFiles.length === 0) return;

  const latestFile = path.join(hourlyDir, consolidatedFiles[consolidatedFiles.length - 1]);
  const data = JSON.parse(fs.readFileSync(latestFile, 'utf8'));

  data.vwap = vwapMap;

  fs.writeFileSync(latestFile, JSON.stringify(data, null, 2));
  console.log(`[analyze] Wrote VWAP to ${latestFile}`);
}

analyze().catch(console.error);