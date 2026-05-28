#!/usr/bin/env ts-node
/**
 * Script para migrar dados extraídos do Access para Supabase
 * Usa service_role_key para bypass de RLS durante migração
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Carregar variáveis de ambiente

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env.local') });

// Configurações
const BASE_DIR = path.join(__dirname, '../..');
const DATA_DIR = path.join(BASE_DIR, 'docs/migracao/dados_extraidos/transformed');
const MAPPING_DIR = path.join(BASE_DIR, 'docs/migracao/dados_extraidos/mappings');
const LOG_DIR = path.join(__dirname, 'logs');

// Criar diretório de logs
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Schema de validação para variáveis de ambiente
const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

// Validar variáveis de ambiente
const env = envSchema.parse({
  SUPABASE_URL: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
});

// Criar cliente Supabase com service_role_key (bypass RLS)
const supabase: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Logging
interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  data?: any;
}

const logs: LogEntry[] = [];

function log(level: LogEntry['level'], message: string, data?: any) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    data,
  };
  logs.push(entry);
  console.log(`[${entry.timestamp}] [${level.toUpperCase()}] ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

function saveLogs() {
  const logFile = path.join(LOG_DIR, `migration_${Date.now()}.json`);
  fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
  log('info', `Logs salvos em: ${logFile}`);
}

// Carregar mapeamentos de IDs
function loadIdMapping(tableName: string): Record<string, string> {
  const mappingFile = path.join(MAPPING_DIR, `${tableName}_mapping.json`);
  if (fs.existsSync(mappingFile)) {
    return JSON.parse(fs.readFileSync(mappingFile, 'utf-8'));
  }
  return {};
}

// Carregar mapeamento BIGINT de estoques (legacy_id -> BIGINT)
function loadEstoquesBigintMapping(): Record<string, number> {
  const mappingFile = path.join(MAPPING_DIR, 'estoques_bigint_mapping.json');
  if (fs.existsSync(mappingFile)) {
    try {
      return JSON.parse(fs.readFileSync(mappingFile, 'utf-8'));
    } catch (e) {
      log('warn', `Erro ao carregar mapeamento BIGINT de estoques: ${e}`, { mappingFile });
      return {};
    }
  }
  return {};
}

// Carregar mapeamento BIGINT de operacoes_estoque (legacy_id -> BIGINT)
function loadOperacoesEstoqueBigintMapping(): Record<string, number> {
  const mappingFile = path.join(MAPPING_DIR, 'operacoes_estoque_bigint_mapping.json');
  if (fs.existsSync(mappingFile)) {
    try {
      return JSON.parse(fs.readFileSync(mappingFile, 'utf-8'));
    } catch (e) {
      log('warn', `Erro ao carregar mapeamento BIGINT de operacoes_estoque: ${e}`, { mappingFile });
      return {};
    }
  }
  return {};
}

// Resolver foreign key usando mapeamento
function resolveForeignKey(
  tableName: string,
  legacyId: any,
  mapping: Record<string, string>
): string | null {
  if (!legacyId) return null;
  const legacyIdStr = String(legacyId);
  return mapping[legacyIdStr] || null;
}

// Carregar mapeamento de tabelas
const MAPPING_FILE = path.join(__dirname, 'table_mapping.json');
const SCHEMA_FILE = path.join(__dirname, 'schema_validation.json');
let TABLE_MAPPING: Record<string, string> = {};
let FIELD_MAPPINGS: Record<string, Record<string, string>> = {};
let TYPE_CONVERSIONS: Record<string, Record<string, string>> = {};
let VALID_COLUMNS: Record<string, string[]> = {};
let REQUIRED_FIELDS: Record<string, string[]> = {};
let DEFAULTS: Record<string, Record<string, any>> = {};
let FIELD_TYPES: Record<string, Record<string, string>> = {};

if (fs.existsSync(MAPPING_FILE)) {
  const mapping = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf-8'));
  TABLE_MAPPING = mapping.table_mapping || {};
  FIELD_MAPPINGS = mapping.field_mapping || {};
  TYPE_CONVERSIONS = mapping.type_conversions || {};
}

if (fs.existsSync(SCHEMA_FILE)) {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf-8'));
  VALID_COLUMNS = schema.valid_columns || {};
  REQUIRED_FIELDS = schema.required_fields || {};
  DEFAULTS = schema.defaults || {};
  FIELD_TYPES = schema.field_types || {};
}

// Ordem de migração (tabelas base primeiro)
const MIGRATION_ORDER = [
  // Tabelas base (sem dependências)
  'ufs',
  'bancos',
  'empresas',
  
  // Tabelas dependentes
  'profiles',
  'contas_bancarias',
  'grupos_contas',
  'clientes',
  'fornecedores',
  
  // Tabelas transacionais
  'lancamentos_caixa',
  'operacoes',
  'cheques',
  'estoques',
  'operacoes_estoque',
  'movimentacoes_estoque',
  'contratos_fornecedor',
  'duplicatas_fornecedor',
  'pagamentos_fornecedor',
  'tarifas_fornecedor',
];

// Função para mapear nome de tabela Access para PostgreSQL
function mapTableName(accessTableName: string): string | null {
  // Verificar mapeamento direto
  if (TABLE_MAPPING[accessTableName]) {
    return TABLE_MAPPING[accessTableName];
  }
  
  // Tentar mapeamento case-insensitive
  const lowerName = accessTableName.toLowerCase();
  for (const [access, pg] of Object.entries(TABLE_MAPPING)) {
    if (access.toLowerCase() === lowerName) {
      return pg;
    }
  }
  
  // Se não encontrado, retornar null
  return null;
}

// Função para gerar UUID se necessário
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Função para converter tipo de operação
function convertType(fieldName: string, value: any): any {
  if (TYPE_CONVERSIONS[fieldName] && value) {
    const valueStr = String(value).toUpperCase();
    return TYPE_CONVERSIONS[fieldName][valueStr] || value;
  }
  return value;
}

// Função para converter data com validação
function convertDate(dateStr: any): string | null {
  if (!dateStr) return null;
  
  const str = String(dateStr).trim();
  if (!str || str === 'null' || str === '') return null;
  
  // Remover hora se presente (ex: "01/05/23 00:00:00" -> "01/05/23")
  const dateOnly = str.split(' ')[0];
  
  // Tentar diferentes formatos
  // Formato DD/MM/YY (2 dígitos de ano) - PRIORIDADE
  const matchYY = dateOnly.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (matchYY) {
    const [, day, month, year] = matchYY;
    const dayInt = parseInt(day);
    const monthInt = parseInt(month);
    const yearInt = parseInt(year);
    
    // Validar mês e dia
    if (monthInt < 1 || monthInt > 12) {
      log('warn', `Data inválida: mês ${monthInt} fora do range (1-12)`, { original: str });
      return null;
    }
    if (dayInt < 1 || dayInt > 31) {
      log('warn', `Data inválida: dia ${dayInt} fora do range (1-31)`, { original: str });
      return null;
    }
    
    // Assumir 2000+ para anos de 2 dígitos (23 = 2023, 25 = 2025)
    const fullYear = yearInt < 50 ? `20${year.padStart(2, '0')}` : `19${year.padStart(2, '0')}`;
    const result = `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    
    // Validar data final (ex: não permitir 2024-20-08)
    const dateObj = new Date(result);
    if (isNaN(dateObj.getTime())) {
      log('warn', `Data inválida após conversão: ${result}`, { original: str });
      return null;
    }
    
    return result;
  }
  
  // Formato DD/MM/YYYY (4 dígitos de ano)
  const matchYYYY = dateOnly.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (matchYYYY) {
    const [, day, month, year] = matchYYYY;
    const monthInt = parseInt(month);
    const dayInt = parseInt(day);
    
    // Validar mês e dia
    if (monthInt < 1 || monthInt > 12 || dayInt < 1 || dayInt > 31) {
      log('warn', `Data inválida: ${dateOnly}`, { original: str });
      return null;
    }
    
    const result = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const dateObj = new Date(result);
    if (isNaN(dateObj.getTime())) {
      log('warn', `Data inválida após conversão: ${result}`, { original: str });
      return null;
    }
    
    return result;
  }
  
  // Formato YYYY-MM-DD
  const matchISO = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (matchISO) {
    const [, year, month, day] = matchISO;
    const monthInt = parseInt(month);
    const dayInt = parseInt(day);
    
    // Validar mês e dia
    if (monthInt < 1 || monthInt > 12 || dayInt < 1 || dayInt > 31) {
      log('warn', `Data inválida: ${dateOnly}`, { original: str });
      return null;
    }
    
    return dateOnly.substring(0, 10);
  }
  
  // Formato DD-MM-YYYY
  const matchDash = dateOnly.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (matchDash) {
    const [, day, month, year] = matchDash;
    const monthInt = parseInt(month);
    const dayInt = parseInt(day);
    
    // Validar mês e dia
    if (monthInt < 1 || monthInt > 12 || dayInt < 1 || dayInt > 31) {
      log('warn', `Data inválida: ${dateOnly}`, { original: str });
      return null;
    }
    
    const result = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const dateObj = new Date(result);
    if (isNaN(dateObj.getTime())) {
      log('warn', `Data inválida após conversão: ${result}`, { original: str });
      return null;
    }
    
    return result;
  }
  
  // Tentar formato timestamp (ex: "20230113182650")
  const matchTimestamp = str.match(/^(\d{4})(\d{2})(\d{2})/);
  if (matchTimestamp) {
    const [, year, month, day] = matchTimestamp;
    const monthInt = parseInt(month);
    const dayInt = parseInt(day);
    
    // Validar mês e dia
    if (monthInt < 1 || monthInt > 12 || dayInt < 1 || dayInt > 31) {
      log('warn', `Data inválida do timestamp: ${str}`, { original: str });
      return null;
    }
    
    return `${year}-${month}-${day}`;
  }
  
  log('warn', `Formato de data não reconhecido: ${str}`);
  return null;
}

// Cache para UUIDs existentes na tabela fornecedores
let fornecedoresIdsCache: Set<string> | null = null;

// Verificar se UUID existe na tabela fornecedores
async function fornecedorIdExists(uuid: string): Promise<boolean> {
  if (!fornecedoresIdsCache) {
    // Carregar cache na primeira chamada
    const { data, error } = await supabase
      .from('fornecedores')
      .select('id');
    
    if (error) {
      log('warn', `Erro ao verificar fornecedores: ${error.message}`);
      return false;
    }
    
    fornecedoresIdsCache = new Set(data?.map((f: any) => f.id) || []);
    log('info', `Cache de fornecedores carregado: ${fornecedoresIdsCache.size} registros`);
  }
  
  return fornecedoresIdsCache.has(uuid);
}

// Migrar tabela
async function migrateTable(
  pgTableName: string,
  accessTableName: string,
  data: any[],
  batchSize: number = 1000
): Promise<{ success: number; errors: number }> {
  log('info', `Iniciando migração: ${accessTableName} -> ${pgTableName}`, { total: data.length });

  let success = 0;
  let errors = 0;
  
  // Resetar cache de fornecedores se estiver migrando fornecedores
  if (pgTableName === 'fornecedores') {
    fornecedoresIdsCache = null;
  }

  // Carregar mapeamentos necessários
  const idMapping = loadIdMapping(pgTableName);
  const empresaMapping = loadIdMapping('empresas');
  const clienteMapping = loadIdMapping('clientes');
  const fornecedorMapping = loadIdMapping('fornecedores');
  const bancoMapping = loadIdMapping('bancos');
  const grupoContasMapping = loadIdMapping('grupos_contas');
  const estoquesBigintMapping = loadEstoquesBigintMapping(); // Mapeamento legacy_id -> BIGINT para estoques
  
  // VALIDAÇÃO CRÍTICA: Se empresas não foi migrada, abortar para tabelas dependentes
  if (pgTableName !== 'empresas' && Object.keys(empresaMapping).length === 0) {
    log('error', `Mapeamento de empresas está vazio! Empresas deve ser migrada primeiro.`, { pgTableName });
    log('error', `Abortando migração de ${pgTableName} até que empresas seja migrada com sucesso.`);
    return { success: 0, errors: data.length };
  }
  
  // Log quando empresaMapping está vazio (não deveria acontecer após validação acima)
  if (pgTableName !== 'empresas' && Object.keys(empresaMapping).length === 0) {
    log('warn', `ATENÇÃO: empresaMapping está vazio ao iniciar ${pgTableName}`, { pgTableName });
  }

  // Processar em lotes
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(data.length / batchSize);

    log('info', `Processando lote ${batchNum}/${totalBatches}`, {
      batchSize: batch.length,
      progress: `${i + batch.length}/${data.length}`,
    });

    try {
      // Transformar dados do lote
      // IMPORTANTE: Usar Promise.all() porque temos await dentro do loop (verificação de fornecedor_id)
      let transformedBatch = await Promise.all(batch.map(async (row) => {
        const transformed: any = {};
        const fieldMapping = FIELD_MAPPINGS[pgTableName] || {};

        // Aplicar mapeamento de campos
        // IMPORTANTE: Não mapear campos de FK nas próprias tabelas e validar colunas existentes
        const selfFKFields = {
          'empresas': ['empresa_id'],
          'clientes': ['cliente_id'],
          'fornecedores': ['fornecedor_id'],
          'bancos': ['banco_id', 'empresa_id'], // bancos não tem empresa_id
          'grupos_contas': ['grupo_contas_id']
        };
        const skipFields = selfFKFields[pgTableName] || [];
        const validColumns = VALID_COLUMNS[pgTableName] || [];
        
        for (const [accessField, pgField] of Object.entries(fieldMapping)) {
          // Pular campos de FK nas próprias tabelas
          if (skipFields.includes(pgField)) {
            continue;
          }
          
          // Validar se campo existe no schema
          if (validColumns.length > 0 && !validColumns.includes(pgField)) {
            log('warn', `Campo ${pgField} não existe na tabela ${pgTableName}, pulando`, { accessField, pgField });
            continue;
          }
          
          // Remover referências herdadas do Access (ex: CAI_CLI_AutoCodigo, REC_CLI_AutoCodigo)
          if (accessField.includes('CLI_') && pgTableName === 'lancamentos_caixa') {
            continue; // cliente_id não existe em lancamentos_caixa
          }
          
          if (accessField in row) {
            let value = row[accessField];
            
            // Converter tipos especiais
            if (pgField === 'tipo' || pgField === 'tipo_operacao') {
              value = convertType('tipo', value, pgTableName);
            } else if (pgField === 'estoque_id') {
              // CORREÇÃO CRÍTICA: estoque_id deve ser sempre BIGINT, nunca UUID
              // IMPORTANTE: Usar mapeamento BIGINT de estoques se disponível
              // Primeiro tentar usar mapeamento BIGINT se disponível
              const valueStr = String(value);
              log('debug', `DEBUG estoque_id: processando campo ${accessField} -> ${pgField}, valueStr=${valueStr}, tipo=${typeof value}`, {
                accessField,
                pgTableName,
                valueStr,
                valueType: typeof value,
                isUUID: valueStr.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) ? true : false,
                hasBigintMapping: Object.prototype.hasOwnProperty.call(estoquesBigintMapping, valueStr),
                bigintMappingValue: estoquesBigintMapping[valueStr] || null
              });
              if (Object.prototype.hasOwnProperty.call(estoquesBigintMapping, valueStr)) {
                value = estoquesBigintMapping[valueStr];
                log('debug', `DEBUG estoque_id: mapeamento BIGINT encontrado: ${valueStr} -> ${value}`, {
                  accessField,
                  pgTableName,
                  valueStr,
                  bigintValue: value
                });
              } else {
                log('error', `estoque_id ${valueStr} não encontrado no mapeamento BIGINT de estoques`, {
                  accessField,
                  pgTableName,
                  valueStr,
                  isUUID: valueStr.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) ? true : false
                });
                value = null;
              }
            } else if (pgField.includes('data') || pgField.includes('_at')) {
              value = convertDate(value);
            } else if (pgField.includes('valor') || pgField.includes('saldo') || pgField.includes('limite')) {
              // Converter valores monetários
              if (value && value !== 'null' && value !== '') {
                const numValue = parseFloat(String(value).replace(',', '.'));
                value = isNaN(numValue) ? null : numValue;
              } else {
                value = null;
              }
            }
            
            // Não adicionar campos que não existem na tabela
            if (pgField && value !== undefined && value !== null) {
              transformed[pgField] = value;
            }
          }
        }
        
        // Aplicar defaults para campos obrigatórios
        if (DEFAULTS[pgTableName]) {
          for (const [field, defaultValue] of Object.entries(DEFAULTS[pgTableName])) {
            if (!(field in transformed) || transformed[field] === null || transformed[field] === undefined) {
              transformed[field] = defaultValue;
            }
          }
        }
        
        // Fallback específico para fornecedores: usar FOR_Nome como razao_social se FOR_RazaoSocial for null
        if (pgTableName === 'fornecedores' && (!transformed.razao_social || transformed.razao_social === null)) {
          // Tentar usar FOR_Nome como fallback
          const nomeField = fieldMapping['FOR_Nome'];
          if (nomeField && row['FOR_Nome']) {
            transformed.razao_social = row['FOR_Nome'];
            log('info', `Usando FOR_Nome como fallback para razao_social em fornecedores`, { FOR_Nome: row['FOR_Nome'] });
          }
        }

        // Gerar UUID para ID se necessário
        // IMPORTANTE: Sempre usar mapeamento legacy_id → UUID, nunca usar IDs legados diretamente
        // CORREÇÃO: Buscar campo Access → id a partir de FIELD_MAPPINGS em vez de inferir pelo prefixo
        // EXCEÇÃO: estoques.id e operacoes_estoque.id são BIGSERIAL (não UUID), então não gerar UUID para eles
        // Para estoques e operacoes_estoque, deixar o banco gerar BIGSERIAL automaticamente (não incluir id no transformed)
        if (pgTableName === 'estoques' || pgTableName === 'operacoes_estoque') {
          // Para estoques e operacoes_estoque, não gerar UUID - deixar o banco gerar BIGSERIAL automaticamente
          // Remover id do transformed se existir (será gerado pelo banco)
          delete transformed.id;
          log('info', `${pgTableName}: deixando banco gerar BIGSERIAL para id`, { row: Object.keys(row) });
        } else if (pgTableName === 'empresas' || pgTableName === 'clientes' || pgTableName === 'fornecedores' || pgTableName === 'bancos' || pgTableName === 'grupos_contas' || pgTableName === 'operacoes' || pgTableName === 'lancamentos_caixa') {
          // Buscar campo Access que mapeia para "id" a partir de FIELD_MAPPINGS
          let legacyIdField: string | null = null;
          for (const [accessField, pgField] of Object.entries(fieldMapping)) {
            if (pgField === 'id') {
              legacyIdField = accessField;
              break;
            }
          }
          
          // Fallback: tentar inferir pelo prefixo se não encontrou no mapeamento
          if (!legacyIdField) {
            const idPrefix = accessTableName.substring(0, 3).toUpperCase();
            legacyIdField = `${idPrefix}_AutoCodigo`;
          }
          
          // Buscar ID legado
          const legacyId = legacyIdField && row[legacyIdField] ? row[legacyIdField] : (row.id || null);
          
          // Limpar id do objeto transformado para garantir que sempre seja UUID
          delete transformed.id;
          
          if (legacyId) {
            const legacyIdStr = String(legacyId);
            // Criar mapeamento se não existir
            if (!idMapping[legacyIdStr]) {
              idMapping[legacyIdStr] = generateUUID();
              // Salvar mapeamento imediatamente
              const mappingFile = path.join(MAPPING_DIR, `${pgTableName}_mapping.json`);
              fs.writeFileSync(mappingFile, JSON.stringify(idMapping, null, 2));
              log('info', `Mapeamento criado: ${legacyIdStr} -> ${idMapping[legacyIdStr]} para ${pgTableName}`, { accessField: legacyIdField });
            }
            // SEMPRE usar UUID do mapeamento, nunca o ID legado
            transformed.id = idMapping[legacyIdStr];
          } else {
            // Gerar UUID se não houver ID legado
            const newUUID = generateUUID();
            transformed.id = newUUID;
            // Salvar mapeamento mesmo sem ID legado (para rastreabilidade)
            const legacyIdStr = legacyIdField ? String(row[legacyIdField] || 'null') : 'null';
            idMapping[legacyIdStr] = newUUID;
            const mappingFile = path.join(MAPPING_DIR, `${pgTableName}_mapping.json`);
            fs.writeFileSync(mappingFile, JSON.stringify(idMapping, null, 2));
            log('warn', `ID legado não encontrado para ${pgTableName}, gerado UUID: ${newUUID}`, { accessField: legacyIdField, row: Object.keys(row) });
          }
          
          // VALIDAÇÃO CRÍTICA: Garantir que ID é UUID válido, não número legado
          if (transformed.id && !transformed.id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
            log('error', `ID inválido detectado (não é UUID): ${transformed.id}`, { legacyId, pgTableName, accessField: legacyIdField });
            // Forçar geração de UUID válido e atualizar mapeamento
            const legacyIdStr = legacyId ? String(legacyId) : 'null';
            const newUUID = generateUUID();
            idMapping[legacyIdStr] = newUUID;
            const mappingFile = path.join(MAPPING_DIR, `${pgTableName}_mapping.json`);
            fs.writeFileSync(mappingFile, JSON.stringify(idMapping, null, 2));
            transformed.id = newUUID;
            log('info', `ID corrigido: ${legacyIdStr} -> ${newUUID} para ${pgTableName}`);
          }
        }

        // Resolver foreign keys dos campos originais do Access
        // IMPORTANTE: Usar mapeamento legacy_id → UUID, NÃO usar IDs legados diretamente
        
        // Verificar campos originais que podem conter IDs legados
        for (const [accessField, pgField] of Object.entries(fieldMapping)) {
          // Pular campos de FK nas próprias tabelas
          if (skipFields.includes(pgField)) {
            continue;
          }
          
          if (pgField.includes('_id') && accessField in row) {
            const legacyId = row[accessField];
            if (legacyId && legacyId !== '0' && legacyId !== 0 && legacyId !== 'null') {
              const legacyIdStr = String(legacyId);
              // Resolver baseado no tipo de FK usando mapeamento
              if (pgField === 'empresa_id' && empresaMapping[legacyIdStr]) {
                transformed.empresa_id = empresaMapping[legacyIdStr];
              } else if (pgField === 'cliente_id' && clienteMapping[legacyIdStr]) {
                transformed.cliente_id = clienteMapping[legacyIdStr];
              } else if (pgField === 'fornecedor_id') {
                // Verificar se fornecedor_id existe na tabela destino
                const validColumns = VALID_COLUMNS[pgTableName] || [];
                if (validColumns.includes('fornecedor_id')) {
                  if (fornecedorMapping[legacyIdStr]) {
                    const fornecedorUuid = fornecedorMapping[legacyIdStr];
                    // Verificar se o UUID existe na tabela fornecedores
                    const exists = await fornecedorIdExists(fornecedorUuid);
                    if (exists) {
                      transformed.fornecedor_id = fornecedorUuid;
                    } else {
                      // Se o UUID não existir na tabela, definir como null
                      log('warn', `fornecedor_id UUID ${fornecedorUuid} não existe na tabela fornecedores, definindo como null`, { accessField, pgTableName, legacyId: legacyIdStr });
                      transformed.fornecedor_id = null;
                    }
                  } else {
                    // Se fornecedor_id não for encontrado, definir como null (não é obrigatório)
                    log('warn', `FK mapping not found for fornecedor_id, table ${pgTableName}, legacy ID ${legacyIdStr}, definindo como null`, { accessField, pgTableName });
                    transformed.fornecedor_id = null;
                  }
                }
                // Se fornecedor_id não existe na tabela, não tentar inserir (ex: lancamentos_caixa)
              } else if (pgField === 'banco_id' && bancoMapping[legacyIdStr]) {
                transformed.banco_id = bancoMapping[legacyIdStr];
              } else if (pgField === 'grupo_contas_id' && grupoContasMapping[legacyIdStr]) {
                transformed.grupo_contas_id = grupoContasMapping[legacyIdStr];
              } else if (pgField === 'estoque_id') {
                // Para estoque_id, é BIGINT (FK para estoques.id que é BIGSERIAL)
                // Não é UUID, então usar o ID legado diretamente como BIGINT
                // CORREÇÃO CRÍTICA: Garantir que estoque_id NUNCA seja UUID, sempre BIGINT
                // IMPORTANTE: Usar mapeamento BIGINT de estoques se disponível
                // Primeiro tentar usar mapeamento BIGINT se disponível
                if (estoquesBigintMapping[legacyIdStr]) {
                  transformed.estoque_id = estoquesBigintMapping[legacyIdStr];
                  log('info', `estoque_id resolvido via mapeamento BIGINT: ${legacyIdStr} -> ${estoquesBigintMapping[legacyIdStr]}`, { accessField, pgTableName });
                } else {
                  // Se não houver mapeamento, tentar usar ID legado diretamente como BIGINT
                  // VALIDAÇÃO: Se for UUID, descartar e logar erro
                  if (legacyIdStr.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
                    log('error', `estoque_id não pode ser UUID: ${legacyIdStr} (deve ser BIGINT)`, { accessField, legacyIdStr, pgTableName });
                    // Não atribuir UUID como estoque_id
                  } else {
                    // Converter explicitamente para número inteiro positivo
                    const estoqueId = parseInt(legacyIdStr, 10);
                    if (!isNaN(estoqueId) && Number.isInteger(estoqueId) && estoqueId > 0) {
                      transformed.estoque_id = estoqueId;
                      log('info', `estoque_id convertido para BIGINT: ${legacyIdStr} -> ${estoqueId}`, { accessField, pgTableName });
                    } else {
                      log('error', `estoque_id ${legacyIdStr} não é numérico inteiro positivo para ${pgTableName}`, { accessField, legacyIdStr });
                    }
                  }
                }
              }
            }
          }
        }
        
        // Também verificar campos que não estão no mapeamento mas podem ser FKs
        // IMPORTANTE: Usar mapeamento legacy_id → UUID, NÃO usar IDs legados diretamente
        // Exemplo: CAI_FOR_AutoCodigo, SLI_SLD_AutoCodigo, etc.
        // NÃO incluir CAI_CLI_AutoCodigo ou REC_CLI_AutoCodigo (cliente_id não existe em lancamentos_caixa)
        for (const [key, value] of Object.entries(row)) {
          if (key.includes('_AutoCodigo') && value && value !== '0' && value !== 0 && value !== 'null') {
            const valueStr = String(value);
            
            // Tentar resolver como empresa_id (apenas se não for tabela empresas e campo existe)
            if (key.includes('EMP_') && pgTableName !== 'empresas' && !transformed.empresa_id) {
              if (empresaMapping[valueStr]) {
                transformed.empresa_id = empresaMapping[valueStr];
              } else {
                log('error', `FK mapping not found for empresa_id, table ${pgTableName}, legacy ID ${valueStr}`, { key, valueStr, pgTableName });
                // Não inserir se empresa_id não for encontrado
              }
            }
            // Tentar resolver como cliente_id (apenas se não for tabela clientes e campo existe)
            if (key.includes('CLI_') && pgTableName !== 'clientes' && !transformed.cliente_id) {
              // Verificar se cliente_id existe na tabela destino
              const validColumns = VALID_COLUMNS[pgTableName] || [];
              if (!validColumns.includes('cliente_id')) {
                // Campo não existe na tabela, não tentar inserir (ex: lancamentos_caixa)
                continue; // Pular este campo completamente
              }
              if (clienteMapping[valueStr]) {
                transformed.cliente_id = clienteMapping[valueStr];
              } else {
                log('warn', `FK mapping not found for cliente_id, table ${pgTableName}, legacy ID ${valueStr}`, { key, valueStr, pgTableName });
              }
            }
            // Tentar resolver como fornecedor_id (apenas se não for tabela fornecedores e campo existe)
            // IMPORTANTE: fornecedor_id NÃO existe em lancamentos_caixa
            if (key.includes('FOR_') && pgTableName !== 'fornecedores' && !transformed.fornecedor_id) {
              // Verificar se fornecedor_id existe na tabela destino
              const validColumns = VALID_COLUMNS[pgTableName] || [];
              if (!validColumns.includes('fornecedor_id')) {
                // Campo não existe na tabela, não tentar inserir (ex: lancamentos_caixa)
                continue; // Pular este campo completamente
              }
              if (fornecedorMapping[valueStr]) {
                const fornecedorUuid = fornecedorMapping[valueStr];
                // Verificar se o UUID existe na tabela fornecedores
                const exists = await fornecedorIdExists(fornecedorUuid);
                if (exists) {
                  transformed.fornecedor_id = fornecedorUuid;
                } else {
                  // Se o UUID não existir na tabela, definir como null
                  log('warn', `fornecedor_id UUID ${fornecedorUuid} não existe na tabela fornecedores, definindo como null`, { key, valueStr, pgTableName, legacyId: valueStr });
                  transformed.fornecedor_id = null;
                }
              } else {
                // Se fornecedor_id não for encontrado, definir como null (não é obrigatório)
                log('warn', `FK mapping not found for fornecedor_id, table ${pgTableName}, legacy ID ${valueStr}, definindo como null`, { key, valueStr, pgTableName });
                transformed.fornecedor_id = null;
              }
            }
            // Tentar resolver como banco_id (apenas se não for tabela bancos e campo existe)
            if (key.includes('BAN_') && pgTableName !== 'bancos' && !transformed.banco_id) {
              if (bancoMapping[valueStr]) {
                transformed.banco_id = bancoMapping[valueStr];
              } else {
                log('warn', `Banco ID ${valueStr} não encontrado no mapeamento para ${pgTableName}`, { key, valueStr });
              }
            }
            // Tentar resolver como grupo_contas_id (apenas se não for tabela grupos_contas e campo existe)
            if (key.includes('GCT_') && pgTableName !== 'grupos_contas' && !transformed.grupo_contas_id) {
              if (grupoContasMapping[valueStr]) {
                transformed.grupo_contas_id = grupoContasMapping[valueStr];
              } else {
                log('warn', `Grupo Contas ID ${valueStr} não encontrado no mapeamento para ${pgTableName}`, { key, valueStr });
              }
            }
            // Tentar resolver como estoque_id (SLD = Saldos)
            // IMPORTANTE: estoque_id é BIGINT, não UUID (estoques.id é BIGSERIAL)
            // CORREÇÃO CRÍTICA: Garantir que estoque_id NUNCA seja UUID, sempre BIGINT
            // Usar mapeamento BIGINT de estoques (legacy_id -> BIGINT) se disponível
            // EXCEÇÃO: estoques não tem estoque_id (tem id que é BIGSERIAL), então não processar estoque_id para estoques
            // CORREÇÃO: Sempre tentar redefinir estoque_id se estiver null ou for UUID inválido
            if ((key.includes('SLD_') || key.includes('SLI_SLD_')) && pgTableName !== 'estoques') {
              // Verificar se estoque_id já está definido e é um UUID inválido (deve ser BIGINT)
              const currentEstoqueId = transformed.estoque_id;
              const isInvalidUUID = currentEstoqueId && typeof currentEstoqueId === 'string' && currentEstoqueId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
              
              // Se não existe ou é UUID inválido, tentar usar mapeamento BIGINT
              if (!currentEstoqueId || isInvalidUUID) {
                if (Object.prototype.hasOwnProperty.call(estoquesBigintMapping, valueStr)) {
                  transformed.estoque_id = estoquesBigintMapping[valueStr];
                  if (isInvalidUUID) {
                    log('warn', `estoque_id era UUID inválido (${currentEstoqueId}), corrigido para BIGINT (${estoquesBigintMapping[valueStr]})`, {
                      key,
                      valueStr,
                      pgTableName,
                      oldValue: currentEstoqueId,
                      newValue: estoquesBigintMapping[valueStr]
                    });
                  }
                } else {
                  log('error', `estoque_id ${valueStr} não encontrado no mapeamento BIGINT de estoques`, {
                    key,
                    valueStr,
                    pgTableName,
                    currentValue: currentEstoqueId,
                  });
                  // Se não encontrou mapeamento, definir como null para ser filtrado depois
                  transformed.estoque_id = null;
                }
              }
            }
          }
        }

        // Adicionar empresa_id padrão se não existir (usar primeira empresa)
        // IMPORTANTE: Garantir que empresas seja migrada primeiro
        if (!transformed.empresa_id && pgTableName !== 'empresas') {
          const firstEmpresaId = Object.values(empresaMapping)[0];
          if (firstEmpresaId) {
            transformed.empresa_id = firstEmpresaId;
            log('info', `Usando primeira empresa como padrão para ${pgTableName}`, { empresa_id: firstEmpresaId });
          } else {
            // Se não houver empresa mapeada ainda, isso indica que empresas não foi migrada
            log('error', `Nenhuma empresa mapeada encontrada para ${pgTableName}. Empresas deve ser migrada primeiro!`);
            return null; // Será filtrado depois
          }
        }
        
        // Validar que empresa_id é UUID válido
        if (transformed.empresa_id && !transformed.empresa_id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          log('error', `empresa_id inválido (não é UUID): ${transformed.empresa_id}`, { pgTableName });
          return null;
        }
        
        // Filtrar registros sem empresa_id obrigatório
        if (!transformed.empresa_id && pgTableName !== 'empresas') {
          return null; // Será filtrado depois
        }

        return transformed;
      }));
      
      // Filtrar linhas inválidas
      transformedBatch = transformedBatch.filter(row => {
        // Filtrar linhas inválidas
        if (!row) return false;
        
        // Validar campos obrigatórios
        // EXCEÇÃO: estoques.id e operacoes_estoque.id são BIGSERIAL (não UUID), então não exigir id para eles
        const requiredFields = REQUIRED_FIELDS[pgTableName] || [];
        for (const field of requiredFields) {
          // Pular validação de id para estoques e operacoes_estoque (será gerado pelo banco como BIGSERIAL)
          if ((pgTableName === 'estoques' || pgTableName === 'operacoes_estoque') && field === 'id') {
            continue;
          }
          if (!(field in row) || row[field] === null || row[field] === undefined) {
            // Aplicar default se disponível
            if (DEFAULTS[pgTableName] && DEFAULTS[pgTableName][field] !== undefined) {
              row[field] = DEFAULTS[pgTableName][field];
            } else {
              log('warn', `Campo obrigatório ${field} ausente em ${pgTableName}`, { row });
              return false;
            }
          }
        }
        
        // Validações específicas
        // EXCEÇÃO: estoques.id e operacoes_estoque.id são BIGSERIAL (não UUID), então não validar id para eles
        if (pgTableName === 'empresas' && !row.id) return false;
        if (pgTableName !== 'empresas' && pgTableName !== 'estoques' && pgTableName !== 'operacoes_estoque' && !row.empresa_id) return false;
        if (pgTableName === 'estoques' && !row.empresa_id) return false;
        if (pgTableName === 'operacoes_estoque' && !row.empresa_id) return false;
        
        // Validar que IDs são UUIDs válidos (exceto estoques e operacoes_estoque que usam BIGSERIAL)
        if (pgTableName !== 'estoques' && pgTableName !== 'operacoes_estoque' && row.id && !row.id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          log('error', `ID inválido (não é UUID): ${row.id}`, { pgTableName });
          return false;
        }
        if (row.empresa_id && !row.empresa_id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          log('error', `empresa_id inválido (não é UUID): ${row.empresa_id}`, { pgTableName });
          return false;
        }
        
        // Validar datas
        if (row.data && !row.data.match(/^\d{4}-\d{2}-\d{2}$/)) {
          log('warn', `Data inválida: ${row.data}`, { pgTableName });
          return false;
        }
        
        // Aplicar defaults específicos
        if (pgTableName === 'estoques' && !row.tipo) {
          row.tipo = DEFAULTS.estoques?.tipo || 'SPPRO';
        }
        if (pgTableName === 'operacoes_estoque') {
          if (!row.estoque_id) return false;
          if (!row.tipo_operacao) {
            // Inferir de entradas/saidas
            const entradas = parseFloat(String(row.face_titulos || 0));
            const saidas = parseFloat(String(row.valor_compra || 0));
            row.tipo_operacao = entradas > saidas ? 'entrada' : 'saida';
          }
          // Garantir que estoque_id é BIGINT (não UUID)
          if (row.estoque_id) {
            // Converter para número explicitamente
            if (typeof row.estoque_id === 'string') {
              // Se for UUID, não pode ser usado como BIGINT
              if (row.estoque_id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
                log('error', `estoque_id é UUID mas deveria ser BIGINT: ${row.estoque_id}`, { pgTableName });
                return false;
              }
              // Tentar converter para número
              const estoqueId = parseInt(row.estoque_id, 10);
              if (!isNaN(estoqueId) && estoqueId > 0) {
                row.estoque_id = estoqueId;
              } else {
                log('error', `estoque_id inválido (não é numérico positivo): ${row.estoque_id}`, { pgTableName });
                return false;
              }
            } else if (typeof row.estoque_id === 'number') {
              // Garantir que é inteiro positivo
              if (row.estoque_id <= 0 || !Number.isInteger(row.estoque_id)) {
                log('error', `estoque_id inválido (deve ser inteiro positivo): ${row.estoque_id}`, { pgTableName });
                return false;
              }
            } else {
              log('error', `estoque_id tipo inválido: ${typeof row.estoque_id}`, { pgTableName, value: row.estoque_id });
              return false;
            }
          }
          // Se data não foi convertida, usar default ou descartar
          if (!row.data) {
            // Tentar usar data atual como fallback
            row.data = new Date().toISOString().split('T')[0];
            log('warn', `Data ausente em operacoes_estoque, usando data atual: ${row.data}`, { pgTableName });
          }
        }
        
        return true;
      });

      if (transformedBatch.length === 0) {
        log('warn', `Nenhum registro válido no lote ${batchNum}`);
        errors += batch.length;
        continue;
      }

      // VALIDAÇÃO CRÍTICA: Antes de inserir, validar que todos os _id são UUIDs válidos (exceto estoque_id e id de operacoes_estoque/estoques que são BIGSERIAL)
      const invalidIds: any[] = [];
      for (let j = 0; j < transformedBatch.length; j++) {
        const row = transformedBatch[j];
        // Validar id (exceto para estoques e operacoes_estoque que usam BIGSERIAL)
        if (pgTableName !== 'estoques' && pgTableName !== 'operacoes_estoque' && row.id && !row.id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          invalidIds.push({ index: j, field: 'id', value: row.id, row });
        }
        // Validar empresa_id (deve ser UUID)
        if (row.empresa_id && !row.empresa_id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          invalidIds.push({ index: j, field: 'empresa_id', value: row.empresa_id, row });
        }
        // Validar outras FKs que devem ser UUIDs
        if (row.cliente_id && !row.cliente_id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          invalidIds.push({ index: j, field: 'cliente_id', value: row.cliente_id, row });
        }
        if (row.fornecedor_id && !row.fornecedor_id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          invalidIds.push({ index: j, field: 'fornecedor_id', value: row.fornecedor_id, row });
        }
        if (row.banco_id && !row.banco_id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          invalidIds.push({ index: j, field: 'banco_id', value: row.banco_id, row });
        }
        if (row.grupo_contas_id && !row.grupo_contas_id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          invalidIds.push({ index: j, field: 'grupo_contas_id', value: row.grupo_contas_id, row });
        }
        // VALIDAÇÃO CRÍTICA: estoque_id deve ser BIGINT (não UUID)
        if (row.estoque_id) {
          const estoqueIdStr = String(row.estoque_id);
          // Se for UUID, é INVÁLIDO
          if (estoqueIdStr.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
            log('error', `estoque_id é UUID mas deveria ser BIGINT: ${estoqueIdStr}`, { pgTableName, rowIndex: j });
            invalidIds.push({ index: j, field: 'estoque_id', value: row.estoque_id, row, reason: 'UUID em campo BIGINT' });
          } else {
            // Tentar converter para número
            const estoqueIdNum = parseInt(estoqueIdStr, 10);
            if (isNaN(estoqueIdNum) || !Number.isInteger(estoqueIdNum) || estoqueIdNum <= 0) {
              log('error', `estoque_id inválido (não é BIGINT válido): ${estoqueIdStr}`, { pgTableName, rowIndex: j });
              invalidIds.push({ index: j, field: 'estoque_id', value: row.estoque_id, row, reason: 'Não é BIGINT válido' });
            } else {
              // Garantir que está como número
              row.estoque_id = estoqueIdNum;
            }
          }
        }
      }
      
      if (invalidIds.length > 0) {
        log('error', `Lote ${batchNum} contém ${invalidIds.length} registros com IDs inválidos`, { 
          invalidIds: invalidIds.map(iv => ({ field: iv.field, value: iv.value, reason: iv.reason || 'não é UUID' })),
          table: pgTableName
        });
        // Remover registros inválidos do lote
        const validRows = transformedBatch.filter((_, idx) => !invalidIds.some(iv => iv.index === idx));
        if (validRows.length === 0) {
          log('warn', `Todos os registros do lote ${batchNum} foram removidos por IDs inválidos`);
          errors += batch.length;
          continue;
        }
        transformedBatch = validRows;
        log('info', `Removidos ${invalidIds.length} registros inválidos do lote ${batchNum}, restam ${transformedBatch.length}`);
      }

      // Tratar duplicatas de CNPJ em empresas
      if (pgTableName === 'empresas') {
        // Verificar CNPJs duplicados antes de inserir
        // Normalizar CNPJs (sem máscara) e definir critério de desempate
        const cnpjMap = new Map<string, { row: any; originalIndex: number }>();
        const uniqueBatch: any[] = [];
        const conflicts: any[] = [];
        
        for (let i = 0; i < transformedBatch.length; i++) {
          const row = transformedBatch[i];
          if (row.cnpj) {
            const cnpjNormalized = String(row.cnpj).replace(/\D/g, '');
            // Ignorar CNPJs vazios ou inválidos (como ".")
            if (cnpjNormalized && cnpjNormalized.length > 0) {
              if (!cnpjMap.has(cnpjNormalized)) {
                cnpjMap.set(cnpjNormalized, { row, originalIndex: i });
                uniqueBatch.push(row);
              } else {
                // Conflito detectado - manter o primeiro (mais antigo por índice)
                const existing = cnpjMap.get(cnpjNormalized)!;
                conflicts.push({
                  cnpj: row.cnpj,
                  cnpjNormalized,
                  existing: { id: existing.row.id, index: existing.originalIndex },
                  new: { id: row.id, index: i }
                });
                log('warn', `CNPJ duplicado ignorado no lote ${batchNum}: ${row.cnpj}`, { 
                  existing: existing.row.id, 
                  new: row.id,
                  existingIndex: existing.originalIndex,
                  newIndex: i
                });
              }
            } else {
              // CNPJ vazio ou inválido, adicionar mesmo assim (será tratado depois)
              log('warn', `CNPJ inválido ou vazio: ${row.cnpj}, adicionando mesmo assim`, { id: row.id });
              uniqueBatch.push(row);
            }
          } else {
            // Sem CNPJ, adicionar mesmo assim
            uniqueBatch.push(row);
          }
        }
        
        if (conflicts.length > 0) {
          // Carregar conflitos existentes e adicionar novos
          const conflictsFile = path.join(MAPPING_DIR, 'empresas_conflicts.json');
          let allConflicts: any[] = [];
          if (fs.existsSync(conflictsFile)) {
            try {
              allConflicts = JSON.parse(fs.readFileSync(conflictsFile, 'utf-8'));
            } catch (e) {
              // Ignorar erro ao carregar
            }
          }
          allConflicts.push(...conflicts);
          fs.writeFileSync(conflictsFile, JSON.stringify(allConflicts, null, 2));
          log('info', `Salvos ${conflicts.length} conflitos de CNPJ no lote ${batchNum} em ${conflictsFile} (total: ${allConflicts.length})`);
        }
        
        if (uniqueBatch.length < transformedBatch.length) {
          log('info', `Removidos ${transformedBatch.length - uniqueBatch.length} registros duplicados por CNPJ no lote ${batchNum}`);
          transformedBatch = uniqueBatch;
        }
        
        // Verificar se já existe empresa com mesmo CNPJ no banco antes de inserir
        // Tratar CNPJs vazios/inválidos separadamente
        const cnpjsToCheck: string[] = [];
        const cnpjsVazios: any[] = [];
        
        for (const row of transformedBatch) {
          if (row.cnpj) {
            const cnpjNorm = String(row.cnpj).replace(/\D/g, '');
            if (cnpjNorm && cnpjNorm.length > 0) {
              cnpjsToCheck.push(cnpjNorm);
            } else {
              // CNPJ vazio ou inválido
              cnpjsVazios.push(row);
            }
          } else {
            // Sem CNPJ
            cnpjsVazios.push(row);
          }
        }
        
        // Verificar CNPJs válidos
        if (cnpjsToCheck.length > 0) {
          const { data: existing, error: checkError } = await supabase
            .from(pgTableName)
            .select('cnpj')
            .in('cnpj', cnpjsToCheck);
          
          if (!checkError && existing && existing.length > 0) {
            const existingCnpjs = new Set(existing.map((e: any) => String(e.cnpj).replace(/\D/g, '')));
            const filteredBatch = transformedBatch.filter(row => {
              if (!row.cnpj) return true; // Sem CNPJ, tentar inserir
              const cnpjNorm = String(row.cnpj).replace(/\D/g, '');
              if (!cnpjNorm || cnpjNorm.length === 0) return true; // CNPJ inválido, tentar inserir
              if (existingCnpjs.has(cnpjNorm)) {
                log('warn', `Empresa com CNPJ ${row.cnpj} já existe no banco, pulando`, { cnpj: row.cnpj, id: row.id });
                return false;
              }
              return true;
            });
            
            if (filteredBatch.length === 0) {
              log('warn', `Todos os registros do lote ${batchNum} já existem no banco`);
              errors += batch.length;
              continue;
            }
            
            if (filteredBatch.length < transformedBatch.length) {
              log('info', `Removidos ${transformedBatch.length - filteredBatch.length} registros que já existem no banco do lote ${batchNum}`);
            }
            transformedBatch = filteredBatch;
          }
        }
        
        // Verificar CNPJs vazios/inválidos (pode haver apenas um no banco)
        if (cnpjsVazios.length > 0) {
          // Verificar se já existe empresa com CNPJ vazio/null ou "."
          // Buscar todas as empresas e verificar manualmente
          const { data: allEmpresas, error: checkErrorVazios } = await supabase
            .from(pgTableName)
            .select('id, cnpj');
          
          if (!checkErrorVazios && allEmpresas) {
            // Verificar se há empresa com CNPJ vazio/null ou "."
            const hasEmptyCnpj = allEmpresas.some((e: any) => {
              const cnpj = String(e.cnpj || '');
              const cnpjNorm = cnpj.replace(/\D/g, '');
              return !cnpj || cnpj === '.' || cnpj === '' || !cnpjNorm || cnpjNorm.length === 0;
            });
            
            if (hasEmptyCnpj) {
              // Já existe empresa com CNPJ vazio, remover todas do lote
              log('warn', `Já existe empresa com CNPJ vazio no banco, removendo ${cnpjsVazios.length} registros do lote ${batchNum}`);
              const beforeFilter = transformedBatch.length;
              transformedBatch = transformedBatch.filter(row => {
                // Verificar se CNPJ é vazio/inválido (null, undefined, "", ".")
                if (!row.cnpj || row.cnpj === '.' || row.cnpj === '') {
                  return false; // Remover
                }
                const cnpjNorm = String(row.cnpj).replace(/\D/g, '');
                // Se CNPJ normalizado é vazio, remover
                if (!cnpjNorm || cnpjNorm.length === 0) {
                  return false; // Remover
                }
                return true; // Manter
              });
              
              log('info', `Removidos ${beforeFilter - transformedBatch.length} registros com CNPJ vazio do lote ${batchNum}, restam ${transformedBatch.length}`);
              
              if (transformedBatch.length === 0) {
                log('warn', `Todos os registros do lote ${batchNum} já existem no banco (CNPJ vazio), pulando inserção`);
                errors += batch.length;
                continue; // Pular inserção deste lote
              }
            } else if (cnpjsVazios.length > 1) {
              // Não existe empresa com CNPJ vazio, mas há múltiplas no lote
              // Manter apenas a primeira
              log('warn', `Múltiplas empresas com CNPJ vazio no lote ${batchNum}, mantendo apenas a primeira`);
              let firstEmptyFound = false;
              transformedBatch = transformedBatch.filter(row => {
                if (!row.cnpj) {
                  const cnpjNorm = String(row.cnpj || '').replace(/\D/g, '');
                  if (!cnpjNorm || cnpjNorm.length === 0) {
                    if (!firstEmptyFound) {
                      firstEmptyFound = true;
                      return true; // Manter a primeira
                    }
                    return false; // Remover as demais
                  }
                }
                return true;
              });
            }
          }
        }
      }
      
      // Verificar se transformedBatch está vazio antes de inserir
      if (transformedBatch.length === 0) {
        log('warn', `Lote ${batchNum} está vazio após filtros, pulando inserção`);
        errors += batch.length;
        continue;
      }
      
      // DEBUG: Log pré-validação para inspecionar o estado do lote
      if (pgTableName === 'operacoes_estoque') {
        log('debug', `Pré-validação: Lote ${batchNum} tem ${transformedBatch.length} registros`, {
          batchNum,
          table: pgTableName,
          batchSize: transformedBatch.length,
          sample: transformedBatch.slice(0, 3).map((row, idx) => ({
            index: idx,
            id: row.id,
            estoque_id: row.estoque_id,
            estoque_id_type: typeof row.estoque_id,
            estoque_id_isUUID: row.estoque_id && String(row.estoque_id).match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) ? true : false,
            empresa_id: row.empresa_id,
            fornecedor_id: row.fornecedor_id,
            fornecedor_id_type: typeof row.fornecedor_id,
            fornecedor_id_isUUID: row.fornecedor_id && String(row.fornecedor_id).match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) ? true : false,
            data: row.data
          }))
        });
      }
      
      // VALIDAÇÃO FINAL: Garantir que nenhum UUID passe em estoque_id (especialmente para operacoes_estoque)
      if (pgTableName === 'operacoes_estoque') {
        const invalidEstoqueIds: any[] = [];
        for (let j = 0; j < transformedBatch.length; j++) {
          const row = transformedBatch[j];
          if (row.estoque_id) {
            const estoqueIdStr = String(row.estoque_id);
            // Se for UUID, é INVÁLIDO e deve ser removido
            if (estoqueIdStr.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
              invalidEstoqueIds.push({ index: j, value: row.estoque_id });
              log('error', `VALIDAÇÃO FINAL: estoque_id é UUID inválido (deveria ser BIGINT): ${estoqueIdStr}`, { pgTableName, rowIndex: j, lot: batchNum });
            } else if (typeof row.estoque_id !== 'number') {
              // Tentar converter para número
              const estoqueIdNum = parseInt(estoqueIdStr, 10);
              if (!isNaN(estoqueIdNum) && estoqueIdNum > 0 && Number.isInteger(estoqueIdNum)) {
                row.estoque_id = estoqueIdNum;
              } else {
                invalidEstoqueIds.push({ index: j, value: row.estoque_id });
                log('error', `VALIDAÇÃO FINAL: estoque_id não é BIGINT válido: ${estoqueIdStr}`, { pgTableName, rowIndex: j, lot: batchNum });
              }
            }
          }
        }
        
        if (invalidEstoqueIds.length > 0) {
          log('error', `VALIDAÇÃO FINAL: Lote ${batchNum} contém ${invalidEstoqueIds.length} registros com estoque_id inválido`, { 
            invalidEstoqueIds: invalidEstoqueIds.map(iv => ({ value: iv.value })),
            table: pgTableName
          });
          // Remover registros inválidos do lote
          const validRows = transformedBatch.filter((_, idx) => !invalidEstoqueIds.some(iv => iv.index === idx));
          if (validRows.length === 0) {
            log('warn', `VALIDAÇÃO FINAL: Todos os registros do lote ${batchNum} foram removidos por estoque_id inválido`);
            errors += batch.length;
            continue;
          }
          transformedBatch = validRows;
          log('info', `VALIDAÇÃO FINAL: Removidos ${invalidEstoqueIds.length} registros inválidos do lote ${batchNum}, restam ${transformedBatch.length}`);
        }
      }
      
      // Inserir lote
      const { data: inserted, error } = await supabase
        .from(pgTableName)
        .insert(transformedBatch)
        .select();

      if (error) {
        log('error', `Erro ao inserir lote ${batchNum}`, { error: error.message, table: pgTableName });
        errors += batch.length;
      } else {
        success += inserted?.length || 0;
        log('success', `Lote ${batchNum} inserido com sucesso`, {
          inserted: inserted?.length || 0,
        });
        
        // CORREÇÃO CRÍTICA: Para estoques, criar mapeamento legacy_id -> BIGINT (não UUID)
        // Após inserir, buscar os IDs BIGINT reais do banco e criar mapeamento
        if (pgTableName === 'estoques' && inserted && inserted.length > 0) {
          // Buscar campo Access que mapeia para "id" para criar mapeamento
          const fieldMapping = FIELD_MAPPINGS[pgTableName] || {};
          let legacyIdField: string | null = null;
          for (const [accessField, pgField] of Object.entries(fieldMapping)) {
            if (pgField === 'id') {
              legacyIdField = accessField;
              break;
            }
          }
          
          if (legacyIdField) {
            // Criar mapeamento legacy_id -> BIGINT
            const estoquesBigintMapping: Record<string, number> = {};
            const mappingFile = path.join(MAPPING_DIR, 'estoques_bigint_mapping.json');
            
            // Carregar mapeamento existente se houver
            if (fs.existsSync(mappingFile)) {
              try {
                const existing = JSON.parse(fs.readFileSync(mappingFile, 'utf-8'));
                Object.assign(estoquesBigintMapping, existing);
              } catch (e) {
                // Ignorar erro ao carregar
              }
            }
            
            // Criar mapeamento para cada registro inserido
            // IMPORTANTE: inserted e transformedBatch têm a mesma ordem, mas podem ter menos registros (após filtros)
            // Precisamos mapear inserted[i] para o registro original correspondente em batch
            for (let i = 0; i < inserted.length && i < transformedBatch.length; i++) {
              const insertedRow = inserted[i];
              const transformedRow = transformedBatch[i];
              
              // Buscar o registro original correspondente no batch
              // Usar o índice do transformedBatch para encontrar no batch original
              const batchIndex = i;
              const originalRow = batch[batchIndex];
              
              if (originalRow && originalRow[legacyIdField] && insertedRow && insertedRow.id) {
                const legacyId = String(originalRow[legacyIdField]);
                const bigintId = typeof insertedRow.id === 'number' ? insertedRow.id : parseInt(String(insertedRow.id), 10);
                
                if (!isNaN(bigintId) && bigintId > 0) {
                  estoquesBigintMapping[legacyId] = bigintId;
                  log('info', `Mapeamento BIGINT criado: ${legacyId} -> ${bigintId} para estoques`, { legacyId, bigintId });
                }
              }
            }
            
            // Salvar mapeamento
            fs.writeFileSync(mappingFile, JSON.stringify(estoquesBigintMapping, null, 2));
            log('info', `Mapeamento BIGINT de estoques salvo: ${Object.keys(estoquesBigintMapping).length} registros`, { mappingFile });
          }
        }
        
        // CORREÇÃO CRÍTICA: Para operacoes_estoque, criar mapeamento legacy_id -> BIGINT (não UUID)
        // Após inserir, buscar os IDs BIGINT reais do banco e criar mapeamento
        if (pgTableName === 'operacoes_estoque' && inserted && inserted.length > 0) {
          // Buscar campo Access que mapeia para "id" para criar mapeamento
          const fieldMapping = FIELD_MAPPINGS[pgTableName] || {};
          let legacyIdField: string | null = null;
          for (const [accessField, pgField] of Object.entries(fieldMapping)) {
            if (pgField === 'id') {
              legacyIdField = accessField;
              break;
            }
          }
          
          if (legacyIdField) {
            // Criar mapeamento legacy_id -> BIGINT
            const operacoesEstoqueBigintMapping: Record<string, number> = {};
            const mappingFile = path.join(MAPPING_DIR, 'operacoes_estoque_bigint_mapping.json');
            
            // Carregar mapeamento existente se houver
            if (fs.existsSync(mappingFile)) {
              try {
                const existing = JSON.parse(fs.readFileSync(mappingFile, 'utf-8'));
                Object.assign(operacoesEstoqueBigintMapping, existing);
              } catch (e) {
                // Ignorar erro ao carregar
              }
            }
            
            // Criar mapeamento para cada registro inserido
            // IMPORTANTE: inserted e transformedBatch têm a mesma ordem, mas podem ter menos registros (após filtros)
            // Precisamos mapear inserted[i] para o registro original correspondente em batch
            for (let i = 0; i < inserted.length && i < transformedBatch.length; i++) {
              const insertedRow = inserted[i];
              const transformedRow = transformedBatch[i];
              
              // Buscar o registro original correspondente no batch
              // Usar o índice do transformedBatch para encontrar no batch original
              const batchIndex = i;
              const originalRow = batch[batchIndex];
              
              if (originalRow && originalRow[legacyIdField] && insertedRow && insertedRow.id) {
                const legacyId = String(originalRow[legacyIdField]);
                const bigintId = typeof insertedRow.id === 'number' ? insertedRow.id : parseInt(String(insertedRow.id), 10);
                
                if (!isNaN(bigintId) && bigintId > 0) {
                  operacoesEstoqueBigintMapping[legacyId] = bigintId;
                  log('info', `Mapeamento BIGINT criado: ${legacyId} -> ${bigintId} para operacoes_estoque`, { legacyId, bigintId });
                }
              }
            }
            
            // Salvar mapeamento
            fs.writeFileSync(mappingFile, JSON.stringify(operacoesEstoqueBigintMapping, null, 2));
            log('info', `Mapeamento BIGINT de operacoes_estoque salvo: ${Object.keys(operacoesEstoqueBigintMapping).length} registros`, { mappingFile });
          }
        }
      }
    } catch (error: any) {
      log('error', `Erro ao processar lote ${batchNum}`, { error: error.message });
      errors += batch.length;
    }
  }

  log('info', `Migração concluída: ${accessTableName} -> ${pgTableName}`, { success, errors });

  return { success, errors };
}

// Função principal
async function main() {
  log('info', '='.repeat(60));
  log('info', 'Migração de Dados - Access para Supabase');
  log('info', '='.repeat(60));
  
  // Verificar argumentos de linha de comando
  const args = process.argv.slice(2);
  const onlyTableArg = args.find(arg => arg.startsWith('--only='));
  const onlyTable = onlyTableArg ? onlyTableArg.split('=')[1] : null;
  
  if (onlyTable) {
    log('info', `Modo restrito: migrando apenas tabela ${onlyTable}`);
  }

  // Verificar se diretório de dados existe
  if (!fs.existsSync(DATA_DIR)) {
    log('error', `Diretório de dados não encontrado: ${DATA_DIR}`);
    log('error', 'Execute primeiro: python scripts/migracao/transform_data.py');
    process.exit(1);
  }

  // Encontrar todos os diretórios de dados transformados
  const dataDirs = fs.readdirSync(DATA_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  if (dataDirs.length === 0) {
    log('error', 'Nenhum diretório de dados transformados encontrado');
    process.exit(1);
  }

  log('info', `Encontrados ${dataDirs.length} diretórios de dados`);

  // Processar cada diretório
  for (const dataDir of dataDirs) {
    log('info', `\nProcessando diretório: ${dataDir}`);

    const dataPath = path.join(DATA_DIR, dataDir);

    // Encontrar todos os arquivos JSON
    const jsonFiles = fs.readdirSync(dataPath)
      .filter(file => file.endsWith('.json'))
      .map(file => path.join(dataPath, file));

    // Ordenar arquivos pela ordem de migração
    // IMPORTANTE: empresas DEVE ser migrada primeiro para popular mapeamentos
    const sortedFiles = jsonFiles.sort((a, b) => {
      const aName = path.basename(a, '.json');
      const bName = path.basename(b, '.json');
      
      // Mapear nome Access para PostgreSQL
      const aPgName = mapTableName(aName);
      const bPgName = mapTableName(bName);
      
      // Priorizar empresas
      if (aPgName === 'empresas') return -1;
      if (bPgName === 'empresas') return 1;
      
      const aIndex = MIGRATION_ORDER.indexOf(aPgName || '');
      const bIndex = MIGRATION_ORDER.indexOf(bPgName || '');
      
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });

    // Migrar cada tabela na ordem correta
    for (const jsonFile of sortedFiles) {
      const accessTableName = path.basename(jsonFile, '.json');
      
      // Mapear nome da tabela Access para PostgreSQL
      const pgTableName = mapTableName(accessTableName);
      
      if (!pgTableName) {
        log('warn', `Tabela ${accessTableName} não tem mapeamento, pulando`);
        continue;
      }

      // Verificar se tabela está na ordem de migração
      if (!MIGRATION_ORDER.includes(pgTableName)) {
        log('warn', `Tabela ${pgTableName} não está na ordem de migração, pulando por enquanto`);
        continue;
      }
      
      // Se --only foi especificado, pular outras tabelas
      if (onlyTable && pgTableName !== onlyTable) {
        log('info', `Pulando tabela ${pgTableName} (modo --only=${onlyTable})`);
        continue;
      }

      try {
        log('info', `\nCarregando dados de: ${accessTableName} -> ${pgTableName}`);
        const data = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));

        if (!Array.isArray(data) || data.length === 0) {
          log('warn', `Tabela ${accessTableName} está vazia ou inválida, pulando`);
          continue;
        }

        const result = await migrateTable(pgTableName, accessTableName, data);
        log('success', `Tabela ${accessTableName} -> ${pgTableName} migrada`, result);
        
        // Se empresas falhou, verificar se há mapeamento existente
        if (pgTableName === 'empresas' && result.success === 0 && result.errors > 0) {
          // Verificar se há mapeamento de empresas (pode ter sido criado manualmente)
          const empresaMapping = loadIdMapping('empresas');
          if (Object.keys(empresaMapping).length > 0) {
            log('warn', `Migração de empresas falhou, mas mapeamento existente encontrado (${Object.keys(empresaMapping).length} empresas). Continuando migração de tabelas dependentes.`);
          } else {
            log('error', `Migração de empresas falhou e nenhum mapeamento encontrado! Abortando migração de tabelas dependentes.`);
            log('error', `Corrija os problemas em empresas ou crie mapeamento manual antes de continuar.`);
            break; // Parar de processar outras tabelas
          }
        }

      } catch (error: any) {
        log('error', `Erro ao migrar tabela ${accessTableName}`, error);
      }
    }
  }

  // Resumo final
  log('info', '\n' + '='.repeat(60));
  log('info', 'Migração concluída!');
  log('info', '='.repeat(60));

  // Salvar logs
  saveLogs();
}

// Executar
main().catch((error) => {
  log('error', 'Erro fatal na migração', error);
  saveLogs();
  process.exit(1);
});
