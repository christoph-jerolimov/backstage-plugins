#!/usr/bin/env node
// Extracts candidate Backstage plugin/module packages from a cloned repo.
// Usage: node extract.mjs <clonePath> <owner/repo> > out.json
import fs from 'node:fs';
import path from 'node:path';

const [, , clonePath, repoSlug] = process.argv;
if (!clonePath || !repoSlug) {
  console.error('Usage: extract.mjs <clonePath> <owner/repo>');
  process.exit(1);
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'dist-types', 'build', '.yarn', 'coverage',
  '.cache', 'lib', 'temp', '.turbo', 'out',
]);

const SKIP_NAME_EXACT = new Set([
  'app', 'backend', 'example-app', 'example-backend', 'expo-app', 'demo',
  'e2e-test', 'e2e-tests', 'website', 'docs', 'showcase', 'catalog-model',
]);

const SKIP_NAME_RE = /(^|\/)(techdocs-cli-embedded-app|e2e-tests?|examples?|create-app|create-plugin|__fixtures__|__testfixtures__|fixtures|templates|monorepo)(\/|$)/i;

// Repos with a well-known top-level plugins/ (or packages/) convention where
// everything of interest lives under that prefix; restricts false positives
// from internal tooling packages in very large monorepos.
const REPO_PATH_PREFIX = {
  'backstage/backstage': 'plugins/',
};

function walk(dir, files) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      walk(path.join(dir, e.name), files);
    } else if (e.isFile() && e.name === 'package.json') {
      files.push(path.join(dir, e.name));
    }
  }
}

const pkgFiles = [];
walk(clonePath, pkgFiles);

const PLACEHOLDER_RES = [
  /^$/,
  /^todo/i,
  /^tbd$/i,
  /^my[- ]?plugin/i,
  /^(a|an)\s+(new\s+)?backstage\s+(frontend\s+|backend\s+)?plugin\.?$/i,
  /^backstage plugin\.?$/i,
  /^plugin for backstage\.?$/i,
  /^this is (an?|the) .*plugin\.?$/i,
  /^new backstage plugin$/i,
  /^backstage plugin created through @backstage\/create-app$/i,
];

function isPlaceholder(desc, pkgName) {
  const d = (desc || '').trim();
  if (d.length < 12) return true;
  if (PLACEHOLDER_RES.some((re) => re.test(d))) return true;
  if (d.toLowerCase() === pkgName.toLowerCase()) return true;
  return false;
}

function findReadme(dir, rootDir) {
  let cur = dir;
  while (true) {
    const entries = fs.readdirSync(cur, { withFileTypes: true }).filter((e) => e.isFile());
    const readme = entries.find((e) => /^readme\.md$/i.test(e.name));
    if (readme) return path.join(cur, readme.name);
    if (path.resolve(cur) === path.resolve(rootDir)) break;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

function readmeExcerpt(readmePath) {
  if (!readmePath) return '';
  let text;
  try {
    text = fs.readFileSync(readmePath, 'utf8');
  } catch {
    return '';
  }
  // Strip badges/images, html comments, code fences headers
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  text = text.replace(/^#+\s*.*$/gm, (m) => (text.indexOf(m) < 200 ? '' : m));
  return text.slice(0, 4000);
}

function isCandidate(pkg, relPath, repoSlug) {
  if (!pkg.name) return false;
  if (SKIP_NAME_RE.test(relPath)) return false;
  const baseName = pkg.name.split('/').pop();
  if (SKIP_NAME_EXACT.has(baseName)) return false;
  if (pkg.name.startsWith('@backstage/create-app')) return false;
  if (/^eslint-plugin-|\/eslint-plugin$|^eslint-plugin$|^yarn-plugin/i.test(pkg.name)) return false;

  const prefix = REPO_PATH_PREFIX[repoSlug];
  if (prefix && !(relPath + '/').startsWith(prefix)) return false;

  const role = pkg.backstage && pkg.backstage.role;
  if (role && /plugin/i.test(role)) return true;

  const kw = pkg.keywords || [];
  if (kw.some((k) => /backstage.?plugin/i.test(k))) return true;

  if (/plugin/i.test(pkg.name)) {
    // exclude generic backstage core libs that happen to contain 'plugin' in namespacing but aren't plugins themselves
    if (/^@backstage\/(core|cli|config|theme|test-utils|integration|errors|types|version-bridge)/.test(pkg.name)) return false;
    return true;
  }

  return false;
}

const ROLE_INFERENCE = [
  [/scaffolder-backend-module/i, 'scaffolder-module'],
  [/backend-module/i, 'backend-plugin-module'],
  [/-backend$/i, 'backend-plugin'],
  [/-node$/i, 'node-library'],
  [/-common$/i, 'common-library'],
  [/-react$/i, 'web-library'],
];

function inferRole(name) {
  for (const [re, role] of ROLE_INFERENCE) {
    if (re.test(name)) return role;
  }
  return 'frontend-plugin';
}

const results = [];
for (const pkgFile of pkgFiles) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  } catch {
    continue;
  }
  const relPath = path.relative(clonePath, path.dirname(pkgFile));
  if (!isCandidate(pkg, relPath, repoSlug)) continue;

  const role = (pkg.backstage && pkg.backstage.role) || inferRole(pkg.name);
  const roleInferred = !(pkg.backstage && pkg.backstage.role);
  const desc = (pkg.description || '').trim();
  const placeholder = isPlaceholder(desc, pkg.name);
  const rd = findReadme(path.dirname(pkgFile), clonePath);

  results.push({
    repoSlug,
    pkgName: pkg.name,
    pkgPath: relPath === '' ? '.' : relPath,
    version: pkg.version || '',
    description: desc,
    descriptionIsPlaceholder: placeholder,
    role,
    roleInferred,
    homepage: pkg.homepage || '',
    readmePath: rd ? path.relative(clonePath, rd) : '',
    readmeExcerpt: placeholder ? readmeExcerpt(rd) : '',
  });
}

console.log(JSON.stringify(results, null, 2));
