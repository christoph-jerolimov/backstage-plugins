#!/usr/bin/env node
/**
 * Generates data/plugins.csv from data/entities.json (+ data/stars-cache.json
 * if present), and prints a short summary. Columns: Name, Description, Role,
 * Repository, Stars.
 *
 * Usage: node scripts/generate-csv.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const entitiesFile = path.join(repoRoot, 'data', 'entities.json');
const starsFile = path.join(repoRoot, 'data', 'stars-cache.json');
const outFile = path.join(repoRoot, 'data', 'plugins.csv');

const entities = JSON.parse(fs.readFileSync(entitiesFile, 'utf8'));
const stars = fs.existsSync(starsFile) ? JSON.parse(fs.readFileSync(starsFile, 'utf8')) : {};

function csvField(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const rows = entities
  .slice()
  .sort((a, b) => (a.repoSlug === b.repoSlug ? a.pkgName.localeCompare(b.pkgName) : a.repoSlug.localeCompare(b.repoSlug)))
  .map((e) => {
    const starInfo = stars[e.repoSlug];
    const starCount = starInfo && typeof starInfo.stars === 'number' ? starInfo.stars : '';
    return {
      Name: e.pkgName,
      Description: e.description,
      Role: e.role,
      Repository: e.repoSlug,
      RepositoryUrl: `https://github.com/${e.repoSlug}`,
      Stars: starCount,
    };
  });

const header = ['Name', 'Description', 'Role', 'Repository', 'RepositoryUrl', 'Stars'];
const lines = [header.join(',')];
for (const row of rows) {
  lines.push(header.map((h) => csvField(row[h])).join(','));
}

fs.writeFileSync(outFile, lines.join('\n') + '\n');

const withStars = rows.filter((r) => r.Stars !== '').length;
console.log(`Wrote ${rows.length} rows to ${path.relative(repoRoot, outFile)} (${withStars} with star counts)`);
