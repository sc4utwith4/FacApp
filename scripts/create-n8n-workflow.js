#!/usr/bin/env node

/**
 * Script para criar workflow no n8n via API HTTP
 * 
 * Uso:
 *   node scripts/create-n8n-workflow.js
 * 
 * Requer:
 *   - N8N_URL: URL do n8n (padrão: https://editor.epistemecompany.com.br)
 *   - N8N_API_KEY: API Key do n8n (obter do dashboard)
 */

const fs = require('fs');
const path = require('path');

// Configurações
const N8N_URL = process.env.N8N_URL || 'https://editor.epistemecompany.com.br';
const N8N_API_KEY = process.env.N8N_API_KEY || '';

// Caminho do workflow JSON
const WORKFLOW_PATH = path.join(__dirname, '..', 'workflows', 'assfac-ai-assistant.json');

async function createWorkflow() {
  try {
    // Ler workflow JSON
    console.log('📖 Lendo workflow JSON...');
    const workflowJson = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));
    
    if (!N8N_API_KEY) {
      console.error('❌ Erro: N8N_API_KEY não configurada');
      console.log('\nPara obter a API Key:');
      console.log('1. Acesse o n8n: https://editor.epistemecompany.com.br');
      console.log('2. Vá em Settings → API');
      console.log('3. Crie uma nova API Key');
      console.log('4. Execute: export N8N_API_KEY="sua-api-key"');
      console.log('5. Execute novamente este script');
      process.exit(1);
    }

    // Verificar se workflow já existe
    console.log('🔍 Verificando se workflow já existe...');
    const checkResponse = await fetch(`${N8N_URL}/api/v1/workflows`, {
      method: 'GET',
      headers: {
        'X-N8N-API-KEY': N8N_API_KEY,
        'Content-Type': 'application/json',
      },
    });

    if (checkResponse.ok) {
      const workflows = await checkResponse.json();
      const existing = workflows.data?.find(w => w.name === workflowJson.name);
      
      if (existing) {
        console.log(`⚠️  Workflow "${workflowJson.name}" já existe (ID: ${existing.id})`);
        console.log('💡 Para atualizar, use a interface web do n8n ou delete o workflow existente primeiro');
        return;
      }
    }

    // Criar workflow
    console.log('🚀 Criando workflow no n8n...');
    const createResponse = await fetch(`${N8N_URL}/api/v1/workflows`, {
      method: 'POST',
      headers: {
        'X-N8N-API-KEY': N8N_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: workflowJson.name,
        nodes: workflowJson.nodes,
        connections: workflowJson.connections,
        settings: workflowJson.settings,
        active: false, // Criar inativo primeiro para revisão
      }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Erro ao criar workflow: ${createResponse.status} - ${errorText}`);
    }

    const result = await createResponse.json();
    console.log('✅ Workflow criado com sucesso!');
    console.log(`   ID: ${result.data.id}`);
    console.log(`   Nome: ${result.data.name}`);
    console.log(`   Status: ${result.data.active ? 'Ativo' : 'Inativo'}`);
    console.log('\n📝 Próximos passos:');
    console.log('1. Acesse o n8n: https://editor.epistemecompany.com.br');
    console.log(`2. Abra o workflow "${workflowJson.name}"`);
    console.log('3. Verifique as credenciais do OpenAI (nó "OpenAI Chat Model")');
    console.log('4. Verifique as credenciais do Supabase (nós "Supabase Query Tool" e "Supabase Write Tool")');
    console.log('5. Ative o workflow clicando no botão "Active"');
    console.log('6. Teste o webhook:');
    console.log(`   curl -X POST ${N8N_URL}/webhook/assfac-ai-copilot \\`);
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -d \'{"question": "Quantos fornecedores temos?", "conversationId": "test"}\'');

  } catch (error) {
    console.error('❌ Erro:', error.message);
    if (error.message.includes('unauthorized') || error.message.includes('401')) {
      console.log('\n💡 Dica: Verifique se a API Key está correta e tem permissões adequadas');
    }
    process.exit(1);
  }
}

// Executar
createWorkflow();

