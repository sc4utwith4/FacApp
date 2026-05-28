#!/usr/bin/env node
const { execSync } = require('node:child_process');

try {
  execSync('git config core.hooksPath .githooks', { stdio: 'inherit' });
  execSync('chmod +x .githooks/pre-commit', { stdio: 'inherit' });
  console.log('[hooks] core.hooksPath -> .githooks');
  console.log('[hooks] pre-commit hook installed');
} catch (error) {
  console.error('[hooks] failed to install hooks:', error.message);
  process.exit(1);
}
