#!/usr/bin/env node

// Append daily files to the append-only `daily` branch, one dated commit per
// day. The `data` branch is force-squashed so it can't carry dates; this branch
// never is. Only local refs/tags are created here - the workflow pushes them.
//
// Publishes every daily stream under `data/daily/` and
// `data/market_values_daily/` (whichever exist for a given date).
//
//   node scripts/publish-daily.js                    # publish yesterday's files
//   node scripts/publish-daily.js --date=2026-08-30  # publish a specific day
//   node scripts/publish-daily.js --all              # backfill every unpublished day

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BRANCH = 'daily';
const DIRS = [path.join('data', 'daily'), path.join('data', 'market_values_daily')];

const git = (args, opts) => execFileSync('git', args, { encoding: 'utf8', ...opts }).trim();
const tryGit = (args, opts) => {
  try {
    return git(args, { stdio: ['ignore', 'pipe', 'ignore'], ...opts });
  } catch {
    return null;
  }
};
const fail = (message) => {
  console.error(`[publish-daily] ${message}`);
  process.exit(1);
};

const toRepoPath = (filePath) => filePath.split(path.sep).join('/');

const publishAll = process.argv.includes('--all');
const explicitDate = process.argv.find((a) => a.startsWith('--date='))?.slice(7);
// Default to yesterday: the day the aggregate just produced.
const dateArg = explicitDate || (publishAll ? null : new Date(Date.now() - 86400000).toISOString().slice(0, 10));

tryGit(['fetch', 'origin', `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`]);
tryGit(['fetch', 'origin', '--tags']);

let parent =
  tryGit(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${BRANCH}`]) ||
  tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`]);

// date -> combined signature (sorted "<path>:<blob>") of the files published for that day
const published = new Map();
if (parent) {
  const lines = (tryGit(['ls-tree', '-r', parent, '--', ...DIRS]) || '').split('\n');
  const byDate = new Map();
  for (const line of lines) {
    const match = line.match(/^\d+\s+blob\s+([0-9a-f]+)\t(.+)$/);
    if (!match) continue;
    const [, blob, filePath] = match;
    const dateMatch = path.basename(filePath).match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!dateMatch) continue;
    if (!byDate.has(dateMatch[1])) byDate.set(dateMatch[1], []);
    byDate.get(dateMatch[1]).push(`${filePath}:${blob}`);
  }
  for (const [date, parts] of byDate) published.set(date, parts.sort().join('|'));
}

const allDates = new Set();
for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    const match = file.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (match) allDates.add(match[1]);
  }
}
const sortedDates = [...allDates].sort();

const filesForDate = (date) =>
  DIRS.map((dir) => path.join(dir, `${date}.json`)).filter((filePath) => fs.existsSync(filePath));

const signatureOf = (files) =>
  files.map((filePath) => `${toRepoPath(filePath)}:${git(['hash-object', filePath])}`).sort().join('|');

const dates = dateArg ? [dateArg] : sortedDates;

let created = 0;
for (const date of dates) {
  const files = filesForDate(date);
  if (files.length === 0) {
    if (dateArg) fail(`no daily file for ${date}`);
    continue;
  }

  const signature = signatureOf(files);
  const existing = published.get(date);

  if (existing) {
    if (existing === signature) continue;
    fail(`append-only violation: ${date} changed`);
  }

  git(['read-tree', parent || '--empty']); // start from the existing tree
  git(['add', '-f', '--', ...files]); // append this day's files
  const tree = git(['write-tree']);

  const commitArgs = ['commit-tree', tree, '-m', `data: ${date}`];
  if (parent) commitArgs.push('-p', parent);
  parent = git(commitArgs);

  git(['update-ref', `refs/heads/${BRANCH}`, parent]);
  tryGit(['tag', `daily-${date}`, parent]);
  published.set(date, signature);
  created++;
  console.log(`[publish-daily] ${date} -> ${parent.slice(0, 7)} (${files.length} file(s), tag daily-${date})`);
}

console.log(`[publish-daily] ${created} new commit(s), ${dates.length} date(s) checked`);
