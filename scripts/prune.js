#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function prune() {
  const hourlyDir = path.join('data', 'hourly');
  
  if (!fs.existsSync(hourlyDir)) {
    console.log('[prune] No hourly data directory, skipping');
    return;
  }

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 16);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  console.log(`[prune] Hourly cutoff date: ${cutoffStr}`);

  const entries = fs.readdirSync(hourlyDir).sort();

  for (const entry of entries) {
    const fullPath = path.join(hourlyDir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      // Old format: data/hourly/YYYY-MM-DD/
      if (entry < cutoffStr) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        console.log(`[prune] Deleted directory ${fullPath}`);
      }
    } else if (stat.isFile() && entry.endsWith('.json')) {
      // New format: data/hourly/YYYY-MM-DD.json
      const dateStr = entry.replace('.json', '');
      if (dateStr < cutoffStr) {
        fs.rmSync(fullPath, { force: true });
        console.log(`[prune] Deleted consolidated file ${fullPath}`);
      }
    }
  }
}

prune();
