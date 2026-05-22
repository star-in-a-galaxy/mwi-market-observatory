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

async function fetchMarketData() {
  const API_URL = 'https://www.milkywayidle.com/game_data/marketplace.json';
  
  try {
    console.log(`[fetch] Fetching ${API_URL}`);
    const response = await globalThis.fetch(API_URL);
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
    
  } catch (error) {
    console.error('[fetch] Error:', error.message);
    process.exit(1);
  }
}

fetchMarketData();
