#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const RETENTION_DAYS = 16;

function pruneDir(dir, label, cutoffStr) {
  if (!fs.existsSync(dir)) {
    console.log(`[prune] No ${label} directory, skipping`);
    return;
  }

  const entries = fs.readdirSync(dir).sort();

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      // Old format: <dir>/YYYY-MM-DD/
      if (entry < cutoffStr) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        console.log(`[prune] Deleted directory ${fullPath}`);
      }
    } else if (stat.isFile() && entry.endsWith('.json')) {
      // New format: <dir>/YYYY-MM-DD.json
      const dateStr = entry.replace('.json', '');
      if (dateStr < cutoffStr) {
        fs.rmSync(fullPath, { force: true });
        console.log(`[prune] Deleted consolidated file ${fullPath}`);
      }
    }
  }
}

function prune() {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  console.log(`[prune] Cutoff date: ${cutoffStr} (${RETENTION_DAYS} days)`);

  pruneDir(path.join('data', 'hourly'), 'hourly', cutoffStr);
  pruneDir(path.join('data', 'market_values_hourly'), 'market_values_hourly', cutoffStr);
}

prune();
