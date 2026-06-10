#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function getYesterdayStr() {
  const today = new Date();
  today.setUTCDate(today.getUTCDate() - 1);
  return today.toISOString().split('T')[0];
}

function loadHourlySnapshots(dateStr) {
  // Prefer new consolidated format: data/hourly/YYYY-MM-DD.json
  const consolidatedFile = path.join('data', 'hourly', `${dateStr}.json`);
  if (fs.existsSync(consolidatedFile)) {
    const data = JSON.parse(fs.readFileSync(consolidatedFile, 'utf8'));
    const snapshots = data.snapshots || {};
    const keys = Object.keys(snapshots).sort();
    return keys.map(k => snapshots[k]);
  }
  
  // Fallback to old format: data/hourly/YYYY-MM-DD/*.json (transition period)
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
    return;
  }
  
  // Aggregate: For each item + enhancement level, compute OHLCV
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
  
  // Compute OHLCV for each item + level
  const result = {
    date: dateStr,
    items: {}
  };
  
  for (const itemId in items) {
    result.items[itemId] = {};
    
    for (const level in items[itemId]) {
      const snapshots = items[itemId][level].snapshots;
      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      
      const asks = snapshots.map(s => s.a);
      const bids = snapshots.map(s => s.b);
      
      const pricesWithVolume = snapshots
        .filter(s => typeof s.p === 'number' && s.p > 0 && typeof s.v === 'number' && s.v > 0)
        .map(s => ({ p: s.p, v: s.v }));

      const vp = pricesWithVolume.length > 0
        ? Math.round(pricesWithVolume.reduce((sum, s) => sum + s.p * s.v, 0)
          / pricesWithVolume.reduce((sum, s) => sum + s.v, 0))
        : null;

      result.items[itemId][level] = {
        oa: first.a,
        ob: first.b,
        ha: Math.max(...asks),
        hb: Math.max(...bids),
        la: Math.min(...asks.filter(a => a > 0)),
        lb: Math.min(...bids.filter(b => b > 0)),
        ca: last.a,
        cb: last.b,
        v: snapshots.reduce((sum, s) => sum + (s.v || 0), 0),
        vp
      };
    }
  }
  
  fs.mkdirSync(path.dirname(dailyFile), { recursive: true });
  fs.writeFileSync(dailyFile, JSON.stringify(result, null, 2));
  console.log(`[aggregate] Wrote ${dailyFile}`);
}

const dateStr = process.argv[2]?.match(/--date=(.+)/) ? process.argv[2].match(/--date=(.+)/)[1] : getYesterdayStr();
aggregate(dateStr);
