#!/usr/bin/env node
'use strict';

// Refresh scripts/data/item_levels.json from a game client data export
// (init_client_data, as saved by the userscripts). Only enhanceable items are kept.
// Usage: node scripts/update-item-levels.js <init_client_data.json>

const fs = require('fs');
const path = require('path');

const OUT_FILE = path.join(__dirname, 'data', 'item_levels.json');

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node scripts/update-item-levels.js <init_client_data.json>');
    process.exit(1);
  }

  let data = JSON.parse(fs.readFileSync(input, 'utf8'));
  data = data.initClientData || data;
  if (typeof data === 'string') data = JSON.parse(data);
  if (!data.itemDetailMap) {
    console.error('No itemDetailMap found in', input);
    process.exit(1);
  }

  const items = {};
  for (const [hrid, item] of Object.entries(data.itemDetailMap).sort(([a], [b]) => a.localeCompare(b))) {
    if (item.enhancementCosts) items[hrid] = item.itemLevel || 0;
  }

  const out = { gameVersion: data.gameVersion || null, generatedAt: new Date().toISOString(), items };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1) + '\n');
  console.log(`[item-levels] ${Object.keys(items).length} enhanceable items -> ${path.relative(process.cwd(), OUT_FILE)}`);
}

main();
