const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const migrationFiles = [
  '20260218180000_create_bank_reconciliation.sql',
  '20260218213000_bank_reconciliation_phase2.sql',
  '20260219120000_bank_reconciliation_phase2_hotfix.sql',
];

const sqlPaths = migrationFiles.map((file) =>
  path.join(__dirname, '..', 'supabase', 'migrations', file)
);

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  '';

function printStatus(label, ok, detail = '') {
  const icon = ok ? 'OK' : 'ERRO';
  console.log(`[${icon}] ${label}${detail ? `: ${detail}` : ''}`);
}

function main() {
  let allFilesExist = true;

  for (const sqlPath of sqlPaths) {
    if (!fs.existsSync(sqlPath)) {
      printStatus('Arquivo SQL da migration', false, sqlPath);
      allFilesExist = false;
      continue;
    }

    const sqlStat = fs.statSync(sqlPath);
    printStatus('Arquivo SQL da migration', true, sqlPath);
    printStatus('Tamanho do arquivo', true, `${sqlStat.size} bytes`);
  }

  if (!allFilesExist) {
    process.exit(1);
  }

  const hasSupabaseUrl = Boolean(supabaseUrl);
  const hasServiceRole = Boolean(serviceRoleKey);

  printStatus('SUPABASE URL', hasSupabaseUrl, hasSupabaseUrl ? 'configurada' : 'nao configurada');
  printStatus(
    'SUPABASE SERVICE ROLE KEY',
    hasServiceRole,
    hasServiceRole ? 'configurada (valor oculto)' : 'nao configurada'
  );

  console.log('\nEste script NAO executa SQL automaticamente.');
  console.log('Fluxo recomendado para aplicar as migrations:');
  console.log('1) Abrir o SQL Editor do Supabase do projeto.');
  sqlPaths.forEach((sqlPath, index) => {
    console.log(`${index + 2}) Copiar e executar o conteudo de:\n   ${sqlPath}`);
  });
  console.log(`${sqlPaths.length + 2}) Validar criacao de tabelas, indices, politicas e RPCs.`);

  if (!hasServiceRole) {
    console.log(
      '\nOpcional: configure SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_SERVICE_KEY) apenas para scripts administrativos server-side.'
    );
  }

  console.log('\nChecklist rapido apos aplicar:');
  console.log('- tabelas: extratos_import, extrato_transacoes, conciliacoes_bancarias, regras_conciliacao');
  console.log('- tabelas A2/C: bank_reconciliation_audit_log, bank_ai_suggestions');
  console.log('- RPCs: rpc_bank_recompute_account_balance, rpc_bank_create_lancamento_and_reconcile, rpc_bank_confirm_reconciliation');
  console.log('- RPC A2: rpc_bank_split_reconciliation');
  console.log('- bucket: extratos-bancarios');
}

main();
