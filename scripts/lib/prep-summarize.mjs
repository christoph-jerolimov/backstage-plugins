#!/usr/bin/env node
// Groups placeholder-description packages by repo (chunked to a max size),
// writes one input JSON file per chunk for subagent summarization.
import fs from 'node:fs';
import path from 'node:path';

const masterFile = process.argv[2];
const outDir = process.argv[3];
const CHUNK_SIZE = 20;

fs.mkdirSync(outDir, { recursive: true });
const master = JSON.parse(fs.readFileSync(masterFile, 'utf8'));
const placeholders = master.filter((x) => x.descriptionIsPlaceholder);

const byRepo = {};
for (const item of placeholders) {
  (byRepo[item.repoSlug] ||= []).push(item);
}

const manifest = [];
for (const [repo, items] of Object.entries(byRepo)) {
  const safe = repo.replace(/\//g, '_');
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const chunkIdx = Math.floor(i / CHUNK_SIZE);
    const inName = `in_${safe}_${chunkIdx}.json`;
    const outName = `out_${safe}_${chunkIdx}.json`;
    const inPath = path.join(outDir, inName);
    const outPath = path.join(outDir, outName);
    const payload = chunk.map((x) => ({
      pkgName: x.pkgName,
      role: x.role,
      readmeExcerpt: (x.readmeExcerpt || '').slice(0, 2200),
    }));
    fs.writeFileSync(inPath, JSON.stringify(payload, null, 2));
    manifest.push({ repo, inPath, outPath, count: chunk.length });
  }
}

fs.writeFileSync(path.join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Wrote ${manifest.length} chunk files for ${Object.keys(byRepo).length} repos (${placeholders.length} packages)`);
