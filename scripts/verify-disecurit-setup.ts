import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

async function verifySetup() {
    console.log('--- Verificando Setup DISECURIT ---');

    if (!supabaseUrl || !supabaseKey) {
        console.error('❌ Erro: VITE_SUPABASE_URL ou chaves do Supabase não encontradas no .env');
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Verificar Tabelas
    const tables = ['operation_import_files', 'operation_import_documents', 'integration_audit_log'];
    for (const table of tables) {
        const { error } = await supabase.from(table).select('id').limit(1);
        if (error) {
            console.error(`❌ Tabela ${table}: Não encontrada ou erro de acesso (${error.message})`);
        } else {
            console.log(`✅ Tabela ${table}: OK`);
        }
    }

    // 2. Verificar Bucket
    const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
    if (bucketError) {
        console.error(`❌ Erro ao listar buckets: ${bucketError.message}`);
    } else {
        const disecuriBucket = buckets.find(b => b.id === 'operacoes-disecurit-pdf');
        if (disecuriBucket) {
            console.log('✅ Bucket operacoes-disecurit-pdf: OK');
        } else {
            console.error('❌ Bucket operacoes-disecurit-pdf: Não encontrado');
        }
    }

    // 3. Verificar Variáveis de Ambiente n8n
    const n8nVars = [
        'N8N_DISECURIT_IMPORT_WEBHOOK_URL',
        'N8N_DISECURIT_REPROCESS_WEBHOOK_URL',
        'N8N_DISECURIT_INTEGRATION_SECRET'
    ];

    for (const v of n8nVars) {
        if (process.env[v]) {
            console.log(`✅ Variável ${v}: Configurada`);
        } else {
            console.warn(`⚠️ Variável ${v}: Ausente no .env (necessário para o frontend chamar o n8n)`);
        }
    }

    console.log('--- Verificação Concluída ---');
}

verifySetup().catch(console.error);
