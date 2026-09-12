#!/usr/bin/env node
/**
 * Regenerates the plugin table inside README.md (between the
 * <!-- PLUGIN_TABLE_START --> / <!-- PLUGIN_TABLE_END --> markers) from
 * data/entities.json + data/stars-cache.json. Also regenerates the small
 * summary line above the table.
 *
 * Usage: node scripts/update-readme.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const entitiesFile = path.join(repoRoot, 'data', 'entities.json');
const starsFile = path.join(repoRoot, 'data', 'stars-cache.json');
const readmeFile = path.join(repoRoot, 'README.md');

const START = '<!-- PLUGIN_TABLE_START -->';
const END = '<!-- PLUGIN_TABLE_END -->';

const entities = JSON.parse(fs.readFileSync(entitiesFile, 'utf8'));
const stars = fs.existsSync(starsFile) ? JSON.parse(fs.readFileSync(starsFile, 'utf8')) : {};

function esc(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

const sorted = entities
  .slice()
  .sort((a, b) => (a.repoSlug === b.repoSlug ? a.pkgName.localeCompare(b.pkgName) : a.repoSlug.localeCompare(b.repoSlug)));

const repoCount = new Set(entities.map((e) => e.repoSlug)).size;
const withStars = entities.filter((e) => {
  const s = stars[e.repoSlug];
  return s && typeof s.stars === 'number';
}).length;

let table = '';
table += `_${entities.length} packages across ${repoCount} repositories. Generated ${new Date().toISOString().slice(0, 10)} by \`scripts/generate-csv.mjs\` / \`scripts/update-readme.mjs\` from [\`data/entities.json\`](data/entities.json). ${withStars} entries have a GitHub star count (see \`scripts/fetch-stats.mjs\` — by design it only fetches stats for repos contributing 30 or fewer cataloged plugins). The full machine-readable table is [\`data/plugins.csv\`](data/plugins.csv)._\n\n`;
table += '| Name | Description | Role | Repository | Stars |\n';
table += '|---|---|---|---|---|\n';

for (const e of sorted) {
  const starInfo = stars[e.repoSlug];
  const starCount = starInfo && typeof starInfo.stars === 'number' ? starInfo.stars.toLocaleString('en-US') : '';
  const repoLink = `[${esc(e.repoSlug)}](https://github.com/${e.repoSlug})`;
  table += `| ${esc(e.pkgName)} | ${esc(e.description)} | \`${esc(e.role)}\` | ${repoLink} | ${starCount} |\n`;
}

const readme = fs.readFileSync(readmeFile, 'utf8');
const startIdx = readme.indexOf(START);
const endIdx = readme.indexOf(END);
if (startIdx === -1 || endIdx === -1) {
  console.error(`README.md is missing ${START} / ${END} markers.`);
  process.exit(1);
}

const newReadme = `${readme.slice(0, startIdx + START.length)}\n${table}\n${readme.slice(endIdx)}`;
fs.writeFileSync(readmeFile, newReadme);

console.log(`Updated README.md table with ${sorted.length} rows.`);
