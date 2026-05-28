#!/usr/bin/env node
/**
 * Gera um índice de schema (tabelas/colunas/descrições) a partir das migrations SQL do Supabase.
 *
 * Objetivo: alimentar o workflow do n8n (Query Planner / Validator) com um “schema-aware allowlist”,
 * evitando planos inválidos (ex: coluna inexistente) e reduzindo riscos de segurança.
 *
 * Saída: workflows/ai-schema-index.json
 *
 * Observação:
 * - Este parser é intencionalmente simples e cobre os padrões usados nas migrations deste repo.
 * - Não é um parser SQL completo.
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const migrationsDir = path.join(projectRoot, 'supabase', 'migrations');
const outPath = path.join(projectRoot, 'workflows', 'ai-schema-index.json');

// Tabelas globais (não são multi-tenant, não devem receber filtro empresa_id)
const GLOBAL_TABLES = new Set(['bancos', 'ufs']);

/**
 * Tabelas SEM empresa_id mas que são seguras por RLS via relacionamento.
 *
 * Importante: essas tabelas NÃO devem receber injeção de filtro empresa_id no PostgREST,
 * caso contrário ocorre erro de coluna inexistente.
 */
const SAFE_RLS_TABLES_WITHOUT_EMPRESA_ID = new Set([
  'movimentacoes_estoque', // RLS via operacoes_estoque
  'cheques', // RLS via contas_bancarias
  'despesas_operacao', // RLS via operacoes
]);

// Aliases comuns de colunas (aplicados na validação do plano)
const COLUMN_ALIASES = {
  // muitos modelos usam status=true; estoque usa ativo=true
  estoques: { status: 'ativo' },
  // clientes usa status=true; muitas perguntas usam “ativo”
  clientes: { ativo: 'status' },
  // contas_bancarias usa status=true; muitas perguntas usam “ativo”
  contas_bancarias: { ativo: 'status' },
};

const TYPE_STOP_WORDS = new Set([
  'NOT',
  'NULL',
  'DEFAULT',
  'CONSTRAINT',
  'PRIMARY',
  'REFERENCES',
  'UNIQUE',
  'CHECK',
  'COLLATE',
  'GENERATED',
  'AS',
  'IDENTITY',
]);

// Descrições curtas (para ajudar o planner/formatter)
const TABLE_DESCRIPTIONS = {
  contas_bancarias: 'Contas bancárias da empresa, com saldos e status.',
  lancamentos_caixa: 'Lançamentos de caixa (entradas/saídas) vinculados a contas/grupos.',
  grupos_contas: 'Plano de contas (grupos) para classificação de lançamentos.',
  estoques: 'Estoques financeiros (SPPRO/SOI/DEVOLUCOES) com saldo_atual e ativo.',
  operacoes_estoque: 'Operações de estoque (entrada/saída) com face_titulos/valores.',
  movimentacoes_estoque: 'Movimentações relacionadas às operações e transferências de estoque.',
  devolucoes_estoque: 'Devoluções de estoque para conta bancária (SBOI2-FORNEC).',
  recompras_estoque: 'Recompras de operações de estoque (pendente/paga).',
  recebiveis_operacoes_estoque: 'Recebíveis gerados a partir de operações de estoque.',
  clientes: 'Cadastro de clientes da empresa (status boolean como ativo/inativo).',
  fornecedores: 'Cadastro de fornecedores da empresa (status boolean + indicadores).',
  empresas: 'Cadastro de empresas (tenants).',
  profiles: 'Perfis de usuários (empresa_id, perfil, etc).',
  invites: 'Convites para novos usuários (por empresa).',
  ai_copilot_cache: 'Cache persistente do IA Copilot.',
  ai_copilot_conversations: 'Histórico de conversas do IA Copilot por usuário/empresa.',
};

function getSupabaseConfig() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    '';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';

  return {
    url: url.replace(/\/$/, ''),
    key,
  };
}

async function fetchOpenApiSchema() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return null;

  try {
    if (typeof fetch !== 'function') {
      console.warn('⚠️ fetch não disponível no runtime; pulando OpenAPI.');
      return null;
    }
    const res = await fetch(`${url}/rest/v1/`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/openapi+json',
      },
    });
    if (!res.ok) {
      console.warn(`⚠️ OpenAPI fetch falhou: ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('⚠️ OpenAPI fetch erro:', err?.message || err);
    return null;
  }
}

function deriveOpenApiType(prop) {
  if (!prop) return '';
  if (prop.format) return String(prop.format);
  if (prop.type === 'array') {
    const item = prop.items || {};
    const inner = deriveOpenApiType(item) || 'text';
    return `array<${inner}>`;
  }
  return prop.type ? String(prop.type) : '';
}

function parseOpenApiTables(openapi) {
  const schema = new Map();
  const defs = openapi?.definitions || {};

  for (const [rawName, def] of Object.entries(defs)) {
    if (!def || def.type !== 'object' || !def.properties) continue;
    const table = normalizeTableName(rawName);
    const entry = { columns: new Map(), columnDescriptions: new Map(), description: def.description || '' };
    const required = new Set(Array.isArray(def.required) ? def.required : []);

    for (const [rawCol, prop] of Object.entries(def.properties || {})) {
      const name = normalizeColumnName(rawCol);
      const rawType = deriveOpenApiType(prop);
      const nullable = !required.has(rawCol);
      const defaultValue = Object.prototype.hasOwnProperty.call(prop, 'default') ? prop.default : null;
      const enumValues = Array.isArray(prop.enum) ? prop.enum : null;
      const description = prop.description ? String(prop.description) : null;

      entry.columns.set(name, {
        name,
        rawType,
        nullable,
        defaultValue,
        enumValues,
      });
      if (description) entry.columnDescriptions.set(name, description);
    }

    schema.set(table, entry);
  }

  return schema;
}

function parseOpenApiRpcs(openapi) {
  const functions = new Map();
  const paths = openapi?.paths || {};

  for (const [pathKey, def] of Object.entries(paths)) {
    if (!pathKey.startsWith('/rpc/')) continue;
    const name = normalizeTableName(pathKey.replace('/rpc/', ''));
    const post = def?.post || def?.get || null;
    const params = Array.isArray(post?.parameters) ? post.parameters : [];
    const bodyParam = params.find((p) => p?.in === 'body');
    const schema = bodyParam?.schema || {};
    const props = schema.properties || {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);

    const args = Object.entries(props).map(([argName, prop]) => ({
      name: normalizeColumnName(argName),
      type: deriveOpenApiType(prop),
      required: required.has(argName),
    }));

    functions.set(name, {
      name,
      args,
      returns: '',
    });
  }

  return functions;
}

function readAllMigrations() {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  return files.map((file) => ({
    file,
    sql: fs.readFileSync(path.join(migrationsDir, file), 'utf8'),
  }));
}

function stripComments(sql) {
  // remove /* ... */ (incluindo multiline)
  let out = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  // remove -- ... (até fim da linha)
  out = out.replace(/--.*$/gm, '');
  return out;
}

function normalizeTableName(name) {
  const n = name.trim();
  // remove schema prefix se houver
  const withoutSchema = n.replace(/^public\./i, '').replace(/^\"public\"\./i, '');
  return withoutSchema.replace(/\"/g, '').trim().toLowerCase();
}

function normalizeColumnName(name) {
  return name.replace(/\"/g, '').trim().toLowerCase();
}

function normalizeType(rawType) {
  const cleaned = rawType.replace(/\"/g, '').trim();
  const withoutSchema = cleaned.replace(/^public\./i, '');
  return withoutSchema;
}

function parseColumnDefinition(trimmedLine) {
  if (!trimmedLine) return null;
  const tokens = trimmedLine.split(/\s+/);
  const rawName = tokens[0];
  const name = normalizeColumnName(rawName);
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) return null;

  const typeTokens = [];
  for (const token of tokens.slice(1)) {
    const upper = token.replace(/,$/, '').toUpperCase();
    if (TYPE_STOP_WORDS.has(upper)) break;
    typeTokens.push(token.replace(/,$/, ''));
  }

  const rawType = normalizeType(typeTokens.join(' ').trim());
  const nullable = !/NOT\s+NULL/i.test(trimmedLine);
  const defaultMatch = trimmedLine.match(/\bDEFAULT\b\s+(.+)$/i);
  const defaultValue = defaultMatch ? defaultMatch[1].replace(/,$/, '').trim() : null;

  return {
    name,
    rawType,
    nullable,
    defaultValue,
  };
}

function isLikelyColumnLine(trimmedLine) {
  if (!trimmedLine) return false;
  const upper = trimmedLine.toUpperCase();
  if (upper.startsWith('CONSTRAINT ')) return false;
  if (upper.startsWith('PRIMARY KEY')) return false;
  if (upper.startsWith('FOREIGN KEY')) return false;
  if (upper.startsWith('UNIQUE ')) return false;
  if (upper.startsWith('CHECK ')) return false;
  if (upper.startsWith('EXCLUDE ')) return false;
  if (upper.startsWith(')')) return false;
  return true;
}

function parseCreateTableBlocks(sql) {
  const blocks = [];
  const re = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([^\s(]+)\s*\(/gi;
  let match;
  while ((match = re.exec(sql)) !== null) {
    const rawTable = match[1];
    const table = normalizeTableName(rawTable);
    const startIdx = match.index + match[0].length - 1; // points at '('

    // encontrar ')' correspondente (contagem simples de parênteses)
    let depth = 0;
    let endIdx = -1;
    for (let i = startIdx; i < sql.length; i++) {
      const ch = sql[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx === -1) continue;

    const body = sql.slice(startIdx + 1, endIdx);
    blocks.push({ table, body });
    re.lastIndex = endIdx; // avançar
  }
  return blocks;
}

function parseColumnsFromCreateBody(body) {
  const columns = [];
  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim().replace(/,$/, '');
    if (!isLikelyColumnLine(trimmed)) continue;
    const parsed = parseColumnDefinition(trimmed);
    if (!parsed) continue;
    columns.push(parsed);
  }
  return columns;
}

function parseAlterAddColumns(sql) {
  const adds = [];
  const tableRe = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s;]+)\s+([^;]+);/gi;
  let match;
  while ((match = tableRe.exec(sql)) !== null) {
    const table = normalizeTableName(match[1]);
    const body = match[2];
    const addRe = /ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+([^,]+)/gi;
    let addMatch;
    while ((addMatch = addRe.exec(body)) !== null) {
      const colName = normalizeColumnName(addMatch[1]);
      const rest = addMatch[2].trim();
      const parsed = parseColumnDefinition(`${colName} ${rest}`);
      if (!parsed) continue;
      adds.push({ table, column: parsed.name, rawType: parsed.rawType, nullable: parsed.nullable, defaultValue: parsed.defaultValue });
    }
  }
  return adds;
}

function parseAlterDropColumns(sql) {
  const drops = [];
  const re =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s;]+)\s+DROP\s+COLUMN(?:\s+IF\s+EXISTS)?\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  let match;
  while ((match = re.exec(sql)) !== null) {
    drops.push({ table: normalizeTableName(match[1]), column: normalizeColumnName(match[2]) });
  }
  return drops;
}

function parseAlterRenameColumns(sql) {
  const renames = [];
  const re =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s;]+)\s+RENAME\s+COLUMN\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+TO\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  let match;
  while ((match = re.exec(sql)) !== null) {
    renames.push({
      table: normalizeTableName(match[1]),
      from: normalizeColumnName(match[2]),
      to: normalizeColumnName(match[3]),
    });
  }
  return renames;
}

function parseEnumTypes(sql) {
  const enums = new Map();
  const re = /CREATE\s+TYPE\s+([^\s]+)\s+AS\s+ENUM\s*\(([\s\S]*?)\);/gi;
  let match;
  while ((match = re.exec(sql)) !== null) {
    const rawName = normalizeType(match[1]);
    const name = rawName.replace(/^public\./i, '');
    const valuesRaw = match[2] || '';
    const values = [];
    const valRe = /'([^']*)'/g;
    let valMatch;
    while ((valMatch = valRe.exec(valuesRaw)) !== null) {
      values.push(valMatch[1]);
    }
    if (values.length) enums.set(name.toLowerCase(), values);
  }
  return enums;
}

function parseFunctions(sql) {
  const functions = [];
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([^\s(]+)\s*\(([^)]*)\)\s+RETURNS\s+([^\s]+)/gi;
  let match;
  while ((match = re.exec(sql)) !== null) {
    const rawName = normalizeType(match[1]);
    const name = rawName.replace(/^public\./i, '').toLowerCase();
    const argsRaw = match[2] || '';
    const returns = match[3] || '';

    const args = [];
    const parts = argsRaw.split(',').map((p) => p.trim()).filter(Boolean);
    let index = 1;
    for (const part of parts) {
      const cleaned = part.replace(/DEFAULT\s+.+$/i, '').trim();
      const tokens = cleaned.split(/\s+/).filter(Boolean);
      if (!tokens.length) continue;
      let nameToken = tokens[0];
      let typeTokens = tokens.slice(1);
      if (['IN', 'OUT', 'INOUT', 'VARIADIC'].includes(nameToken.toUpperCase())) {
        nameToken = tokens[1] || `arg${index}`;
        typeTokens = tokens.slice(2);
      }
      const argName = normalizeColumnName(nameToken || `arg${index}`);
      const argType = normalizeType(typeTokens.join(' '));
      args.push({ name: argName, type: argType });
      index += 1;
    }

    functions.push({ name, args, returns: normalizeType(returns) });
  }
  return functions;
}

function parseForeignKeysFromCreateBody(table, body) {
  const fks = [];
  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim().replace(/,$/, '');
    if (!trimmed) continue;

    // Inline REFERENCES (coluna)
    const inlineMatch = trimmed.match(/^\"?([a-zA-Z_][a-zA-Z0-9_]*)\"?\s+.*?REFERENCES\s+([^\s(]+)\s*\(([^)]+)\)/i);
    if (inlineMatch) {
      const column = normalizeColumnName(inlineMatch[1]);
      const refTable = normalizeTableName(inlineMatch[2]);
      const refCols = inlineMatch[3].split(',').map((c) => normalizeColumnName(c));
      fks.push({ table, columns: [column], refTable, refColumns: refCols, constraint: null });
      continue;
    }

    // FOREIGN KEY (col1, col2) REFERENCES table(colA, colB)
    const fkMatch = trimmed.match(/FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([^\s(]+)\s*\(([^)]+)\)/i);
    if (fkMatch) {
      const columns = fkMatch[1].split(',').map((c) => normalizeColumnName(c));
      const refTable = normalizeTableName(fkMatch[2]);
      const refColumns = fkMatch[3].split(',').map((c) => normalizeColumnName(c));
      fks.push({ table, columns, refTable, refColumns, constraint: null });
    }
  }
  return fks;
}

function parseAlterForeignKeys(sql) {
  const fks = [];
  const re = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s;]+)\s+ADD\s+CONSTRAINT\s+([^\s]+)\s+FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([^\s(]+)\s*\(([^)]+)\)/gi;
  let match;
  while ((match = re.exec(sql)) !== null) {
    const table = normalizeTableName(match[1]);
    const constraint = match[2];
    const columns = match[3].split(',').map((c) => normalizeColumnName(c));
    const refTable = normalizeTableName(match[4]);
    const refColumns = match[5].split(',').map((c) => normalizeColumnName(c));
    fks.push({ table, columns, refTable, refColumns, constraint });
  }
  return fks;
}

function parseComments(sql) {
  const tableComments = new Map();
  const columnComments = new Map(); // key `${table}.${column}`

  const tableRe = /COMMENT\s+ON\s+TABLE\s+([^\s]+)\s+IS\s+'([^']*)'/gi;
  let match;
  while ((match = tableRe.exec(sql)) !== null) {
    const table = normalizeTableName(match[1]);
    tableComments.set(table, match[2]);
  }

  const colRe = /COMMENT\s+ON\s+COLUMN\s+([^.]+)\.([^\s]+)\s+IS\s+'([^']*)'/gi;
  while ((match = colRe.exec(sql)) !== null) {
    const table = normalizeTableName(match[1]);
    const column = normalizeColumnName(match[2]);
    columnComments.set(`${table}.${column}`, match[3]);
  }

  return { tableComments, columnComments };
}

async function buildSchemaIndex() {
  const schema = new Map(); // table -> { columns: Map, description?:string, columnDescriptions: Map }
  const tableComments = new Map();
  const columnComments = new Map();
  const enumTypes = new Map(); // enumName -> values[]
  const foreignKeys = new Map(); // table -> fk[]
  const rpcFunctions = new Map(); // name -> { name, args, returns }

  const openapi = await fetchOpenApiSchema();
  let source = 'supabase/migrations/*.sql';

  if (openapi) {
    source = 'supabase/rest/v1 (openapi) + supabase/migrations/*.sql';
    for (const [table, entry] of parseOpenApiTables(openapi).entries()) {
      schema.set(table, entry);
    }
    for (const [name, fn] of parseOpenApiRpcs(openapi).entries()) {
      rpcFunctions.set(name, fn);
    }
  }

  for (const { file, sql: raw } of readAllMigrations()) {
    const sql = stripComments(raw);

    // comments (depois do stripComments ainda sobra 'COMMENT ON', pois não são comentários SQL)
    const commentsFromRaw = parseComments(raw);
    for (const [k, v] of commentsFromRaw.tableComments.entries()) tableComments.set(k, v);
    for (const [k, v] of commentsFromRaw.columnComments.entries()) columnComments.set(k, v);

    // enums e funções
    for (const [name, values] of parseEnumTypes(raw).entries()) {
      enumTypes.set(name, values);
    }
    for (const fn of parseFunctions(raw)) {
      if (!rpcFunctions.has(fn.name)) {
        rpcFunctions.set(fn.name, fn);
      }
    }

    // CREATE TABLE + FKs
    for (const block of parseCreateTableBlocks(sql)) {
      if (!schema.has(block.table)) {
        schema.set(block.table, { columns: new Map(), columnDescriptions: new Map(), description: '' });
      }
      const entry = schema.get(block.table);
      for (const col of parseColumnsFromCreateBody(block.body)) {
        if (!entry.columns.has(col.name)) {
          entry.columns.set(col.name, col);
        }
      }

      for (const fk of parseForeignKeysFromCreateBody(block.table, block.body)) {
        const list = foreignKeys.get(block.table) || [];
        list.push(fk);
        foreignKeys.set(block.table, list);
      }
    }

    // ALTER TABLE add/drop/rename
    for (const add of parseAlterAddColumns(sql)) {
      if (!schema.has(add.table)) schema.set(add.table, { columns: new Map(), columnDescriptions: new Map(), description: '' });
      const entry = schema.get(add.table);
      if (!entry.columns.has(add.column)) {
        entry.columns.set(add.column, {
          name: add.column,
          rawType: add.rawType || '',
          nullable: add.nullable,
          defaultValue: add.defaultValue,
        });
      }
    }
    for (const drop of parseAlterDropColumns(sql)) {
      const entry = schema.get(drop.table);
      if (entry) entry.columns.delete(drop.column);
    }
    for (const ren of parseAlterRenameColumns(sql)) {
      const entry = schema.get(ren.table);
      if (!entry) continue;
      if (entry.columns.has(ren.from)) {
        const meta = entry.columns.get(ren.from);
        entry.columns.delete(ren.from);
        entry.columns.set(ren.to, { ...meta, name: ren.to });
      }
    }

    for (const fk of parseAlterForeignKeys(sql)) {
      const list = foreignKeys.get(fk.table) || [];
      list.push(fk);
      foreignKeys.set(fk.table, list);
    }

    // eslint-disable-next-line no-unused-vars
    void file;
  }

  // aplicar descrições (override > comments > vazio)
  for (const [table, entry] of schema.entries()) {
    entry.description =
      TABLE_DESCRIPTIONS[table] ||
      entry.description ||
      tableComments.get(table) ||
      '';

    // column descriptions (de comments)
    for (const col of entry.columns.keys()) {
      const desc = columnComments.get(`${table}.${col}`);
      if (desc) entry.columnDescriptions.set(col, desc);
    }
  }

  // allowlist ampla: incluir todas as tabelas do schema
  const allowedTables = {};
  for (const [table, entry] of schema.entries()) {
    const cols = Array.from(entry.columns.keys()).sort();
    const hasEmpresaId = cols.includes('empresa_id');
    const isGlobal = GLOBAL_TABLES.has(table);
    const safeWithoutEmpresaId = SAFE_RLS_TABLES_WITHOUT_EMPRESA_ID.has(table);

    const columnTypes = {};
    const columnNullable = {};
    const columnDefaults = {};
    const columnEnums = {};

    for (const [col, meta] of entry.columns.entries()) {
      columnTypes[col] = meta.rawType || '';
      columnNullable[col] = !!meta.nullable;
      if (meta.defaultValue !== null && meta.defaultValue !== undefined) {
        columnDefaults[col] = meta.defaultValue;
      }

      if (Array.isArray(meta.enumValues)) {
        columnEnums[col] = meta.enumValues;
      } else {
        const enumName = (meta.rawType || '').replace(/^public\./i, '').toLowerCase();
        if (enumTypes.has(enumName)) {
          columnEnums[col] = enumTypes.get(enumName);
        }
      }
    }

    const relations = (foreignKeys.get(table) || [])
      .filter((fk) => schema.has(fk.refTable))
      .map((fk) => ({
        targetTable: fk.refTable,
        columns: fk.columns,
        targetColumns: fk.refColumns,
        constraint: fk.constraint || null,
      }));

    allowedTables[table] = {
      description: entry.description || '',
      hasEmpresaId,
      isGlobal,
      safeWithoutEmpresaId,
      columns: cols,
      columnTypes,
      columnNullable,
      columnDefaults,
      columnEnums,
      relations,
      columnAliases: COLUMN_ALIASES[table] || {},
    };
  }

  return {
    version: '1.2',
    generatedAt: new Date().toISOString(),
    source,
    globalTables: Array.from(GLOBAL_TABLES),
    enums: Object.fromEntries(enumTypes),
    rpcFunctions: Array.from(rpcFunctions.values()),
    allowedTables,
  };
}

async function main() {
  if (!fs.existsSync(migrationsDir)) {
    console.error('❌ Diretório de migrations não encontrado:', migrationsDir);
    process.exit(1);
  }

  const index = await buildSchemaIndex();
  fs.writeFileSync(outPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
  console.log('✅ Schema index gerado em:', path.relative(projectRoot, outPath));
  console.log('   Tabelas allowlisted:', Object.keys(index.allowedTables).length);
}

main().catch((err) => {
  console.error('❌ Erro ao gerar schema index:', err?.message || err);
  process.exit(1);
});
