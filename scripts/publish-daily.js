#!/usr/bin/env node

// Append daily files to the append-only `daily` branch, one dated commit per
// day. The `data` branch is force-squashed so it can't carry dates; this branch
// never is. Only local refs/tags are created here - the workflow pushes them.
//
//   node scripts/publish-daily.js                    # publish yesterday's file
//   node scripts/publish-daily.js --date=2026-08-30  # publish a specific day
//   node scripts/publish-daily.js --all              # backfill every unpublished day

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BRANCH = 'daily';
const DIR = path.join('data', 'daily');

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

const publishAll = process.argv.includes('--all');
const explicitDate = process.argv.find((a) => a.startsWith('--date='))?.slice(7);
// Default to yesterday: the day the aggregate just produced.
const dateArg = explicitDate || (publishAll ? null : new Date(Date.now() - 86400000).toISOString().slice(0, 10));

tryGit(['fetch', 'origin', `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`]);
tryGit(['fetch', 'origin', '--tags']);

let parent =
  tryGit(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${BRANCH}`]) ||
  tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`]);

// date -> blob sha already published on the branch
const published = new Map();
for (const line of (parent ? tryGit(['ls-tree', '-r', parent, '--', DIR]) || '' : '').split('\n')) {
  const [, blob, file] = line.match(/^\d+\s+blob\s+([0-9a-f]+)\t(.+)$/) || [];
  if (blob) published.set(path.basename(file).slice(0, 10), blob);
}

const allDates = fs
  .readdirSync(DIR)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .map((f) => f.slice(0, 10))
  .sort();

const dates = dateArg ? allDates.filter((d) => d === dateArg) : allDates;
if (dateArg && dates.length === 0) fail(`no daily file for ${dateArg}`);

let created = 0;
for (const date of dates) {
  const blob = git(['hash-object', path.join(DIR, `${date}.json`)]);
  const existing = published.get(date);

  if (existing) {
    if (existing === blob) continue;
    fail(`append-only violation: ${date} changed`);
  }

  git(['read-tree', parent || '--empty']); // start from the existing tree
  git(['add', '-f', '--', path.join(DIR, `${date}.json`)]); // append this day
  const tree = git(['write-tree']);

  const commitArgs = ['commit-tree', tree, '-m', `data: ${date}`];
  if (parent) commitArgs.push('-p', parent);
  parent = git(commitArgs);

  git(['update-ref', `refs/heads/${BRANCH}`, parent]);
  tryGit(['tag', `daily-${date}`, parent]);
  published.set(date, blob);
  created++;
  console.log(`[publish-daily] ${date} -> ${parent.slice(0, 7)} (tag daily-${date})`);
}

console.log(`[publish-daily] ${created} new commit(s), ${dates.length} date(s) checked`);
