#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const MARKETPLACE_URL = 'https://www.milkywayidle.com/game_data/marketplace.json';
const MARKET_VALUES_URL = 'https://www.milkywayidle.com/game_data/market_values.json';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

async function fetchMarketData() {
  console.log(`[fetch] Fetching ${MARKETPLACE_URL}`);
  const response = await globalThis.fetch(MARKETPLACE_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const json = await response.json();
  const { marketData, timestamp } = json;

  if (!marketData || !timestamp) {
    throw new Error('Invalid response: missing marketData or timestamp');
  }

  // Determine date/time components
  const date = new Date(timestamp * 1000);
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = date.toISOString().slice(11, 16).replace(':', '-'); // HH-MM (colon → hyphen for Windows)

  // --- OLD FORMAT: Individual file per snapshot (data/hourly/YYYY-MM-DD/HH-MM.json) ---
  const hourlyDir = path.join('data', 'hourly', dateStr);
  const hourlyFile = path.join(hourlyDir, `${timeStr}.json`);

  // Dedup against both old and new formats
  let alreadyExists = false;

  // Check old format: last file in directory
  if (fs.existsSync(hourlyDir)) {
    const files = fs.readdirSync(hourlyDir).sort().reverse();
    if (files.length > 0) {
      const lastFile = path.join(hourlyDir, files[0]);
      const lastData = readJson(lastFile);
      if (lastData.timestamp === timestamp) {
        alreadyExists = true;
      }
    }
  }

  // Check new format: consolidated daily file
  const dailyFile = path.join('data', 'hourly', `${dateStr}.json`);
  if (!alreadyExists && fs.existsSync(dailyFile)) {
    const dailyData = readJson(dailyFile);
    if (dailyData.snapshots) {
      for (const snap of Object.values(dailyData.snapshots)) {
        if (snap.timestamp === timestamp) {
          alreadyExists = true;
          break;
        }
      }
    }
  }

  if (alreadyExists) {
    console.log(`[fetch] Dedup: timestamp ${timestamp} already exists, skipping`);
    return;
  }

  const output = {
    timestamp,
    fetchedAt: date.toISOString(),
    data: marketData
  };

  // Write old format (individual file)
  writeJson(hourlyFile, output);
  console.log(`[fetch] Wrote ${hourlyFile}`);

  // --- NEW FORMAT: Consolidated daily file (data/hourly/YYYY-MM-DD.json) ---
  let dailyData = { date: dateStr, snapshots: {} };
  if (fs.existsSync(dailyFile)) {
    dailyData = readJson(dailyFile);
    if (!dailyData.snapshots) {
      dailyData.snapshots = {};
    }
  }
  dailyData.snapshots[timeStr] = output;
  writeJson(dailyFile, dailyData);
  console.log(`[fetch] Wrote ${dailyFile}`);
}

// Median/fair values per item (game "market values"). Updates ~hourly, deduped
// by marketValuesVersion. Stored separately from the marketplace snapshots.
async function fetchMarketValues() {
  console.log(`[fetch] Fetching ${MARKET_VALUES_URL}`);
  const response = await globalThis.fetch(MARKET_VALUES_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const json = await response.json();
  const version = json.marketValuesVersion;
  const marketItemValues = json.marketItemValues;

  if (!Number.isSafeInteger(version) || version <= 0 || !marketItemValues || typeof marketItemValues !== 'object') {
    throw new Error('Invalid response: missing marketValuesVersion or marketItemValues');
  }

  const fetchedAt = new Date().toISOString();
  const versionDate = new Date(version);
  const dateStr = versionDate.toISOString().split('T')[0];
  const timeStr = versionDate.toISOString().slice(11, 16).replace(':', '-');

  const valuesDir = path.join('data', 'market_values_hourly', dateStr);
  const valuesFile = path.join(valuesDir, `${timeStr}.json`);
  const dailyFile = path.join('data', 'market_values_hourly', `${dateStr}.json`);

  // Dedup by marketValuesVersion (check consolidated + individual file)
  if (fs.existsSync(dailyFile)) {
    const dailyData = readJson(dailyFile);
    for (const snap of Object.values(dailyData.snapshots || {})) {
      if (snap.marketValuesVersion === version) {
        console.log(`[fetch] Dedup: marketValuesVersion ${version} already exists, skipping`);
        return;
      }
    }
  }
  if (fs.existsSync(valuesFile)) {
    const existing = readJson(valuesFile);
    if (existing.marketValuesVersion === version) {
      console.log(`[fetch] Dedup: marketValuesVersion ${version} already exists, skipping`);
      return;
    }
  }

  const output = {
    marketValuesVersion: version,
    fetchedAt,
    marketItemValues
  };

  writeJson(valuesFile, output);
  console.log(`[fetch] Wrote ${valuesFile}`);

  let dailyData = { date: dateStr, snapshots: {} };
  if (fs.existsSync(dailyFile)) {
    dailyData = readJson(dailyFile);
    if (!dailyData.snapshots) {
      dailyData.snapshots = {};
    }
  }
  dailyData.snapshots[timeStr] = output;
  writeJson(dailyFile, dailyData);
  console.log(`[fetch] Wrote ${dailyFile}`);
}

async function main() {
  let marketplaceOk = true;

  try {
    await fetchMarketData();
  } catch (error) {
    marketplaceOk = false;
    console.error('[fetch] Marketplace error:', error.message);
  }

  // Best-effort: a values outage shouldn't block committing the marketplace data.
  try {
    await fetchMarketValues();
  } catch (error) {
    console.error('[fetch] Market values error:', error.message);
  }

  if (!marketplaceOk) {
    process.exit(1);
  }
}

main();
