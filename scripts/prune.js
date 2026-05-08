#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function prune() {
  const hourlyDir = path.join('data', 'hourly');
  
  if (!fs.existsSync(hourlyDir)) {
    console.log('[prune] No hourly data directory, skipping');
    return;
  }
  
  const directories = fs.readdirSync(hourlyDir);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
  const cutoffStr = sevenDaysAgo.toISOString().split('T')[0];
  
  console.log(`[prune] Cutoff date: ${cutoffStr}`);
  
  for (const dir of directories) {
    if (dir < cutoffStr) {
      const fullPath = path.join(hourlyDir, dir);
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log(`[prune] Deleted ${fullPath}`);
    }
  }
}

prune();
