#!/usr/bin/env ts-node
/**
 * Script para fazer rollback de migração
 * Remove dados migrados baseado em logs de migração
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Carregar variáveis de ambiente
dotenv.config({ path: path.join(__dirname, '../../.env.local') });

// Configurações
const BASE_DIR = path.join(__dirname, '../..');
const LOG_DIR = path.join(__dirname, 'logs');

// Schema de validação
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Erro: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  process.exit(1);
}

// Criar cliente Supabase
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Ordem reversa de migração (tabelas dependentes primeiro)
const ROLLBACK_ORDER = [
  // Tabelas transacionais (remover primeiro)
  'tarifas_fornecedor',
  'pagamentos_fornecedor',
  'duplicatas_fornecedor',
  'contratos_fornecedor',
  'movimentacoes_estoque',
  'operacoes_estoque',
  'estoques',
  'cheques',
  'operacoes',
  'lancamentos_caixa',
  
  // Tabelas dependentes
  'fornecedores',
  'clientes',
  'grupos_contas',
  'contas_bancarias',
  'profiles',
  
  // Tabelas base (remover por último)
  'empresas',
  'bancos',
  'ufs',
];

// Função para limpar tabela
async function clearTable(tableName: string): Promise<number> {
  console.log(`Limpando tabela: ${tableName}`);

  try {
    // Contar registros antes
    const { count: beforeCount } = await supabase
      .from(tableName)
      .select('*', { count: 'exact', head: true });

    // Deletar todos os registros
    const { error } = await supabase
      .from(tableName)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Deletar todos (truque)

    if (error) {
      console.error(`Erro ao limpar tabela ${tableName}:`, error);
      return 0;
    }

    console.log(`Tabela ${tableName} limpa: ${beforeCount} registros removidos`);
    return beforeCount || 0;

  } catch (error: any) {
    console.error(`Erro ao limpar tabela ${tableName}:`, error);
    return 0;
  }
}

// Função principal
async function main() {
  console.log('='.repeat(60));
  console.log('Rollback de Migração - Supabase');
  console.log('='.repeat(60));

  // Confirmar ação
  const args = process.argv.slice(2);
  if (!args.includes('--confirm')) {
    console.log('\n⚠️  ATENÇÃO: Esta operação irá DELETAR todos os dados migrados!');
    console.log('Execute com --confirm para prosseguir\n');
    process.exit(1);
  }

  console.log('\nIniciando rollback...\n');

  let totalRemoved = 0;

  // Limpar tabelas na ordem reversa
  for (const tableName of ROLLBACK_ORDER) {
    const removed = await clearTable(tableName);
    totalRemoved += removed;
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Rollback concluído! Total de registros removidos: ${totalRemoved}`);
  console.log('='.repeat(60));
}

// Executar
main().catch((error) => {
  console.error('Erro fatal no rollback:', error);
  process.exit(1);
});

