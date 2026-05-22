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

function migrate() {
  const hourlyDir = path.join('data', 'hourly');

  if (!fs.existsSync(hourlyDir)) {
    console.log('[migrate] No hourly data directory, skipping');
    return;
  }

  const entries = fs.readdirSync(hourlyDir).sort();
  let migrated = 0;
  let skipped = 0;

  for (const entry of entries) {
    const fullPath = path.join(hourlyDir, entry);
    const stat = fs.statSync(fullPath);

    if (!stat.isDirectory()) {
      continue; // Skip existing consolidated files
    }

    const dateStr = entry;
    const consolidatedFile = path.join(hourlyDir, `${dateStr}.json`);

    // Skip if already migrated
    if (fs.existsSync(consolidatedFile)) {
      console.log(`[migrate] ${dateStr}: consolidated file already exists, skipping`);
      skipped++;
      continue;
    }

    // Read all snapshot files in the directory
    const files = fs.readdirSync(fullPath)
      .filter(f => f.endsWith('.json'))
      .sort();

    if (files.length === 0) {
      console.log(`[migrate] ${dateStr}: no snapshot files found, skipping`);
      skipped++;
      continue;
    }

    const snapshots = {};
    for (const file of files) {
      const timeStr = file.replace('.json', '');
      const data = readJson(path.join(fullPath, file));
      snapshots[timeStr] = data;
    }

    writeJson(consolidatedFile, {
      date: dateStr,
      snapshots
    });

    console.log(`[migrate] ${dateStr}: consolidated ${files.length} snapshots into ${consolidatedFile}`);
    migrated++;
  }

  console.log(`[migrate] Done. Migrated: ${migrated}, Skipped: ${skipped}`);
}

migrate();
