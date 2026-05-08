#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

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
    
    // Determine output path: data/hourly/YYYY-MM-DD/HH-MM.json
    const date = new Date(timestamp * 1000);
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = date.toISOString().slice(11, 16).replace(':', '-'); // HH-MM (colon → hyphen for Windows)
    
    const hourlyDir = path.join('data', 'hourly', dateStr);
    const hourlyFile = path.join(hourlyDir, `${timeStr}.json`);
    
    // Deduplication: Read last file in same day folder
    if (fs.existsSync(hourlyDir)) {
      const files = fs.readdirSync(hourlyDir).sort().reverse();
      if (files.length > 0) {
        const lastFile = path.join(hourlyDir, files[0]);
        const lastData = JSON.parse(fs.readFileSync(lastFile, 'utf8'));
        if (lastData.timestamp === timestamp) {
          console.log(`[fetch] Dedup: timestamp ${timestamp} already exists, skipping`);
          return;
        }
      }
    }
    
    // Write file
    const output = {
      timestamp,
      fetchedAt: date.toISOString(),
      data: marketData
    };
    
    fs.mkdirSync(hourlyDir, { recursive: true });
    fs.writeFileSync(hourlyFile, JSON.stringify(output, null, 2));
    console.log(`[fetch] Wrote ${hourlyFile}`);
    
  } catch (error) {
    console.error('[fetch] Error:', error.message);
    process.exit(1);
  }
}

fetchMarketData();
