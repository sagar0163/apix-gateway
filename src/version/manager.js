/**
 * Version Manager - Semantic versioning with conventional commits
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Parse a semantic version string
 */
export function parseVersion(version) {
  const match = String(version).match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Invalid version: ${version}`);
  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3]),
    toString() { return `${this.major}.${this.minor}.${this.patch}`; }
  };
}

/**
 * Bump a version by type
 */
export function bumpVersion(version, type) {
  const v = parseVersion(version);

  switch (type) {
    case 'major':
      return `${v.major + 1}.0.0`;
    case 'minor':
      return `${v.major}.${v.minor + 1}.0`;
    case 'patch':
      return `${v.major}.${v.minor}.${v.patch + 1}`;
    default:
      throw new Error(`Invalid bump type: ${type}`);
  }
}

/**
 * Get current version from package.json
 */
export function getCurrentVersion(root) {
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

/**
 * Run a git command
 */
function git(cmd, root) {
  try {
    return execSync(`git ${cmd}`, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/**
 * Get commits since last tag
 */
export function getCommitsSinceTag(root) {
  const lastTag = git('describe --tags --abbrev=0 2>/dev/null', root);

  let range = '';
  if (lastTag) {
    const tagExists = git(`tag -l ${lastTag}`, root);
    if (tagExists) {
      range = `${lastTag}..HEAD`;
    }
  }

  const logFormat = '%H|||%s|||%an|||%ae|||%aI';
  const logCmd = range
    ? `git log ${range} --format="${logFormat}"`
    : `git log --format="${logFormat}"`;

  const output = git(logCmd.replace('git ', ''), root);
  if (!output) return [];

  return output.split('\n').filter(Boolean).map(line => {
    const [hash, subject, author, email, date] = line.split('|||');
    return { hash, subject, author, email, date };
  });
}

/**
 * Detect bump type from commit messages
 * Uses conventional commits: feat:, fix:, BREAKING:
 */
export function detectBumpType(root) {
  const commits = getCommitsSinceTag(root);

  if (commits.length === 0) return 'patch';

  let hasBreaking = false;
  let hasFeature = false;
  let hasFix = false;

  for (const commit of commits) {
    const msg = commit.subject.toLowerCase();

    if (msg.includes('breaking') || msg.includes('!:')) {
      hasBreaking = true;
    } else if (msg.startsWith('feat:') || msg.startsWith('feat(')) {
      hasFeature = true;
    } else if (msg.startsWith('fix:') || msg.startsWith('fix(')) {
      hasFix = true;
    } else if (msg.startsWith('docs:') || msg.startsWith('test:') || msg.startsWith('chore:')) {
      // These don't bump
    } else {
      hasFix = true; // Default to patch
    }
  }

  if (hasBreaking) return 'major';
  if (hasFeature) return 'minor';
  return 'patch';
}

/**
 * Categorize commits by type (for changelog)
 */
export function categorizeCommits(commits) {
  const categories = {
    breaking: [],
    features: [],
    fixes: [],
    docs: [],
    tests: [],
    performance: [],
    other: [],
  };

  for (const commit of commits) {
    const msg = commit.subject;

    if (msg.includes('BREAKING') || msg.includes('!:')) {
      categories.breaking.push(commit);
    } else if (/^feat(\(.+?\))?:/.test(msg)) {
      categories.features.push(commit);
    } else if (/^fix(\(.+?\))?:/.test(msg)) {
      categories.fixes.push(commit);
    } else if (/^docs(\(.+?\))?:/.test(msg)) {
      categories.docs.push(commit);
    } else if (/^test(\(.+?\))?:/.test(msg)) {
      categories.tests.push(commit);
    } else if (/^perf(\(.+?\))?:/.test(msg)) {
      categories.performance.push(commit);
    } else {
      categories.other.push(commit);
    }
  }

  return categories;
}
