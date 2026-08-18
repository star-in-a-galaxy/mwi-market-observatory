#!/usr/bin/env node

// Collapse the `data` branch to a single snapshot commit of the current data/
// (plus the data-branch .gitignore). Run after the daily aggregate+prune so the
// data branch never accumulates hourly-commit history.

const { execFileSync } = require('child_process');

const BOT = 'github-actions[bot]@users.noreply.github.com';

function git(args, opts) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    input: opts && opts.input,
    env: opts && opts.env ? { ...process.env, ...opts.env } : process.env
  }).trim();
}

git(['read-tree', '--empty']);
git(['add', 'data/', '.gitignore']);

const tree = git(['write-tree']);
const now = Math.floor(Date.now() / 1000);
const msg = `data: snapshot ${new Date().toISOString().split('T')[0]}`;

const commit = git(['commit-tree', tree, '-m', msg], {
  env: {
    GIT_COMMITTER_NAME: 'github-actions[bot]',
    GIT_COMMITTER_EMAIL: BOT,
    GIT_COMMITTER_DATE: `@${now} +0000`
  }
});

git(['update-ref', 'refs/heads/data', commit]);
git(['reset', '--hard', commit]);

console.log(`[squash-data] data branch -> single commit ${git(['rev-parse', '--short', 'HEAD'])} (${msg})`);
