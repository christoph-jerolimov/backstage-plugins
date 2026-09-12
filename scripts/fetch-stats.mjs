#!/usr/bin/env node
/**
 * Fetches GitHub star counts for every repo referenced by the catalog
 * entities under entities/, and caches them to data/stars-cache.json.
 *
 * Per project convention, a repo's stars are only (re)fetched when that
 * repo contributed at most 30 cataloged plugins/packages to this catalog
 * (see data/entities.json) — this keeps the script cheap to re-run and
 * avoids hammering the API for the handful of very large monorepos
 * (backstage/backstage, backstage/community-plugins, etc.) whose star
 * counts are well known anyway.
 *
 * Auth: uses GITHUB_TOKEN or GH_TOKEN from the environment if present
 * (recommended - lifts the rate limit from 60/hr to 5000/hr). Falls back
 * to unauthenticated requests otherwise.
 *
 * Usage:
 *   node scripts/fetch-stats.mjs [--force] [--max-plugins=30]
 *
 *   --force          Re-fetch even entries already cached.
 *   --max-plugins=N  Override the 30-plugin cap.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const entitiesFile = path.join(repoRoot, 'data', 'entities.json');
const cacheFile = path.join(repoRoot, 'data', 'stars-cache.json');

const args = process.argv.slice(2);
const force = args.includes('--force');
const maxPluginsArg = args.find((a) => a.startsWith('--max-plugins='));
const MAX_PLUGINS = maxPluginsArg ? Number(maxPluginsArg.split('=')[1]) : 30;

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

if (!fs.existsSync(entitiesFile)) {
  console.error(`Missing ${entitiesFile}. Run scripts/lib/generate-catalog.mjs first.`);
  process.exit(1);
}

const entities = JSON.parse(fs.readFileSync(entitiesFile, 'utf8'));

const countByRepo = new Map();
for (const e of entities) {
  countByRepo.set(e.repoSlug, (countByRepo.get(e.repoSlug) || 0) + 1);
}

const eligibleRepos = [...countByRepo.entries()]
  .filter(([, count]) => count <= MAX_PLUGINS)
  .map(([repo]) => repo)
  .sort();

const skippedRepos = [...countByRepo.entries()]
  .filter(([, count]) => count > MAX_PLUGINS)
  .map(([repo, count]) => `${repo} (${count} plugins)`);

let cache = {};
if (fs.existsSync(cacheFile)) {
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {
    cache = {};
  }
}

async function fetchStars(repoSlug) {
  const url = `https://api.github.com/repos/${repoSlug}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'backstage-plugins-catalog-stats-script',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (res.status === 404) {
    return { stars: null, error: 'not_found' };
  }
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    return { stars: null, error: `rate_limited (remaining=${remaining})` };
  }
  if (!res.ok) {
    return { stars: null, error: `http_${res.status}` };
  }
  const json = await res.json();
  return {
    stars: json.stargazers_count ?? null,
    forks: json.forks_count ?? null,
    openIssues: json.open_issues_count ?? null,
    archived: !!json.archived,
    pushedAt: json.pushed_at || null,
  };
}

async function main() {
  console.log(`Repos eligible for star-fetch (<= ${MAX_PLUGINS} plugins): ${eligibleRepos.length}`);
  console.log(`Repos skipped (> ${MAX_PLUGINS} plugins, stats not fetched by design):`);
  for (const r of skippedRepos) console.log(`  - ${r}`);

  let fetched = 0;
  let cached = 0;
  let failed = 0;

  for (const repoSlug of eligibleRepos) {
    const existing = cache[repoSlug];
    if (existing && !force) {
      cached++;
      continue;
    }
    process.stdout.write(`Fetching ${repoSlug} ... `);
    try {
      const result = await fetchStars(repoSlug);
      if (result.error) {
        console.log(`SKIP (${result.error})`);
        failed++;
        // keep any previous cached value if present
        if (!cache[repoSlug]) {
          cache[repoSlug] = { stars: null, error: result.error, fetchedAt: new Date().toISOString() };
        }
      } else {
        cache[repoSlug] = { ...result, fetchedAt: new Date().toISOString() };
        console.log(`${result.stars} stars`);
        fetched++;
      }
    } catch (e) {
      console.log(`ERROR (${e.message})`);
      failed++;
    }
    // Be polite to the API even when authenticated.
    await new Promise((r) => setTimeout(r, 150));
  }

  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));

  console.log('');
  console.log(`Done. fetched=${fetched} cached=${cached} failed=${failed} skipped_by_size=${skippedRepos.length}`);
  console.log(`Cache written to ${path.relative(repoRoot, cacheFile)}`);
  if (!token) {
    console.log('Tip: set GITHUB_TOKEN (or GH_TOKEN) in the environment to raise the GitHub API rate limit from 60/hr to 5000/hr.');
  }
}

main();
