#!/usr/bin/env node
// Generates one catalog-info.yaml Backstage Component entity per cataloged
// plugin/module package, plus a root catalog-info.yaml Location that
// references all of them. No external deps: writes YAML via a small,
// purpose-built serializer for our fixed entity shape.
import fs from 'node:fs';
import path from 'node:path';

const masterFile = process.argv[2]; // merged master.json (post-summarization)
const repoRoot = process.argv[3]; // /home/user/backstage-plugins
const entitiesDir = path.join(repoRoot, 'entities');

const master = JSON.parse(fs.readFileSync(masterFile, 'utf8'));

function sanitizeName(raw) {
  let s = String(raw)
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  if (s.length > 63) s = s.slice(0, 63).replace(/[-.]+$/g, '');
  if (!s) s = 'plugin';
  return s;
}

const assignedNames = new Set();
function uniqueName(base) {
  let candidate = base;
  let n = 1;
  while (assignedNames.has(candidate)) {
    n += 1;
    const suffix = `-${n}`;
    candidate = base.slice(0, 63 - suffix.length) + suffix;
  }
  assignedNames.add(candidate);
  return candidate;
}

// --- Minimal YAML scalar/string emission -----------------------------------
function needsQuoting(s) {
  if (s === '') return true;
  if (/^[\s]|[\s]$/.test(s)) return true;
  if (/^[-?:,\[\]{}#&*!|>'"%@`]/.test(s)) return true;
  if (/: |:$/.test(s)) return true;
  if (/[\n\t]/.test(s)) return true;
  if (/^(true|false|null|~|yes|no|on|off)$/i.test(s)) return true;
  if (/^-?\d+(\.\d+)?$/.test(s)) return true;
  return false;
}
function yamlStr(s) {
  const str = String(s);
  if (!needsQuoting(str)) return str;
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function emitScalarLine(indent, key, value) {
  return `${indent}${key}: ${yamlStr(value)}\n`;
}

function emitEntity(entity) {
  let out = '';
  out += `apiVersion: ${entity.apiVersion}\n`;
  out += `kind: ${entity.kind}\n`;
  out += 'metadata:\n';
  out += emitScalarLine('  ', 'name', entity.metadata.name);
  out += emitScalarLine('  ', 'title', entity.metadata.title);
  out += emitScalarLine('  ', 'description', entity.metadata.description);
  if (entity.metadata.tags && entity.metadata.tags.length) {
    out += '  tags:\n';
    for (const t of entity.metadata.tags) out += `    - ${yamlStr(t)}\n`;
  }
  if (entity.metadata.annotations && Object.keys(entity.metadata.annotations).length) {
    out += '  annotations:\n';
    for (const [k, v] of Object.entries(entity.metadata.annotations)) {
      out += emitScalarLine('    ', yamlStr(k), v);
    }
  }
  if (entity.metadata.links && entity.metadata.links.length) {
    out += '  links:\n';
    for (const link of entity.metadata.links) {
      out += `    - url: ${yamlStr(link.url)}\n`;
      out += `      title: ${yamlStr(link.title)}\n`;
      if (link.icon) out += `      icon: ${yamlStr(link.icon)}\n`;
    }
  }
  out += 'spec:\n';
  for (const [k, v] of Object.entries(entity.spec)) {
    out += emitScalarLine('  ', k, v);
  }
  return out;
}

const ROLE_TITLES = {
  'frontend-plugin': 'Frontend plugin',
  'backend-plugin': 'Backend plugin',
  'backend-plugin-module': 'Backend plugin module',
  'scaffolder-module': 'Scaffolder backend module',
  'common-library': 'Common library',
  'node-library': 'Node library',
  'web-library': 'Web library',
  'frontend-dynamic-container': 'Frontend dynamic container',
};

const entities = [];

for (const item of master) {
  const {
    repoSlug, pkgName, pkgPath, description, role, homepage, note, version,
  } = item;
  const [owner, repo] = repoSlug.split('/');
  const baseName = sanitizeName(pkgName);
  const entityName = uniqueName(baseName);

  const sourcePath = pkgPath === '.' ? '' : `/${pkgPath}`;
  const sourceUrl = `https://github.com/${repoSlug}/tree/HEAD${sourcePath}`;

  const desc = (description || '').trim() || `${ROLE_TITLES[role] || 'Package'} named ${pkgName}.`;

  const annotations = {
    'github.com/project-slug': repoSlug,
    'backstage.io/source-location': `url:${sourceUrl}`,
    'backstage-plugins.io/role': role,
  };
  if (note) annotations['backstage-plugins.io/note'] = note;
  if (version) annotations['backstage-plugins.io/package-version'] = version;

  const entity = {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name: entityName,
      title: pkgName,
      description: desc.slice(0, 500),
      annotations,
      tags: [role, `repo-${sanitizeName(repo)}`].filter(Boolean).slice(0, 10),
      links: [
        { url: `https://github.com/${repoSlug}`, title: 'GitHub repository', icon: 'github' },
        ...(homepage && homepage !== `https://github.com/${repoSlug}` ? [{ url: homepage, title: 'Homepage' }] : []),
      ],
    },
    spec: {
      type: role,
      lifecycle: 'unknown',
      owner: sanitizeName(owner),
    },
  };

  const outDir = path.join(entitiesDir, owner, repo, entityName);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'catalog-info.yaml');
  fs.writeFileSync(outFile, emitEntity(entity));

  entities.push({
    ...item,
    entityName,
    description: desc,
    file: path.relative(repoRoot, outFile),
  });
}

// Root aggregator Location
let locOut = '';
locOut += 'apiVersion: backstage.io/v1alpha1\n';
locOut += 'kind: Location\n';
locOut += 'metadata:\n';
locOut += emitScalarLine('  ', 'name', 'all-backstage-plugins');
locOut += emitScalarLine('  ', 'title', 'All cataloged Backstage plugins, packages and modules');
locOut += emitScalarLine('  ', 'description', `Aggregates ${entities.length} Backstage plugin/module catalog-info.yaml files discovered across the community.`);
locOut += 'spec:\n';
locOut += '  type: url\n';
locOut += '  targets:\n';
for (const e of entities) {
  locOut += `    - ${yamlStr(`./${e.file.replace(/\\/g, '/')}`)}\n`;
}
fs.writeFileSync(path.join(repoRoot, 'catalog-info.yaml'), locOut);

fs.writeFileSync(
  path.join(repoRoot, 'data', 'entities.json'),
  JSON.stringify(entities, null, 2),
);

console.log(`Generated ${entities.length} catalog-info.yaml files + root Location + data/entities.json`);
