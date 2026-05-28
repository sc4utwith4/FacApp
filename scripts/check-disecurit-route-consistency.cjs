#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const hookPath = path.join(root, 'src/hooks/useDisecuritImport.ts');
const vercelPath = path.join(root, 'vercel.json');

const requiredRoutes = [
  '/api/disecurit-import',
  '/api/disecurit-reprocess',
  '/api/disecurit-parse',
];

function fileExists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(root, relPath), 'utf8'));
}

function readText(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function hasRewrite(vercelConfig, sourcePath, destinationSubstring) {
  const rewrites = Array.isArray(vercelConfig?.rewrites) ? vercelConfig.rewrites : [];
  return rewrites.some((rule) => {
    return (
      rule &&
      typeof rule.source === 'string' &&
      typeof rule.destination === 'string' &&
      rule.source === sourcePath &&
      rule.destination.includes(destinationSubstring)
    );
  });
}

function checkApiRouteCoverage() {
  const vercel = readJson('vercel.json');
  const hasDispatcher = fileExists('api/disecurit.ts');

  const directFiles = {
    '/api/disecurit-import': fileExists('api/disecurit-import.ts'),
    '/api/disecurit-reprocess': fileExists('api/disecurit-reprocess.ts'),
    '/api/disecurit-parse': fileExists('api/disecurit-parse.ts'),
  };

  const rewriteCoverage = {
    '/api/disecurit-import':
      hasDispatcher && hasRewrite(vercel, '/api/disecurit-import', '/api/disecurit?action=import'),
    '/api/disecurit-reprocess':
      hasDispatcher && hasRewrite(vercel, '/api/disecurit-reprocess', '/api/disecurit?action=reprocess'),
    '/api/disecurit-parse':
      hasDispatcher && hasRewrite(vercel, '/api/disecurit-parse', '/api/disecurit?action=parse'),
  };

  const missing = requiredRoutes.filter((route) => !directFiles[route] && !rewriteCoverage[route]);

  return {
    hasDispatcher,
    directFiles,
    rewriteCoverage,
    missing,
  };
}

function checkHookReferences() {
  const hook = readText('src/hooks/useDisecuritImport.ts');
  return {
    usesImportRoute: hook.includes("fetch('/api/disecurit-import'"),
    usesReprocessRoute: hook.includes("fetch('/api/disecurit-reprocess'"),
  };
}

function main() {
  const coverage = checkApiRouteCoverage();
  const hookRefs = checkHookReferences();

  console.log('[DISECURIT route check] Hook refs:', hookRefs);
  console.log('[DISECURIT route check] API coverage:', {
    hasDispatcher: coverage.hasDispatcher,
    directFiles: coverage.directFiles,
    rewriteCoverage: coverage.rewriteCoverage,
  });

  if (!hookRefs.usesImportRoute || !hookRefs.usesReprocessRoute) {
    console.error(
      '[DISECURIT route check] Falha: o hook mudou as rotas esperadas. Atualize este script/checklist.'
    );
    process.exit(1);
  }

  if (coverage.missing.length > 0) {
    console.error(
      '[DISECURIT route check] Falha: rotas sem cobertura em /api (arquivo direto ou rewrite):',
      coverage.missing.join(', ')
    );
    process.exit(1);
  }

  console.log('[DISECURIT route check] OK: rotas DISECURIT consistentes para deploy.');
}

main();
