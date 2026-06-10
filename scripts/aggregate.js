#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function getYesterdayStr() {
  const today = new Date();
  today.setUTCDate(today.getUTCDate() - 1);
  return today.toISOString().split('T')[0];
}

function getDateStrDaysAgo(dateStr, daysAgo) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().split('T')[0];
}

function loadHourlySnapshots(dateStr) {
  const consolidatedFile = path.join('data', 'hourly', `${dateStr}.json`);
  if (fs.existsSync(consolidatedFile)) {
    const data = JSON.parse(fs.readFileSync(consolidatedFile, 'utf8'));
    const snapshots = data.snapshots || {};
    const keys = Object.keys(snapshots).sort();
    return keys.map(k => snapshots[k]);
  }

  const hourlyDir = path.join('data', 'hourly', dateStr);
  if (fs.existsSync(hourlyDir)) {
    const files = fs.readdirSync(hourlyDir).sort();
    return files.map(file => JSON.parse(fs.readFileSync(path.join(hourlyDir, file), 'utf8')));
  }

  return null;
}

function aggregate(dateStr) {
  const dailyFile = path.join('data', 'daily', `${dateStr}.json`);

  const snapshots = loadHourlySnapshots(dateStr);
  if (!snapshots || snapshots.length === 0) {
    console.log(`[aggregate] No hourly data for ${dateStr}, skipping`);
    return false;
  }

  const priorSnapshots = {};
  for (let d = 1; d < 7; d++) {
    const priorDate = getDateStrDaysAgo(dateStr, d);
    const prior = loadHourlySnapshots(priorDate);
    if (prior) priorSnapshots[priorDate] = prior;
  }

  const items = {};

  for (const data of snapshots) {
    const marketData = data.data;

    for (const itemId in marketData) {
      if (!items[itemId]) {
        items[itemId] = {};
      }

      for (const level in marketData[itemId]) {
        if (!items[itemId][level]) {
          items[itemId][level] = {
            snapshots: []
          };
        }

        items[itemId][level].snapshots.push(marketData[itemId][level]);
      }
    }
  }

  const result = {
    date: dateStr,
    items: {}
  };

  for (const itemId in items) {
    result.items[itemId] = {};

    for (const level in items[itemId]) {
      const daySnapshots = items[itemId][level].snapshots;
      const first = daySnapshots[0];
      const last = daySnapshots[daySnapshots.length - 1];

      const asks = daySnapshots.map(s => s.a);
      const bids = daySnapshots.map(s => s.b);

      const pricesWithVolume = daySnapshots
        .filter(s => typeof s.p === 'number' && s.p > 0 && typeof s.v === 'number' && s.v > 0)
        .map(s => ({ p: s.p, v: s.v }));

      const vp = pricesWithVolume.length > 0
        ? Math.round(pricesWithVolume.reduce((sum, s) => sum + s.p * s.v, 0)
          / pricesWithVolume.reduce((sum, s) => sum + s.v, 0))
        : null;

      const vwap = { p1d: vp, p3d: null, p7d: null };

      let p3dVol = 0;
      let p3dValue = 0;
      for (const data of [...snapshots]) {
        const lv = data.data?.[itemId]?.[level];
        if (lv && typeof lv.p === 'number' && lv.p > 0 && typeof lv.v === 'number' && lv.v > 0) {
          p3dVol += lv.v;
          p3dValue += lv.p * lv.v;
        }
      }
      for (let d = 1; d < 3; d++) {
        const priorDate = getDateStrDaysAgo(dateStr, d);
        for (const data of (priorSnapshots[priorDate] || [])) {
          const lv = data.data?.[itemId]?.[level];
          if (lv && typeof lv.p === 'number' && lv.p > 0 && typeof lv.v === 'number' && lv.v > 0) {
            p3dVol += lv.v;
            p3dValue += lv.p * lv.v;
          }
        }
      }
      if (p3dVol > 0) vwap.p3d = Math.round(p3dValue / p3dVol);

      let p7dVol = p3dVol;
      let p7dValue = p3dValue;
      for (let d = 3; d < 7; d++) {
        const priorDate = getDateStrDaysAgo(dateStr, d);
        for (const data of (priorSnapshots[priorDate] || [])) {
          const lv = data.data?.[itemId]?.[level];
          if (lv && typeof lv.p === 'number' && lv.p > 0 && typeof lv.v === 'number' && lv.v > 0) {
            p7dVol += lv.v;
            p7dValue += lv.p * lv.v;
          }
        }
      }
      if (p7dVol > 0) vwap.p7d = Math.round(p7dValue / p7dVol);

      result.items[itemId][level] = {
        oa: first.a,
        ob: first.b,
        ha: Math.max(...asks),
        hb: Math.max(...bids),
        la: Math.min(...asks.filter(a => a > 0)),
        lb: Math.min(...bids.filter(b => b > 0)),
        ca: last.a,
        cb: last.b,
        v: daySnapshots.reduce((sum, s) => sum + (s.v || 0), 0),
        vp,
        vwap
      };
    }
  }

  fs.mkdirSync(path.dirname(dailyFile), { recursive: true });
  fs.writeFileSync(dailyFile, JSON.stringify(result, null, 2));
  console.log(`[aggregate] Wrote ${dailyFile}`);
  return true;
}

function getAllDatesWithHourlyData() {
  const hourlyDir = path.join('data', 'hourly');
  if (!fs.existsSync(hourlyDir)) return [];

  const dates = [];
  const files = fs.readdirSync(hourlyDir);

  for (const file of files) {
    if (file.endsWith('.json')) {
      const dateStr = file.replace('.json', '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        dates.push(dateStr);
      }
    } else {
      const dirPath = path.join(hourlyDir, file);
      const stat = fs.statSync(dirPath);
      if (stat.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(file)) {
        dates.push(file);
      }
    }
  }

  return dates.sort().reverse();
}

function aggregateAllBackwards() {
  const dates = getAllDatesWithHourlyData();
  if (dates.length === 0) {
    console.log('[aggregate] No hourly data found');
    return;
  }

  console.log(`[aggregate] Found ${dates.length} dates with hourly data, processing backwards...`);

  let successCount = 0;
  let skipCount = 0;

  for (const dateStr of dates) {
    const result = aggregate(dateStr);
    if (result) {
      successCount++;
    } else {
      skipCount++;
    }
  }

  console.log(`[aggregate] Done! Processed: ${successCount}, Skipped: ${skipCount}`);
}

const args = process.argv.slice(2);
if (args.includes('--all-backwards')) {
  aggregateAllBackwards();
} else {
  const dateStr = args[0]?.match(/--date=(.+)/) ? args[0].match(/--date=(.+)/)[1] : getYesterdayStr();
  aggregate(dateStr);
}
