/**
 * Release Notes Generator - Creates GitHub-ready release notes
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getCommitsSinceTag, categorizeCommits, parseVersion } from './manager.js';

function git(cmd, root) {
  try {
    return execSync(`git ${cmd}`, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/**
 * Count files changed and lines added/removed between tags
 */
function getDiffStats(root) {
  const lastTag = git('describe --tags --abbrev=0 2>/dev/null', root);
  if (!lastTag) {
    // No previous tag, count all files
    const files = git('ls-files', root);
    const fileCount = files ? files.split('\n').length : 0;
    return { filesChanged: fileCount, insertions: 0, deletions: 0, contributors: 0 };
  }

  const stat = git(`diff --stat ${lastTag}..HEAD`, root);
  const summary = stat.split('\n').pop() || '';

  const filesMatch = summary.match(/(\d+) files? changed/);
  const insertMatch = summary.match(/(\d+) insertions?/);
  const deleteMatch = summary.match(/(\d+) deletions?/);

  const authors = git(`log ${lastTag}..HEAD --format="%ae" | sort -u`, root);
  const contributorCount = authors ? authors.split('\n').filter(Boolean).length : 0;

  return {
    filesChanged: filesMatch ? parseInt(filesMatch[1]) : 0,
    insertions: insertMatch ? parseInt(insertMatch[1]) : 0,
    deletions: deleteMatch ? parseInt(deleteMatch[1]) : 0,
    contributors: contributorCount,
  };
}

/**
 * Get list of contributors since last tag
 */
function getContributors(root) {
  const lastTag = git('describe --tags --abbrev=0 2>/dev/null', root);
  const range = lastTag ? `${lastTag}..HEAD` : '';

  const logCmd = range
    ? `log ${range} --format="%aN|||%aE" `
    : `log --format="%aN|||%aE"`;

  const output = git(logCmd, root);
  if (!output) return [];

  const seen = new Map();
  for (const line of output.split('\n').filter(Boolean)) {
    const [name, email] = line.split('|||');
    if (!seen.has(email)) {
      seen.set(email, name);
    }
  }

  return Array.from(seen.values());
}

/**
 * Generate markdown release notes
 */
export function generateReleaseNotes(root, version) {
  const today = new Date().toISOString().split('T')[0];
  const commits = getCommitsSinceTag(root);
  const categories = categorizeCommits(commits);
  const stats = getDiffStats(root);
  const contributors = getContributors(root);
  const v = parseVersion(version);

  const lines = [];

  // Title
  lines.push(`# APIX Gateway v${version}`);
  lines.push('');
  lines.push(`Released: ${today}`);
  lines.push('');

  // Stats badge
  lines.push(`## Release Stats`);
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Commits | ${commits.length} |`);
  lines.push(`| Files Changed | ${stats.filesChanged} |`);
  lines.push(`| Lines Added | +${stats.insertions} |`);
  lines.push(`| Lines Removed | -${stats.deletions} |`);
  lines.push(`| Contributors | ${contributors.length} |`);
  lines.push('');

  // Breaking changes
  if (categories.breaking.length > 0) {
    lines.push('## BREAKING CHANGES');
    lines.push('');
    lines.push('> These changes may require updates to your configuration or code.');
    lines.push('');
    for (const commit of categories.breaking) {
      lines.push(`- ${commit.subject}`);
    }
    lines.push('');
  }

  // Highlights
  if (categories.features.length > 0) {
    lines.push('## Highlights');
    lines.push('');
    for (const commit of categories.features) {
      lines.push(`- **${commit.subject.replace(/^feat(\(.+?\))?:\s*/, '')}**`);
    }
    lines.push('');
  }

  // Bug fixes
  if (categories.fixes.length > 0) {
    lines.push('## Bug Fixes');
    lines.push('');
    for (const commit of categories.fixes) {
      lines.push(`- ${commit.subject.replace(/^fix(\(.+?\))?:\s*/, '')}`);
    }
    lines.push('');
  }

  // Performance
  if (categories.performance.length > 0) {
    lines.push('## Performance');
    lines.push('');
    for (const commit of categories.performance) {
      lines.push(`- ${commit.subject.replace(/^perf(\(.+?\))?:\s*/, '')}`);
    }
    lines.push('');
  }

  // Contributors
  if (contributors.length > 0) {
    lines.push('## Contributors');
    lines.push('');
    for (const name of contributors) {
      lines.push(`- @${name}`);
    }
    lines.push('');
  }

  // Installation
  lines.push('## Installation');
  lines.push('');
  lines.push('```bash');
  lines.push('npm install apix-gateway');
  lines.push('```');
  lines.push('');
  lines.push('```bash');
  lines.push('# Or clone and run');
  lines.push('git clone https://github.com/sagar0163/apix-gateway.git');
  lines.push('cd apix-gateway');
  lines.push('npm install');
  lines.push('npm start');
  lines.push('```');
  lines.push('');

  // Upgrade guide for major versions
  if (v.patch === 0 && v.minor === 0 && v.major > 1) {
    lines.push('## Upgrade Guide');
    lines.push('');
    lines.push('This is a major release with breaking changes. See BREAKING CHANGES above.');
    lines.push('');
    lines.push('1. Review breaking changes');
    lines.push('2. Update your configuration files');
    lines.push('3. Test in staging environment');
    lines.push('4. Deploy to production');
    lines.push('');
  }

  // Footer
  lines.push('---');
  lines.push(`*Full diff: [\`v${version}\`](https://github.com/sagar0163/apix-gateway/compare/v${v.major}.${v.minor > 0 ? v.minor - 1 : 0}.0...v${version})*`);
  lines.push('');

  const notesPath = path.join(root, `RELEASE-NOTES-v${version}.md`);
  fs.writeFileSync(notesPath, lines.join('\n'));
  return notesPath;
}
