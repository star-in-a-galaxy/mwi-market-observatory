#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function prune() {
  const hourlyDir = path.join('data', 'hourly');
  const dailyDir = path.join('data', 'daily');
  
  if (!fs.existsSync(hourlyDir)) {
    console.log('[prune] No hourly data directory, skipping');
    return;
  }
  
  const directories = fs.readdirSync(hourlyDir);
  const hourlyCutoff = new Date();
  hourlyCutoff.setUTCDate(hourlyCutoff.getUTCDate() - 31);
  const hourlyCutoffStr = hourlyCutoff.toISOString().split('T')[0];
  
  console.log(`[prune] Hourly cutoff date: ${hourlyCutoffStr}`);
  
  for (const dir of directories) {
    if (dir < hourlyCutoffStr) {
      const fullPath = path.join(hourlyDir, dir);
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log(`[prune] Deleted ${fullPath}`);
    }
  }
}

prune();
