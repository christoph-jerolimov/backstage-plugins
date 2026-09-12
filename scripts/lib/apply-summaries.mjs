#!/usr/bin/env node
import fs from 'node:fs';

const masterFile = process.argv[2];
const manifestFile = process.argv[3];
const outFile = process.argv[4];

const master = JSON.parse(fs.readFileSync(masterFile, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

// Build pkgName+repoSlug -> description map from all output chunks
const descMap = new Map();
for (const m of manifest) {
  const out = JSON.parse(fs.readFileSync(m.outPath, 'utf8'));
  for (const item of out) {
    descMap.set(`${m.repo}::${item.pkgName}`, item.description);
  }
}

let applied = 0;
for (const item of master) {
  if (item.descriptionIsPlaceholder) {
    const key = `${item.repoSlug}::${item.pkgName}`;
    const summarized = descMap.get(key);
    if (summarized) {
      item.description = summarized.trim();
      item.descriptionSource = 'readme-summary';
      applied++;
    } else {
      item.descriptionSource = 'none';
    }
  } else {
    item.descriptionSource = 'package.json';
  }
  delete item.readmeExcerpt; // no longer needed, keep files small
}

fs.writeFileSync(outFile, JSON.stringify(master, null, 2));
console.error(`Applied ${applied} summarized descriptions (of ${master.filter(x=>x.descriptionIsPlaceholder).length} placeholders)`);
