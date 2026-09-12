#!/usr/bin/env node
// Merges all batch_*.txt (###SPLIT###-delimited JSON arrays) and the big-repo
// *.json files in the scratchpad batches dir into one master array.
import fs from 'node:fs';
import path from 'node:path';

const batchesDir = process.argv[2];
const outFile = process.argv[3];

const all = [];
const files = fs.readdirSync(batchesDir).filter((f) => f.endsWith('.txt') || (f.endsWith('.json') && !f.startsWith('master')));

for (const f of files) {
  const full = path.join(batchesDir, f);
  const raw = fs.readFileSync(full, 'utf8');
  const chunks = f.endsWith('.txt') ? raw.split('###SPLIT###') : [raw];
  for (const c of chunks) {
    const t = c.trim();
    if (!t) continue;
    try {
      const arr = JSON.parse(t);
      if (Array.isArray(arr)) all.push(...arr);
    } catch (e) {
      console.error('Failed to parse chunk in', f, e.message);
    }
  }
}

// Dedupe by repoSlug+pkgName+pkgPath
const seen = new Set();
const deduped = [];
for (const item of all) {
  const key = `${item.repoSlug}::${item.pkgName}::${item.pkgPath}`;
  if (seen.has(key)) continue;
  seen.add(key);
  deduped.push(item);
}

fs.writeFileSync(outFile, JSON.stringify(deduped, null, 2));
console.error(`Merged ${files.length} files -> ${deduped.length} unique packages (from ${all.length} raw)`);

// Print per-repo counts
const byRepo = {};
for (const item of deduped) byRepo[item.repoSlug] = (byRepo[item.repoSlug] || 0) + 1;
const zeroRepos = [];
for (const f of files) {
  // best-effort: nothing here, computed below from known repo list
}
console.error('Per-repo counts:');
for (const [repo, count] of Object.entries(byRepo).sort()) {
  console.error(`  ${count}\t${repo}`);
}
