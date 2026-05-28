#!/usr/bin/env node

/**
 * Script para criar super admins no Supabase
 * 
 * Uso:
 *   node scripts/create-super-admins.js
 * 
 * Requer variáveis de ambiente:
 *   SUPABASE_URL - URL do projeto Supabase
 *   SUPABASE_SERVICE_ROLE_KEY - Service Role Key (Admin)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Erro: Variáveis de ambiente necessárias:');
  console.error('   SUPABASE_URL ou VITE_SUPABASE_URL');
  console.error('   SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Criar cliente com Service Role Key (tem permissões admin)
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

function parseSuperAdminsFromEnv() {
  const raw = process.env.SUPER_ADMINS_JSON;
  if (!raw) {
    console.error('❌ Configure SUPER_ADMINS_JSON com a lista de usuários admin.');
    console.error('   Exemplo:');
    console.error(
      "   export SUPER_ADMINS_JSON='[{\"email\":\"admin1@example.com\",\"password\":\"<senha-forte>\",\"nome\":\"Admin 1\"}]'"
    );
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error('❌ SUPER_ADMINS_JSON inválido (não é JSON válido):', error.message);
    process.exit(1);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    console.error('❌ SUPER_ADMINS_JSON precisa ser um array com pelo menos 1 usuário.');
    process.exit(1);
  }

  const invalid = parsed.find((item) => {
    if (!item || typeof item !== 'object') return true;
    return !item.email || !item.password || !item.nome;
  });

  if (invalid) {
    console.error('❌ Cada item de SUPER_ADMINS_JSON deve conter email, password e nome.');
    process.exit(1);
  }

  return parsed;
}

const superAdmins = parseSuperAdminsFromEnv();

async function createSuperAdmin({ email, password, nome }) {
  try {
    console.log(`\n📧 Criando usuário: ${email}...`);
    
    // 1. Criar usuário via Admin API
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Confirmar email automaticamente
      user_metadata: {
        nome: nome
      }
    });

    if (authError) {
      // Se usuário já existe, continuar
      if (authError.message.includes('already registered') || authError.message.includes('already exists')) {
        console.log(`   ⚠️  Usuário ${email} já existe, buscando ID...`);
        
        // Buscar usuário existente
        const { data: users, error: listError } = await supabase.auth.admin.listUsers();
        if (listError) throw listError;
        
        const existingUser = users.users.find(u => u.email === email);
        if (!existingUser) {
          throw new Error(`Usuário ${email} não encontrado após verificar existência`);
        }
        
        authData.user = existingUser;
      } else {
        throw authError;
      }
    }

    const userId = authData.user.id;
    console.log(`   ✅ Usuário criado/encontrado: ${userId}`);

    // 2. Promover a super admin usando a função SQL
    const { data: promoteData, error: promoteError } = await supabase.rpc(
      'promote_to_super_admin',
      {
        p_email: email,
        p_nome: nome
      }
    );

    if (promoteError) {
      throw promoteError;
    }

    console.log(`   ✅ Promovido a super admin com sucesso!`);
    return { success: true, userId, email };

  } catch (error) {
    console.error(`   ❌ Erro ao criar ${email}:`, error.message);
    return { success: false, email, error: error.message };
  }
}

async function main() {
  console.log('🚀 Iniciando criação de super admins...\n');
  console.log(`📡 Conectando ao Supabase: ${supabaseUrl}\n`);

  const results = [];

  for (const admin of superAdmins) {
    const result = await createSuperAdmin(admin);
    results.push(result);
  }

  // Resumo
  console.log('\n' + '='.repeat(50));
  console.log('📊 RESUMO:');
  console.log('='.repeat(50));

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`\n✅ Sucesso: ${successful.length}/${results.length}`);
  successful.forEach(r => {
    console.log(`   - ${r.email} (ID: ${r.userId})`);
  });

  if (failed.length > 0) {
    console.log(`\n❌ Falhas: ${failed.length}/${results.length}`);
    failed.forEach(r => {
      console.log(`   - ${r.email}: ${r.error}`);
    });
  }

  console.log('\n' + '='.repeat(50));
  console.log('✨ Processo concluído!');
  console.log('='.repeat(50) + '\n');

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});
