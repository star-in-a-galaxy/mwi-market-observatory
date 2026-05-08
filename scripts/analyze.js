#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
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

function buildPoint({ t, label, ask, bid, volume, previousAsk, previousBid }) {
  const sp = ask != null && bid != null ? ask - bid : null;
  const spPct = sp != null && bid > 0 ? sp / bid : null;
  const retA = ask != null && previousAsk != null && previousAsk > 0 ? (ask / previousAsk) - 1 : null;
  const retB = bid != null && previousBid != null && previousBid > 0 ? (bid / previousBid) - 1 : null;

  return {
    t,
    label,
    ask,
    bid,
    a: ask,
    b: bid,
    v: volume,
    sp,
    spPct,
    retA,
    retB,
  };
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

function loadHourlyFiles() {
  const hourlyDir = path.join('data', 'hourly');
  return listFilesRecursive(hourlyDir).sort();
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

function toSerializableBundle(bundle) {
  const levels = {};

  for (const [level, series] of bundle.levels.entries()) {
    levels[level] = {
      daily: series.daily,
      hourly: series.hourly,
    };
  }

  return {
    slug: bundle.slug,
    itemId: bundle.itemId,
    name: bundle.name,
    levels,
  };
}

function analyze() {
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
          previousAsk: previous?.ask,
          previousBid: previous?.bid,
        });

        point.timestamp = Date.parse(dateStr);
        appendPoint(series.daily, point);
      }
    }
  }

  for (const filePath of loadHourlyFiles()) {
    const hourly = readJson(filePath);
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
          previousAsk: previous?.ask,
          previousBid: previous?.bid,
        });

        point.timestamp = timestamp;
        appendPoint(series.hourly, point);
      }
    }
  }

  function addRollingVolumes(series, isHourly) {
    for (let i = 0; i < series.length; i++) {
      const point = series[i];
      if (!point.timestamp) continue;

      point.rolling = {};

      if (isHourly) {
        // Sum all snapshot volumes in the last 24 hours
        const windowMs = 24 * 60 * 60 * 1000;
        const cutoff = point.timestamp - windowMs;
        const volumeSum = series.slice(0, i + 1)
          .filter((p) => (p.timestamp || 0) > cutoff)
          .reduce((sum, p) => sum + (p.v || 0), 0);
        point.rolling['1d'] = volumeSum;
      } else {
        // Average the daily volumes over the available days (up to 7)
        const windowMs = 7 * 24 * 60 * 60 * 1000;
        const cutoff = point.timestamp - windowMs;
        const validPoints = series.slice(0, i + 1).filter((p) => (p.timestamp || 0) > cutoff);
        
        const volumeSum = validPoints.reduce((sum, p) => sum + (p.v || 0), 0);
        const daysAvailable = Math.max(1, validPoints.length); 
        
        point.rolling['7d'] = Math.round(volumeSum / daysAvailable);
      }
    }
  }

  for (const bundle of bundles.values()) {
    for (const series of bundle.levels.values()) {
      series.daily.sort((left, right) => Date.parse(left.t) - Date.parse(right.t));
      series.hourly.sort((left, right) => Date.parse(left.t) - Date.parse(right.t));
      addRollingVolumes(series.daily, false);
      addRollingVolumes(series.hourly, true);
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

  writeJson(path.join(publicDir, 'index.json'), {
    generatedAt,
    source: {
      dailyRange: earliestDaily && latestDaily ? { start: earliestDaily, end: latestDaily } : null,
      hourlyRange: earliestHourly && latestHourly ? { start: earliestHourly, end: latestHourly } : null,
    },
    items: itemIndex,
  });

  writeJson(path.join(publicDir, 'item-icons.json'), {
    generatedAt,
    iconFiles,
  });

  for (const bundle of bundles.values()) {
    writeJson(path.join(publicDir, 'items', `${bundle.slug}.json`), {
      generatedAt,
      slug: bundle.slug,
      itemId: bundle.itemId,
      name: bundle.name,
      levels: toSerializableBundle(bundle).levels,
    });
  }

  console.log(`[analyze] Wrote ${itemIndex.length} item bundles to ${publicDir}`);
}

analyze();