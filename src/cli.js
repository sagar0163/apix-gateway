#!/usr/bin/env node

/**
 * APIX Gateway CLI
 *
 * Commands:
 *   apix version              Show current version
 *   apix release [type]       Auto-bump version (patch|minor|major|auto)
 *   apix changelog            Generate CHANGELOG.md from commits
 *   apix notes                Generate release notes for latest tag
 *   apix validate             Validate apix.yaml config
 *   apix sync                 Apply declarative config
 *   apix dump                 Export current config as YAML
 *   apix status               Show gateway status
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { bumpVersion, getCurrentVersion, detectBumpType } from './version/manager.js';
import { generateChangelog } from './version/changelog.js';
import { generateReleaseNotes } from './version/release.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// Colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function log(msg) { console.log(msg); }
function info(msg) { console.log(`${c.cyan}ℹ${c.reset} ${msg}`); }
function success(msg) { console.log(`${c.green}✔${c.reset} ${msg}`); }
function warn(msg) { console.log(`${c.yellow}⚠${c.reset} ${msg}`); }
function error(msg) { console.error(`${c.red}✖${c.reset} ${msg}`); process.exit(1); }

function run(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

// =======================
// COMMANDS
// =======================

function cmdVersion() {
  const version = getCurrentVersion(ROOT);
  log(`${c.bold}APIX Gateway${c.reset} v${version}`);

  const lastTag = run('git describe --tags --abbrev=0 2>/dev/null');
  if (lastTag) {
    const commitsSince = run(`git rev-list ${lastTag}..HEAD --count`);
    log(`${c.gray}Last tag: ${lastTag} (${commitsSince} commits since)${c.reset}`);
  }
}

function cmdRelease(type = 'auto') {
  const currentVersion = getCurrentVersion(ROOT);

  let bumpType = type;
  if (type === 'auto') {
    bumpType = detectBumpType(ROOT);
    info(`Auto-detected bump type: ${c.bold}${bumpType}${c.reset}`);
  }

  if (!['patch', 'minor', 'major'].includes(bumpType)) {
    error(`Invalid bump type: ${bumpType}. Use: patch, minor, major, auto`);
  }

  const newVersion = bumpVersion(currentVersion, bumpType);
  info(`Bumping: ${currentVersion} → ${c.bold}${newVersion}${c.reset}`);

  // 1. Update package.json
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  success(`Updated package.json to v${newVersion}`);

  // 2. Update index.js version banner
  const indexPath = path.join(ROOT, 'src', 'index.js');
  if (fs.existsSync(indexPath)) {
    let indexContent = fs.readFileSync(indexPath, 'utf8');
    indexContent = indexContent.replace(
      /APIX Gateway\s+v[\d.]+/,
      `APIX Gateway  v${newVersion}`
    );
    fs.writeFileSync(indexPath, indexContent);
    success(`Updated src/index.js version banner`);
  }

  // 3. Generate changelog
  generateChangelog(ROOT, newVersion);
  success(`Generated CHANGELOG.md`);

  // 4. Generate release notes
  generateReleaseNotes(ROOT, newVersion);
  success(`Generated RELEASE-NOTES-v${newVersion}.md`);

  // 5. Generate version file
  const versionData = {
    version: newVersion,
    releasedAt: new Date().toISOString(),
    gitCommit: run('git rev-parse HEAD'),
    gitBranch: run('git rev-parse --abbrev-ref HEAD'),
    nodeVersion: process.version,
  };
  fs.writeFileSync(
    path.join(ROOT, 'VERSION.json'),
    JSON.stringify(versionData, null, 2) + '\n'
  );
  success(`Generated VERSION.json`);

  // 6. Stage all changes
  run('git add -A');
  success(`Staged all changes`);

  // 7. Create commit
  const commitMsg = `release: v${newVersion}`;
  run(`git commit -m "${commitMsg}"`);
  success(`Created commit: ${commitMsg}`);

  // 8. Create git tag
  const tagName = `v${newVersion}`;
  run(`git tag -a ${tagName} -m "Release ${tagName}"`);
  success(`Created tag: ${tagName}`);

  log('');
  log(`${c.green}${c.bold}Release v${newVersion} ready!${c.reset}`);
  log(`${c.gray}Run ${c.cyan}git push origin main --tags${c.gray} to publish${c.reset}`);
}

function cmdChangelog() {
  const version = getCurrentVersion(ROOT);
  generateChangelog(ROOT, version);
  success(`Generated CHANGELOG.md for v${version}`);
}

function cmdNotes() {
  const version = getCurrentVersion(ROOT);
  generateReleaseNotes(ROOT, version);
  success(`Generated RELEASE-NOTES-v${version}.md`);
}

function cmdStatus() {
  log(`${c.bold}APIX Gateway Status${c.reset}`);
  log('');

  const version = getCurrentVersion(ROOT);
  log(`  Version:   ${version}`);

  const branch = run('git rev-parse --abbrev-ref HEAD');
  log(`  Branch:    ${branch}`);

  const lastCommit = run('git log -1 --format="%h %s (%cr)"');
  log(`  Last:      ${lastCommit}`);

  const dirty = run('git status --porcelain');
  log(`  Clean:     ${dirty ? 'No (' + dirty.split('\n').length + ' files)' : 'Yes'}`);

  const tags = run('git tag --sort=-v:refname | head -5');
  if (tags) {
    log(`  Tags:      ${tags.split('\n')[0]}`);
  }

  const commitsSince = run('git describe --tags --abbrev=0 2>/dev/null');
  if (commitsSince) {
    const count = run(`git rev-list ${commitsSince}..HEAD --count`);
    log(`  Unreleased: ${count} commits`);
  }
}

function cmdHelp() {
  log(`
${c.bold}APIX Gateway CLI${c.reset}

${c.yellow}Usage:${c.reset}
  apix <command> [options]

${c.yellow}Commands:${c.reset}
  ${c.green}version${c.reset}              Show current version
  ${c.green}release${c.reset} [type]       Bump version and generate release artifacts
                        Types: patch, minor, major, auto (default: auto)
  ${c.green}changelog${c.reset}            Generate CHANGELOG.md from git commits
  ${c.green}notes${c.reset}                Generate release notes for current version
  ${c.green}status${c.reset}               Show project status summary
  ${c.green}help${c.reset}                 Show this help message

${c.yellow}Release Types:${c.reset}
  ${c.green}patch${c.reset}    Bug fixes, small changes       (1.0.0 → 1.0.1)
  ${c.green}minor${c.reset}    New features, non-breaking     (1.0.0 → 1.1.0)
  ${c.green}major${c.reset}    Breaking changes               (1.0.0 → 2.0.0)
  ${c.green}auto${c.reset}     Detect from commit messages    (default)

${c.yellow}Auto Detection (Conventional Commits):${c.reset}
  ${c.green}feat:${c.reset}     → minor bump
  ${c.green}fix:${c.reset}      → patch bump
  ${c.green}BREAKING:${c.reset}  → major bump

${c.yellow}Examples:${c.reset}
  apix release              # Auto-detect and release
  apix release patch        # Force patch release
  apix release minor        # Force minor release
  apix changelog            # Regenerate changelog
`);
}

// =======================
// MAIN
// =======================

const [,, command, ...args] = process.argv;

switch (command) {
  case 'version':
  case 'v':
    cmdVersion();
    break;
  case 'release':
  case 'r':
    cmdRelease(args[0] || 'auto');
    break;
  case 'changelog':
  case 'cl':
    cmdChangelog();
    break;
  case 'notes':
  case 'n':
    cmdNotes();
    break;
  case 'status':
  case 's':
    cmdStatus();
    break;
  case 'help':
  case 'h':
  case '--help':
  case undefined:
    cmdHelp();
    break;
  default:
    error(`Unknown command: ${command}. Run 'apix help' for usage.`);
}
