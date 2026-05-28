#!/usr/bin/env node
/**
 * Sincroniza o schema index gerado (workflows/ai-schema-index.json) dentro dos workflows do n8n,
 * atualizando o JS do node "Validate & Normalize Plan" e ajustando o "Build Supabase URL"
 * para não injetar empresa_id em tabelas que não possuem essa coluna.
 *
 * Arquivos afetados:
 * - workflows/assfac-ai-assistant.json
 * - workflows/assfac-ai-assistant-api.json
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const schemaIndexPath = path.join(projectRoot, 'workflows', 'ai-schema-index.json');
const workflowPaths = [
  path.join(projectRoot, 'workflows', 'assfac-ai-assistant.json'),
  path.join(projectRoot, 'workflows', 'assfac-ai-assistant-api.json'),
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function buildQueryPlannerSystemMessage(schemaIndex) {
  const allowedTables = schemaIndex?.allowedTables || {};
  const tableLines = Object.keys(allowedTables)
    .sort()
    .map((table) => {
      const meta = allowedTables[table] || {};
      const cols = Array.isArray(meta.columns) ? meta.columns.join(', ') : '';
      const desc = meta.description ? ` - ${meta.description}` : '';
      return `- ${table}${desc}${cols ? ` | colunas: ${cols}` : ''}`;
    });

  const rpcLines = Array.isArray(schemaIndex?.rpcFunctions)
    ? schemaIndex.rpcFunctions
        .map((fn) => {
          const args = Array.isArray(fn.args)
            ? fn.args.map((a) => `${a.name}: ${a.type}`).join(', ')
            : '';
          return `- ${fn.name}(${args})`;
        })
    : [];

  return [
    'Você é o PLANNER de consultas para o Supabase (PostgREST) do sistema ASSFAC.',
    '',
    'Responda APENAS JSON válido (sem markdown, sem texto extra).',
    '',
    '## Formato obrigatório (JSON)',
    '{',
    '  "needsQuery": boolean,',
    '  "intent": "info"|"comparison"|"trend"|"analysis"|"clarify",',
    '  "clarifyQuestion": string|null,',
    '  "table": string|null,',
    '  "select": string,',
    '  "limit": number,',
    '  "offset": number,',
    '  "order": string,',
    '  "filters": [{ "field": string, "op": string, "value": string|number|boolean }],',
    '  "postProcess": null | { "type": "sum"|"count"|"avg"|"min"|"max"|"median"|"stats"|"pct_change"|"timeseries"|"group_sum", "field": string, "dateField"?: string, "granularity"?: string, "calc"?: string, "pctChange"?: boolean, "groupBy"?: string },',
    '  "rpc": null | { "name": string, "args": object }',
    '}',
    '',
    '## Regras de clarificação (anti-loop)',
    '- Use "history" para resolver pronomes e entidades já citadas.',
    '- Se a última mensagem do assistente foi uma pergunta e o usuário respondeu "sim", "exatamente", "ok" ou "da forma que você achar melhor", considere isso como confirmação e siga com defaults.',
    '- Só use intent="clarify" se faltar informação ESSENCIAL (ex.: tabela ou métrica).',
    '- Nunca repita a mesma pergunta. Persistindo ambiguidade, assuma um default e siga.',
    '',
    '## Defaults (quando não especificado)',
    '- Conta bancária: TODAS.',
    '- Período:',
    '  - Para trend/comparison: últimos 2 meses fechados.',
    '  - Para info simples: últimos 30 dias.',
    '- Se o usuário disser "novembro-dezembro" sem ano, assuma o ano atual; se o período estiver no futuro, use o ano anterior.',
    '',
    '## Regras gerais',
    '- Datas sempre em YYYY-MM-DD (converta de dd/mm/aaaa quando necessário).',
    '- Para buscas parciais use op "ilike" e value com wildcards, ex: "%davi%".',
    '- Se a pergunta não exigir dados (ex: "Olá"), use needsQuery=false e table=null.',
    '- select pode incluir relações via nested select (ex: "contas_bancarias(bancos(nome))") se houver FK.',
    '- Para listas simples (ex.: movimentações), evite nested selects/joins; use apenas colunas diretas da tabela.',
    '- Nunca invente dados nem colunas.',
    '- Para funções RPC, preencha rpc.name e rpc.args e deixe table=null.',
    '',
    '## Mapeamentos comuns',
    '- "saldo global" / "saldo atual" → table="contas_bancarias", select="descricao,saldo_atual", filters=[{field:"status",op:"eq",value:true}], postProcess={type:"sum",field:"saldo_atual"}',
    '- "saldos dos estoques" / "saldo dos estoques" → table="estoques", select="tipo,descricao,saldo_inicial,saldo_atual", filters=[{field:"ativo",op:"eq",value:true}], order="tipo.asc,descricao.asc", postProcess={type:"sum",field:"saldo_atual"}',
    '  (IMPORTANTE: o saldo exibido do estoque é saldo_inicial + saldo_atual; o workflow soma corretamente no pós-processamento.)',
    '  (ATENÇÃO: em estoques o campo de ativo é "ativo" e NÃO "status")',
    '- "quantos clientes ativos" → table="clientes", select="id", limit=1000, filters=[{field:"status",op:"eq",value:true}], postProcess={type:"count",field:"id"}',
    '- "movimentacao"/"movimentações" → table="lancamentos_caixa", select="data,tipo,valor,historico,documento,conta_bancaria_id,grupo_contas_id", order="data.desc", limit=50',
    '- "entradas"/"saídas" em um dia → table="lancamentos_caixa", select="data,tipo,valor,historico,conta_bancaria_id", filters=[{field:"tipo",op:"eq",value:"entrada"|"saida"},{field:"data",op:"eq",value:"YYYY-MM-DD"}], order="data.desc"',
    '- "recebimento" → table="lancamentos_caixa", filters=[{field:"tipo",op:"eq",value:"entrada"}]',
    '- "pagamentos" → table="lancamentos_caixa", filters=[{field:"tipo",op:"eq",value:"saida"}]',
    '- "operações" → preferir table="operacoes_estoque" quando existir, senão "operacoes".',
    '- "quantos fornecedores" → table="fornecedores", select="id", limit=1000, postProcess={type:"count",field:"id"}',
    '',
    '## Tabelas disponíveis',
    ...tableLines,
    '',
    '## Funções RPC disponíveis',
    ...(rpcLines.length ? rpcLines : ['- (nenhuma encontrada nas migrations)']),
  ].join('\n');
}

function buildAnswerFormatterSystemMessage() {
  return [
    'Você é o IA Copilot ASSFAC. Responda em pt-BR.',
    '',
    'Você receberá um JSON contendo:',
    '- question',
    '- plan (consulta)',
    '- validationError (quando o plano foi bloqueado/normalizado)',
    '- postProcessResult (quando existir)',
    '- rowsPreview (amostra de linhas)',
    '- rowCount (quantidade total retornada)',
    '- history (quando houver contexto anterior)',
    '- supabaseError (quando houver erro)',
    '',
    'Regras:',
    '- Se plan.intent === "clarify" e plan.clarifyQuestion existir, responda APENAS com a pergunta de clarificação.',
    '- Se validationError existir, responda com a mensagem de validação e sugira como o usuário pode refinar a pergunta (ex.: citar o módulo: Estoques, Clientes, Contas, etc). Não mencione consulta nem "não encontrei registros".',
    '- Se plan.needsQuery for false (sem validationError), responda normalmente (ex: saudação/explicação) e NÃO mencione consulta nem "não encontrei registros".',
    '- A consulta JÁ FOI EXECUTADA (quando plan.needsQuery=true). Não diga que vai consultar/buscar/verificar.',
    '- Se supabaseError existir, explique que não foi possível acessar os dados e peça para o usuário tentar novamente (ou fazer login de novo).',
    '- Se postProcessResult existir, use-o como fonte principal do número final.',
    '- Se postProcessResult.type === "stats", apresente resumo (sum, avg, min, max, median) e a contagem de outliers se houver.',
    '- Se postProcessResult.type === "pct_change", apresente a variação percentual e os valores inicial/final.',
    '- Se postProcessResult.type === "timeseries", apresente a série por período (ex: mês) com valores e variação percentual quando disponível.',
    '- Se postProcessResult.type === "group_sum", apresente os grupos por categoria com valores e contagens.',
    '- Para listas grandes, não detalhe tudo no texto. Informe que a tabela abaixo contém os registros e que é possível paginar.',
    '- Se rowsPreview estiver vazio (e sem supabaseError) e plan.needsQuery=true, informe que não encontrou registros.',
    '- Se fastAnswer existir, use-o diretamente como resposta (não precisa processar com LLM).',
    '- Formate valores monetários como R$ 1.234,56.',
    '- Formate percentuais como 12,34%.',
    '- Evite loop: não faça novas perguntas se plan.intent não for "clarify".',
    '- Seja direto.',
  ].join('\n');
}

function buildRespondToWebhookBody() {
  return `={{ (() => {
  const wrap = $('Wrap Supabase Result').first().json || {};
  const plan = wrap.queryPlan || {};
  const includeRows = !!plan.needsQuery && !plan.postProcess && !wrap.supabaseError;
  const rows = includeRows ? (Array.isArray(wrap.supabaseResult) ? wrap.supabaseResult : []) : [];
  // Se fastAnswer estiver disponível, usar diretamente (bypass do LLM)
  const fastAnswer = $json.fastAnswer || null;
  const answer = fastAnswer || $json.output || "Não foi possível processar sua pergunta. Por favor, tente novamente.";
  return {
    success: true,
    answer,
    conversationId: $json.conversationId || $('Extract Context').first().json.conversationId || null,
    data: includeRows ? {
      rows,
      rowCount: wrap.rowCount || rows.length,
      page: wrap.pageInfo || null,
      queryUrl: wrap.supabaseQueryUrl || $('Build Supabase URL').first().json.supabaseQueryUrl || null,
      queryPlan: plan || null
    } : null
  };
})() }}`;
}

function buildExtractContextJsCode() {
  return `
const b = items[0].json?.body || {};
return [{
  json: {
    question: b.question ?? items[0].json?.question ?? '',
    conversationId: b.conversationId ?? b.sessionId ?? items[0].json?.conversationId ?? null,
    empresaId: b.empresaId ?? b.empresa_id ?? items[0].json?.empresaId ?? items[0].json?.empresa_id ?? null,
    userId: b.userId ?? items[0].json?.userId ?? null,
    supabaseAccessToken: b.supabaseAccessToken ?? b.supabase_access_token ?? items[0].json?.supabaseAccessToken ?? items[0].json?.supabase_access_token ?? null,
    history: b.history ?? items[0].json?.history ?? null,
    historySummary: b.historySummary ?? items[0].json?.historySummary ?? null,
    body: b
  }
}];
`.trim();
}

function buildWrapSupabaseResultJsCode() {
  return `
const base = $('Build Supabase URL').first().json;
const plan = base.queryPlan || {};
const queryStartAt = Number(base.queryStartAt || 0);

// Se não precisa consultar, ignore completamente qualquer erro do Supabase Query
if (!plan.needsQuery) {
  return [{ json: { ...base, supabaseResult: [], supabaseError: null, rowCount: 0 } }];
}

const rows = $('Supabase Query').all(0).map((i) => i.json);
const maybeError = rows?.[0]?.error ?? null;
if (maybeError) {
  const msg = typeof maybeError === 'string'
    ? maybeError
    : (maybeError?.message || JSON.stringify(maybeError));
  const queryElapsedMs = queryStartAt ? Date.now() - queryStartAt : null;
  if (queryElapsedMs !== null) {
    console.log('[AI Copilot] Supabase erro', { table: plan.table || null, ms: queryElapsedMs });
  }
  return [{ json: { ...base, supabaseResult: [], supabaseError: msg, rowCount: 0, queryElapsedMs } }];
}

let resultRows = rows;

// Auto-pagination simples para tabelas (GET)
const autoPaginate = !!plan.autoPaginate && plan.table && (base.supabaseMethod || 'GET') === 'GET';
const limit = Number.isFinite(plan.limit) ? plan.limit : 50; // Reduzido de 100 para 50 para melhor performance
const offset = Number.isFinite(plan.offset) ? plan.offset : 0;
const maxPages = Number.isFinite(plan.maxPages) ? plan.maxPages : 1;

if (autoPaginate && limit > 0 && rows.length >= limit) {
  const anonKey =
    base.supabaseAnonKey ||
    base.supabase_anon_key ||
    base.body?.supabaseAnonKey ||
    base.body?.supabase_anon_key ||
    '';
  const token = base.supabaseAccessToken || base.supabase_access_token || base.body?.supabaseAccessToken || '';
  if (!anonKey || !token) {
    return [{ json: { ...base, supabaseResult: resultRows, supabaseError: null, rowCount: resultRows.length } }];
  }
  const headers = {
    apikey: anonKey,
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  const makeUrl = (offset) => {
    try {
      const u = new URL(base.supabaseQueryUrl);
      u.searchParams.set('offset', String(offset));
      return u.toString();
    } catch {
      return base.supabaseQueryUrl;
    }
  };

  let page = 1;
  let pageOffset = offset;
  while (page < maxPages) {
    pageOffset += limit;
    const url = makeUrl(pageOffset);
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) break;
    const pageRows = await res.json();
    if (!Array.isArray(pageRows) || pageRows.length === 0) break;
    resultRows = resultRows.concat(pageRows);
    if (pageRows.length < limit) break;
    page += 1;
  }
}

const hasMore = !autoPaginate && limit > 0 && resultRows.length >= limit;
const pageInfo = {
  limit,
  offset,
  hasMore,
  nextOffset: hasMore ? offset + limit : null,
  prevOffset: offset > 0 ? Math.max(0, offset - limit) : null,
};

const queryElapsedMs = queryStartAt ? Date.now() - queryStartAt : null;
if (queryElapsedMs !== null) {
  console.log('[AI Copilot] Supabase OK', {
    table: plan.table || null,
    ms: queryElapsedMs,
    rowCount: resultRows.length,
    limit,
    offset,
    autoPaginate,
  });
}

return [{ json: { ...base, supabaseResult: resultRows, supabaseError: null, rowCount: resultRows.length, pageInfo, queryElapsedMs } }];
`.trim();
}

function buildValidateNormalizeJsCode(schemaIndex) {
  return `
const input = items[0].json;
const plan = input.queryPlan || {};

let validationError = null;

// Schema index gerado a partir das migrations (workflows/ai-schema-index.json)
const schemaIndex = ${JSON.stringify(schemaIndex)};
const allowedTables = schemaIndex.allowedTables || {};
const rpcFunctions = Array.isArray(schemaIndex.rpcFunctions) ? schemaIndex.rpcFunctions : [];

function norm(v) {
  return String(v ?? '').trim();
}

function normKey(v) {
  return norm(v).toLowerCase();
}

function getTableMeta(table) {
  return allowedTables?.[table] || null;
}

function getRpcMeta(name) {
  const key = normKey(name);
  return rpcFunctions.find((fn) => normKey(fn?.name) === key) || null;
}

function normalizeDateString(value) {
  if (typeof value !== 'string') return value;
  const m = value.match(/^(\\d{2})\\/(\\d{2})\\/(\\d{4})$/);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  return value;
}

function extractDates(text) {
  if (typeof text !== 'string') return [];
  const matches = text.match(/(\\d{2}\\/\\d{2}\\/\\d{4}|\\d{4}-\\d{2}-\\d{2})/g);
  if (!matches) return [];
  return matches.map((m) => normalizeDateString(m));
}

function typeCategory(rawType) {
  const t = normKey(rawType);
  if (!t) return 'unknown';
  if (t.includes('bool')) return 'boolean';
  if (t.includes('int') || t.includes('numeric') || t.includes('decimal') || t.includes('real') || t.includes('double')) return 'number';
  if (t.includes('uuid')) return 'uuid';
  if (t.includes('date') || t.includes('time')) return 'date';
  if (t.includes('json')) return 'json';
  return 'text';
}

function coerceValue(rawType, value, enumValues) {
  if (value === null || value === undefined) return value;
  const type = typeCategory(rawType);

  if (enumValues && Array.isArray(enumValues)) {
    if (Array.isArray(value)) {
      return value.map((v) => coerceValue(rawType, v, enumValues));
    }
    if (typeof value === 'string') {
      const found = enumValues.find((ev) => normKey(ev) === normKey(value));
      if (found) return found;
    }
  }

  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
    return value;
  }

  if (type === 'number') {
    if (typeof value === 'number') return value;
    const n = parseFloat(String(value));
    return Number.isFinite(n) ? n : value;
  }

  if (type === 'date') {
    return normalizeDateString(value);
  }

  return value;
}

function applyAlias(table, field) {
  const f = normKey(field);
  if (!f) return f;

  const meta = getTableMeta(table);
  const aliases = meta?.columnAliases || {};
  if (aliases[f]) return String(aliases[f]);

  // Heurística segura para o par comum status<->ativo
  const cols = new Set(meta?.columns || []);
  if (f === 'status' && cols.has('ativo')) return 'ativo';
  if (f === 'ativo' && cols.has('status')) return 'status';

  return f;
}

function splitSelect(raw) {
  const tokens = [];
  let current = '';
  let depth = 0;
  for (const ch of raw) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (current.trim()) tokens.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

function resolveRelation(meta, name) {
  const rels = Array.isArray(meta?.relations) ? meta.relations : [];
  const key = normKey(name);
  for (const rel of rels) {
    const base = normKey(rel?.targetTable);
    const constraint = rel?.constraint ? normKey(rel.constraint) : '';
    if (key === base) return rel;
    if (constraint && key === base + '!' + constraint) return rel;
  }
  return null;
}

function normalizeSelect(table, selectStr, depth = 0) {
  const meta = getTableMeta(table);
  const cols = new Set(meta?.columns || []);

  const raw = norm(selectStr);
  if (!raw || raw === '*') return '*';

  const parts = splitSelect(raw);
  const out = [];

  for (const token of parts) {
    const openIdx = token.indexOf('(');
    const closeIdx = token.lastIndexOf(')');
    if (openIdx > 0 && closeIdx > openIdx) {
      const relName = normKey(token.slice(0, openIdx));
      const rel = resolveRelation(meta, relName);
      if (!rel) continue;
      const relTable = rel.targetTable;
      const relMeta = getTableMeta(relTable);
      if (!relMeta) continue;
      const innerRaw = token.slice(openIdx + 1, closeIdx).trim();
      const inner = depth < 2 ? normalizeSelect(relTable, innerRaw, depth + 1) : '*';
      if (!inner) continue;
      const relToken = rel.constraint ? rel.targetTable + '!' + rel.constraint : rel.targetTable;
      out.push(relToken + '(' + inner + ')');
      continue;
    }

    const field = applyAlias(table, token);
    if (!cols.has(field)) continue;
    out.push(field);
  }

  return out.length ? out.join(',') : (cols.has('id') ? 'id' : (Array.from(cols)[0] || '*'));
}

function normalizeOrder(table, orderStr) {
  const meta = getTableMeta(table);
  const cols = new Set(meta?.columns || []);

  const raw = norm(orderStr);
  if (!raw) {
    if (table === 'lancamentos_caixa' && cols.has('data')) return 'data.desc';
    const firstCol = Array.from(cols)[0] || 'id';
    return cols.has('id') ? 'id.desc' : firstCol + '.asc';
  }

  const parts = raw.split(',').map((s) => norm(s)).filter(Boolean);
  const out = [];

  for (const token of parts) {
    const segs = token.split('.').map((s) => normKey(s)).filter(Boolean);
    if (segs.length === 0) continue;

    const dir = segs.length >= 2 ? segs[segs.length - 1] : 'asc';
    const fieldRaw = segs.length >= 2 ? segs.slice(0, -1).join('_') : segs[0];
    const field = applyAlias(table, fieldRaw);

    if (!cols.has(field)) continue;
    const direction = dir === 'desc' ? 'desc' : 'asc';
    out.push(field + '.' + direction);
  }

  if (out.length) return out.join(',');
  if (table === 'lancamentos_caixa' && cols.has('data')) return 'data.desc';
  const firstCol = Array.from(cols)[0] || 'id';
  return cols.has('id') ? 'id.desc' : firstCol + '.asc';
}

function normalizeFilters(table, filters) {
  const meta = getTableMeta(table);
  const cols = new Set(meta?.columns || []);
  const columnTypes = meta?.columnTypes || {};
  const columnEnums = meta?.columnEnums || {};

  const arr = Array.isArray(filters) ? filters : [];
  const out = [];

  for (const f of arr) {
    if (!f || !f.field || !f.op) continue;

    const field = applyAlias(table, f.field);
    if (!cols.has(field)) continue;

    const op = normKey(f.op);
    if (!op) continue;

    const coerced = coerceValue(columnTypes[field], f.value, columnEnums[field]);
    out.push({ field, op, value: coerced });
  }

  return out;
}

function normalizePostProcess(table, postProcess) {
  if (!postProcess || typeof postProcess !== 'object') return null;

  const meta = getTableMeta(table);
  const cols = new Set(meta?.columns || []);
  const columnTypes = meta?.columnTypes || {};

  const type = normKey(postProcess.type);
  const fieldRaw = postProcess.field ? normKey(postProcess.field) : null;
  const field = fieldRaw ? applyAlias(table, fieldRaw) : null;

  if (['sum', 'avg', 'min', 'max', 'median'].includes(type)) {
    if (!field || !cols.has(field)) return null;
    if (typeCategory(columnTypes[field]) !== 'number') return null;
    return { type, field };
  }

  if (type === 'stats') {
    if (!field || !cols.has(field)) return null;
    if (typeCategory(columnTypes[field]) !== 'number') return null;
    return { type: 'stats', field };
  }

  if (type === 'pct_change') {
    if (!field || !cols.has(field)) return null;
    if (typeCategory(columnTypes[field]) !== 'number') return null;
    const dateFieldRaw = postProcess.dateField ? normKey(postProcess.dateField) : null;
    const dateField = dateFieldRaw ? applyAlias(table, dateFieldRaw) : null;
    if (!dateField || !cols.has(dateField)) return null;
    if (typeCategory(columnTypes[dateField]) !== 'date') return null;
    return { type: 'pct_change', field, dateField };
  }

  if (type === 'timeseries') {
    const dateFieldRaw = postProcess.dateField ? normKey(postProcess.dateField) : null;
    const dateField = dateFieldRaw ? applyAlias(table, dateFieldRaw) : null;
    if (!dateField || !cols.has(dateField)) return null;
    if (typeCategory(columnTypes[dateField]) !== 'date') return null;

    const granularityRaw = postProcess.granularity ? normKey(postProcess.granularity) : 'month';
    const granularity = ['day', 'month', 'year'].includes(granularityRaw) ? granularityRaw : 'month';
    const calcRaw = postProcess.calc ? normKey(postProcess.calc) : 'sum';
    const calc = ['sum', 'avg', 'count'].includes(calcRaw) ? calcRaw : 'sum';
    const pctChange = !!postProcess.pctChange;

    let normalizedField = field;
    if (calc !== 'count') {
      if (!normalizedField || !cols.has(normalizedField)) return null;
      if (typeCategory(columnTypes[normalizedField]) !== 'number') return null;
    } else if (!normalizedField || !cols.has(normalizedField)) {
      normalizedField = cols.has('id') ? 'id' : null;
    }

    return { type: 'timeseries', field: normalizedField, dateField, granularity, calc, pctChange };
  }

  if (type === 'group_sum') {
    const groupByRaw = postProcess.groupBy ? normKey(postProcess.groupBy) : null;
    const groupBy = groupByRaw ? applyAlias(table, groupByRaw) : null;
    if (!groupBy || !cols.has(groupBy)) return null;
    if (!field || !cols.has(field)) return null;
    if (typeCategory(columnTypes[field]) !== 'number') return null;
    return { type: 'group_sum', field, groupBy };
  }

  if (type === 'count') {
    if (field && cols.has(field)) return { type: 'count', field };
    return { type: 'count', field: field && cols.has(field) ? field : null };
  }

  return null;
}

function buildSchemaMeta(meta) {
  return meta
    ? {
        hasEmpresaId: !!meta.hasEmpresaId,
        isGlobal: !!meta.isGlobal,
        safeWithoutEmpresaId: !!meta.safeWithoutEmpresaId,
      }
    : null;
}

const question = norm(input.question || '');
const questionLower = question.toLowerCase();
const questionDates = extractDates(questionLower);
const mentionsMovimentacao = questionLower.includes('moviment');
const mentionsLancamentos = questionLower.includes('lancamento') || questionLower.includes('lançamento');
const mentionsEntradasSaidas = questionLower.includes('entrada') || questionLower.includes('saída') || questionLower.includes('saida');
const mentionsCaixa = questionLower.includes('caixa');
const mentionsRecebimentos = questionLower.includes('recebimento') || questionLower.includes('pagamento') || questionLower.includes('pagamentos');
const mentionsEstoque = questionLower.includes('estoque');
const isCaixaIntent = mentionsMovimentacao || mentionsLancamentos || mentionsEntradasSaidas || mentionsCaixa || mentionsRecebimentos;

if (!plan || typeof plan !== 'object') {
  return [{ json: { ...input, queryPlan: plan, validationError: null, schemaTableMeta: null } }];
}

const intent = normKey(plan.intent || '');
const clarifyQuestion = plan.clarifyQuestion ? String(plan.clarifyQuestion).trim() : '';
if (intent === 'clarify' || clarifyQuestion) {
  return [{
    json: {
      ...input,
      queryPlan: { needsQuery: false, intent: 'clarify', clarifyQuestion: clarifyQuestion || null },
      validationError: null,
      schemaTableMeta: null
    }
  }];
}

// Se não precisa consultar, não mexer no plano
if (!plan.needsQuery) {
  return [{ json: { ...input, queryPlan: { ...plan, intent, clarifyQuestion: null }, validationError: null, schemaTableMeta: null } }];
}

const empresaId = input.empresaId || input.empresa_id || input.body?.empresaId || input.body?.empresa_id || null;
const rpcPlan = plan?.rpc && typeof plan.rpc === 'object' ? plan.rpc : null;
if (rpcPlan && rpcPlan.name) {
  const rpcName = normKey(rpcPlan.name);
  const rpcMeta = getRpcMeta(rpcName);
  if (!rpcMeta) {
    validationError = 'RPC não encontrada: "' + rpcName + '".';
    return [{ json: { ...input, queryPlan: { ...plan, needsQuery: false, rpc: null }, validationError, schemaTableMeta: null } }];
  }

  const rawArgs = rpcPlan.args && typeof rpcPlan.args === 'object' && !Array.isArray(rpcPlan.args) ? rpcPlan.args : {};
  const argsLower = {};
  for (const [k, v] of Object.entries(rawArgs)) {
    argsLower[normKey(k)] = v;
  }

  const normalizedArgs = {};
  if (Array.isArray(rpcMeta.args) && rpcMeta.args.length) {
    for (const arg of rpcMeta.args) {
      const key = normKey(arg.name);
      if (argsLower[key] !== undefined) {
        normalizedArgs[key] = coerceValue(arg.type, argsLower[key], null);
      } else if (key === 'empresa_id' && empresaId) {
        normalizedArgs[key] = String(empresaId);
      }
    }
  } else {
    Object.assign(normalizedArgs, rawArgs);
  }

  const normalizedPlan = {
    needsQuery: true,
    intent,
    clarifyQuestion: null,
    table: null,
    select: '',
    limit: 0,
    order: '',
    filters: [],
    postProcess: null,
    rpc: {
      name: rpcMeta.name || rpcName,
      args: normalizedArgs,
    },
  };

  return [{
    json: {
      ...input,
      queryPlan: normalizedPlan,
      validationError,
      schemaTableMeta: null,
    }
  }];
}

let table = normKey(plan.table);
if (!table) {
  validationError = 'Não consegui identificar a tabela para consulta.';
  return [{ json: { ...input, queryPlan: { ...plan, needsQuery: false, table: null }, validationError, schemaTableMeta: null } }];
}

if (table === 'movimentacoes_estoque' && isCaixaIntent && !mentionsEstoque) {
  table = 'lancamentos_caixa';
  plan.table = table;
}

const tableMeta = allowedTables[table] || null;
if (!tableMeta) {
    validationError = 'Consulta não permitida para a tabela "' + table + '".';
  return [{ json: { ...input, queryPlan: { ...plan, needsQuery: false, table: null }, validationError, schemaTableMeta: null } }];
}

const isCaixaQuery = table === 'lancamentos_caixa' && isCaixaIntent && !mentionsEstoque;
if (isCaixaQuery) {
  const rawSelect = norm(plan.select);
  const hasRelations = rawSelect.includes('(') && rawSelect.includes(')');
  if (!rawSelect || rawSelect === '*' || hasRelations) {
    plan.select = 'data,tipo,valor,historico,documento,conta_bancaria_id,grupo_contas_id';
  }
  if (!norm(plan.order)) {
    plan.order = 'data.desc';
  }
  const rawFilters = Array.isArray(plan.filters) ? [...plan.filters] : [];
  const hasDateFilter = rawFilters.some((f) => normKey(f?.field) === 'data');
  if (!hasDateFilter && questionDates.length) {
    if (questionDates.length >= 2) {
      rawFilters.push({ field: 'data', op: 'gte', value: questionDates[0] });
      rawFilters.push({ field: 'data', op: 'lte', value: questionDates[1] });
    } else {
      rawFilters.push({ field: 'data', op: 'eq', value: questionDates[0] });
    }
  }
  plan.filters = rawFilters;

  const wantsSingle = /\\buma\\s+moviment/.test(questionLower) || /\\b1\\s+moviment/.test(questionLower);
  if (wantsSingle) {
    plan.limit = 1;
  }
}

// Default limit reduzido para 50 para melhor performance (antes era 100)
// Para análises/trends/comparisons ou quando há postProcess, usar 1000
let defaultLimit = 50;
if (['analysis', 'trend', 'comparison'].includes(intent) || plan.postProcess) {
  defaultLimit = 1000;
}
const limitNum = Number.isFinite(plan.limit) ? plan.limit : Number(plan.limit || defaultLimit);
const limit = Math.max(1, Math.min(1000, Number.isFinite(limitNum) ? limitNum : defaultLimit));

const offsetNum = Number.isFinite(plan.offset) ? plan.offset : Number(plan.offset || 0);
const offset = Math.max(0, Number.isFinite(offsetNum) ? offsetNum : 0);

let select = normalizeSelect(table, plan.select);
const postProcess = normalizePostProcess(table, plan.postProcess);

const forcePaginate = postProcess && (postProcess.type === 'timeseries' || postProcess.type === 'group_sum');
const autoPaginate = forcePaginate
  ? true
  : (typeof plan.autoPaginate === 'boolean'
    ? plan.autoPaginate
    : (['analysis', 'trend', 'comparison'].includes(intent) || !!postProcess));
const defaultMaxPages = forcePaginate ? 20 : (autoPaginate ? 10 : 1);
const maxPagesNum = Number.isFinite(plan.maxPages) ? plan.maxPages : Number(plan.maxPages || defaultMaxPages);
const maxPages = Math.max(1, Math.min(20, Number.isFinite(maxPagesNum) ? maxPagesNum : defaultMaxPages));

// Estoques: garantir saldo_inicial junto com saldo_atual para cálculo do saldo exibido (saldo_inicial + saldo_atual)
if (table === 'estoques') {
  const colsSet = new Set(tableMeta.columns || []);
  if (select !== '*') {
    const selectCols = splitSelect(select).map((s) => normKey(s)).filter(Boolean);
    const needsSaldoInicial = colsSet.has('saldo_inicial') && (selectCols.includes('saldo_atual') || (postProcess && postProcess.type === 'sum' && postProcess.field === 'saldo_atual'));
    if (needsSaldoInicial && !selectCols.includes('saldo_inicial')) {
      select = [...selectCols, 'saldo_inicial'].filter(Boolean).join(',');
    }
  }
}

if (postProcess && postProcess.type === 'pct_change' && postProcess.dateField) {
  if (select !== '*') {
    const selectCols = splitSelect(select).map((s) => normKey(s)).filter(Boolean);
    if (!selectCols.includes(postProcess.dateField)) {
      select = [...selectCols, postProcess.dateField].filter(Boolean).join(',');
    }
  }
}

if (postProcess && postProcess.type === 'timeseries' && postProcess.dateField) {
  if (select !== '*') {
    const selectCols = splitSelect(select).map((s) => normKey(s)).filter(Boolean);
    const needsField = postProcess.calc !== 'count' && postProcess.field;
    const toAdd = [];
    if (!selectCols.includes(postProcess.dateField)) {
      toAdd.push(postProcess.dateField);
    }
    if (needsField && !selectCols.includes(postProcess.field)) {
      toAdd.push(postProcess.field);
    }
    if (toAdd.length) {
      select = [...selectCols, ...toAdd].filter(Boolean).join(',');
    }
  }
}

if (postProcess && postProcess.type === 'group_sum') {
  if (select !== '*') {
    const selectCols = splitSelect(select).map((s) => normKey(s)).filter(Boolean);
    const toAdd = [];
    if (postProcess.field && !selectCols.includes(postProcess.field)) {
      toAdd.push(postProcess.field);
    }
    if (postProcess.groupBy && !selectCols.includes(postProcess.groupBy)) {
      toAdd.push(postProcess.groupBy);
    }
    if (toAdd.length) {
      select = [...selectCols, ...toAdd].filter(Boolean).join(',');
    }
  }
}

const normalizedPlan = {
  needsQuery: true,
  table,
  select,
  limit,
  order: normalizeOrder(table, plan.order || (postProcess && (postProcess.type === 'pct_change' || postProcess.type === 'timeseries') && postProcess.dateField ? postProcess.dateField + '.asc' : '')),
  filters: normalizeFilters(table, plan.filters),
  postProcess,
  offset,
  autoPaginate,
  maxPages,
  intent,
  clarifyQuestion: null,
};

return [{
  json: {
    ...input,
    queryPlan: normalizedPlan,
    validationError,
    schemaTableMeta: buildSchemaMeta(tableMeta),
  }
}];
`.trim();
}

function buildBuildSupabaseUrlJsCode() {
  return `
const input = items[0].json;
const plan = input.queryPlan || {};

const baseUrl = 'https://zhsucbowsxfwmsrdvhre.supabase.co';
const rpc = plan?.rpc && typeof plan.rpc === 'object' ? plan.rpc : null;

if (!plan.needsQuery) {
  return [{ json: { ...input, supabaseQueryUrl: '', supabaseMethod: 'GET', supabaseBody: null, queryStartAt: null } }];
}

if (rpc && rpc.name) {
  const rpcName = String(rpc.name);
  const url = baseUrl + '/rest/v1/rpc/' + encodeURIComponent(rpcName);
  const body = rpc.args && typeof rpc.args === 'object' ? rpc.args : {};
  return [{ json: { ...input, supabaseQueryUrl: url, supabaseMethod: 'POST', supabaseBody: body, queryStartAt: Date.now() } }];
}

if (!plan.table) {
  return [{ json: { ...input, supabaseQueryUrl: '', supabaseMethod: 'GET', supabaseBody: null } }];
}

const table = String(plan.table);
const select = String(plan.select || '*');
const limit = Number.isFinite(plan.limit) ? plan.limit : 50; // Reduzido de 100 para 50 para melhor performance
const order = String(plan.order || 'id.desc');
const offset = Number.isFinite(plan.offset) ? plan.offset : 0;

const globalTables = new Set(['bancos', 'ufs']);
const empresaId = input.empresaId || input.empresa_id || input.body?.empresaId || input.body?.empresa_id || null;

const filters = Array.isArray(plan.filters) ? [...plan.filters] : [];

// Não injetar empresa_id em tabelas globais (bancos/ufs) ou tabelas sem empresa_id (RLS via relacionamento)
const meta = input.schemaTableMeta || null;
const isGlobal = !!meta?.isGlobal || globalTables.has(table);
const shouldInjectEmpresaId = !!empresaId && !isGlobal && meta?.hasEmpresaId !== false && !meta?.safeWithoutEmpresaId;

if (shouldInjectEmpresaId) {
  const alreadyHasEmpresa = filters.some((f) => String(f?.field || '').toLowerCase() === 'empresa_id');
  if (!alreadyHasEmpresa) {
    filters.push({ field: 'empresa_id', op: 'eq', value: String(empresaId) });
  }
}

const params = [];
params.push('select=' + encodeURIComponent(select));
params.push('limit=' + encodeURIComponent(String(limit)));
params.push('offset=' + encodeURIComponent(String(offset)));
params.push('order=' + encodeURIComponent(order));

for (const f of filters) {
  if (!f || !f.field || !f.op) continue;
  const field = String(f.field);
  const op = String(f.op);
  const valueStr = f.value === null || f.value === undefined ? '' : String(f.value);
  params.push(encodeURIComponent(field) + '=' + op + '.' + encodeURIComponent(valueStr));
}

const url = baseUrl + '/rest/v1/' + encodeURIComponent(table) + '?' + params.join('&');

const queryStartAt = Date.now();

return [{ json: { ...input, queryPlan: { ...plan, filters }, supabaseQueryUrl: url, supabaseMethod: 'GET', supabaseBody: null, queryStartAt } }];
`.trim();
}

function buildPostProcessJsCode() {
  return `
const input = items[0].json;
const plan = input.queryPlan || {};

const supabaseError = input.supabaseError ?? null;
const rows = Array.isArray(input.supabaseResult)
  ? input.supabaseResult
  : (input.supabaseResult ? [input.supabaseResult] : []);

const post = plan.postProcess || null;
let postProcessResult = null;

if (post && post.type) {
  const field = post.field ? String(post.field) : null;
  const table = String(plan.table || '');

  const toNumber = (value) => {
    const n = typeof value === 'number' ? value : parseFloat(String(value ?? '0'));
    return Number.isFinite(n) ? n : null;
  };
  const rounded = (n) => Math.round(n * 100) / 100;
  const getNumericValue = (row) => {
    if (!field) return null;
    if (table === 'estoques' && field === 'saldo_atual') {
      const si = toNumber(row?.saldo_inicial) ?? 0;
      const sa = toNumber(row?.saldo_atual) ?? 0;
      return si + sa;
    }
    return toNumber(row?.[field]);
  };

  if (field && ['sum', 'avg', 'min', 'max', 'median'].includes(post.type)) {
    const values = rows.map((r) => getNumericValue(r)).filter((v) => Number.isFinite(v));
    const count = values.length;
    const sum = values.reduce((acc, v) => acc + v, 0);
    const avg = count ? sum / count : 0;
    const min = count ? Math.min(...values) : 0;
    const max = count ? Math.max(...values) : 0;
    const sorted = [...values].sort((a, b) => a - b);
    const median = count
      ? (count % 2 === 0 ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2 : sorted[Math.floor(count / 2)])
      : 0;

    const effectiveField = (table === 'estoques' && field === 'saldo_atual') ? 'saldo_exibido' : field;

    if (post.type === 'sum') postProcessResult = { type: 'sum', field: effectiveField, value: rounded(sum), count };
    if (post.type === 'avg') postProcessResult = { type: 'avg', field: effectiveField, value: rounded(avg), count };
    if (post.type === 'min') postProcessResult = { type: 'min', field: effectiveField, value: rounded(min), count };
    if (post.type === 'max') postProcessResult = { type: 'max', field: effectiveField, value: rounded(max), count };
    if (post.type === 'median') postProcessResult = { type: 'median', field: effectiveField, value: rounded(median), count };
  }

  if (field && post.type === 'stats') {
    const values = rows.map((r) => getNumericValue(r)).filter((v) => Number.isFinite(v));
    const count = values.length;
    const sum = values.reduce((acc, v) => acc + v, 0);
    const avg = count ? sum / count : 0;
    const min = count ? Math.min(...values) : 0;
    const max = count ? Math.max(...values) : 0;
    const sorted = [...values].sort((a, b) => a - b);
    const median = count
      ? (count % 2 === 0 ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2 : sorted[Math.floor(count / 2)])
      : 0;
    const quantile = (arr, q) => {
      if (!arr.length) return 0;
      const pos = (arr.length - 1) * q;
      const base = Math.floor(pos);
      const rest = pos - base;
      if (arr[base + 1] !== undefined) {
        return arr[base] + rest * (arr[base + 1] - arr[base]);
      }
      return arr[base];
    };
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;
    const outliers = sorted.filter((v) => v < lower || v > upper);
    const variance = count ? values.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / count : 0;
    const stddev = Math.sqrt(variance);
    const p90 = quantile(sorted, 0.9);
    const p95 = quantile(sorted, 0.95);

    const effectiveField = (table === 'estoques' && field === 'saldo_atual') ? 'saldo_exibido' : field;

    postProcessResult = {
      type: 'stats',
      field: effectiveField,
      count,
      sum: rounded(sum),
      avg: rounded(avg),
      min: rounded(min),
      max: rounded(max),
      median: rounded(median),
      p90: rounded(p90),
      p95: rounded(p95),
      stddev: rounded(stddev),
      outliers: {
        count: outliers.length,
        samples: outliers.slice(0, 10).map(rounded),
      },
    };
  }

  if (post.type === 'pct_change' && post.dateField && field) {
    const dateField = String(post.dateField);
    const pairs = rows.map((r) => {
      const rawDate = r?.[dateField];
      const dt = rawDate ? new Date(rawDate) : null;
      const value = getNumericValue(r);
      return { dt, value };
    }).filter((p) => p.dt && Number.isFinite(p.value));

    pairs.sort((a, b) => a.dt - b.dt);
    const first = pairs[0];
    const last = pairs[pairs.length - 1];

    let pct = null;
    if (first && last && first.value !== 0) {
      pct = ((last.value - first.value) / Math.abs(first.value)) * 100;
    }

    postProcessResult = {
      type: 'pct_change',
      field,
      dateField,
      from: first ? first.value : null,
      to: last ? last.value : null,
      percent: pct !== null ? rounded(pct) : null,
    };
  }

  if (post.type === 'timeseries' && post.dateField) {
    const dateField = String(post.dateField);
    const granularityRaw = String(post.granularity || 'month').toLowerCase();
    const granularity = ['day', 'month', 'year'].includes(granularityRaw) ? granularityRaw : 'month';
    const calcRaw = String(post.calc || 'sum').toLowerCase();
    const calc = ['sum', 'avg', 'count'].includes(calcRaw) ? calcRaw : 'sum';
    const pctChange = !!post.pctChange;

    const groups = {};
    rows.forEach((r) => {
      const rawDate = r?.[dateField];
      if (!rawDate) return;

      let period = null;
      if (typeof rawDate === 'string') {
        if (/^\\d{4}-\\d{2}-\\d{2}/.test(rawDate)) {
          if (granularity === 'year') period = rawDate.substring(0, 4);
          else if (granularity === 'month') period = rawDate.substring(0, 7);
          else period = rawDate.substring(0, 10);
        }
      }

      if (!period) {
        const dt = new Date(rawDate);
        if (!Number.isFinite(dt.getTime())) return;
        if (granularity === 'year') {
          period = String(dt.getFullYear());
        } else if (granularity === 'month') {
          period = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
        } else {
          period = dt.toISOString().split('T')[0];
        }
      }

      if (!groups[period]) groups[period] = [];
      groups[period].push(r);
    });

    const periods = Object.keys(groups).sort();
    const series = [];

    for (let idx = 0; idx < periods.length; idx += 1) {
      const period = periods[idx];
      const groupRows = groups[period];

      let value = 0;
      if (calc === 'count') {
        value = groupRows.length;
      } else if (field) {
        const values = groupRows.map((r) => getNumericValue(r)).filter((v) => Number.isFinite(v));
        if (calc === 'avg') {
          value = values.length ? values.reduce((acc, v) => acc + v, 0) / values.length : 0;
        } else {
          value = values.reduce((acc, v) => acc + v, 0);
        }
      }

      let pct = null;
      if (pctChange && idx > 0) {
        const prevValue = series[idx - 1]?.value;
        if (Number.isFinite(prevValue) && prevValue !== 0) {
          pct = ((value - prevValue) / Math.abs(prevValue)) * 100;
        }
      }

      series.push({
        period,
        value: rounded(value),
        pctChange: pct !== null ? rounded(pct) : null,
      });
    }

    postProcessResult = {
      type: 'timeseries',
      field: field || null,
      dateField,
      granularity,
      calc,
      series,
    };
  }

  if (post.type === 'group_sum' && post.groupBy && field) {
    const groupBy = String(post.groupBy);
    const groups = {};

    rows.forEach((r) => {
      const rawKey = r?.[groupBy];
      const key = (rawKey === null || rawKey === undefined || rawKey === '') ? '(vazio)' : String(rawKey);
      if (!groups[key]) {
        groups[key] = { values: [], count: 0 };
      }
      const val = getNumericValue(r);
      if (Number.isFinite(val)) {
        groups[key].values.push(val);
      }
      groups[key].count += 1;
    });

    const result = Object.keys(groups)
      .sort()
      .map((key) => ({
        key,
        value: rounded(groups[key].values.reduce((acc, v) => acc + v, 0)),
        count: groups[key].count,
      }));

    postProcessResult = {
      type: 'group_sum',
      field,
      groupBy,
      groups: result,
    };
  }
}

if (post && post.type === 'count') {
  const field = post.field ? String(post.field) : null;
  postProcessResult = { type: 'count', field, value: rows.length };
}

const preview = rows.slice(0, 25);

// Fast Answer: Para listas simples (needsQuery=true, postProcess=null, sem erro), gerar resposta rápida
const plan = input.queryPlan || {};
const isList = !!plan.needsQuery && !postProcessResult && !supabaseError;
const count = rows.length;

let fastAnswer = null;
if (isList && count > 0) {
  // Gerar resposta rápida sem chamar LLM
  fastAnswer = 'Encontrei ' + count + ' registros. A tabela abaixo mostra a página atual.';
}

return [{ json: { ...input, supabaseError, supabaseRows: rows, supabasePreview: preview, postProcessResult, fastAnswer } }];
`.trim();
}

function ensureFastAnswerBypass(workflow) {
  if (!workflow || !Array.isArray(workflow.nodes)) return;

  const fastNodeName = 'Fast Answer?';
  const postProcessName = 'Post-process';
  const answerName = 'Answer Formatter';
  const respondName = 'Respond to Webhook';

  let fastNode = workflow.nodes.find((n) => n?.name === fastNodeName);
  if (!fastNode) {
    fastNode = {
      id: 'fast-answer-if',
      name: fastNodeName,
      type: 'n8n-nodes-base.if',
      typeVersion: 2,
      position: [1780, -144],
      parameters: {
        conditions: {
          string: [
            {
              value1: '={{ $json.fastAnswer }}',
              operation: 'notEmpty',
            },
          ],
        },
      },
    };
    workflow.nodes.push(fastNode);
  } else {
    fastNode.type = 'n8n-nodes-base.if';
    fastNode.typeVersion = fastNode.typeVersion || 2;
    fastNode.parameters = fastNode.parameters || {};
    fastNode.parameters.conditions = {
      string: [
        {
          value1: '={{ $json.fastAnswer }}',
          operation: 'notEmpty',
        },
      ],
    };
  }

  workflow.connections = workflow.connections || {};
  workflow.connections[postProcessName] = {
    main: [[{ node: fastNodeName, type: 'main', index: 0 }]],
  };
  workflow.connections[fastNodeName] = {
    main: [
      [{ node: respondName, type: 'main', index: 0 }],
      [{ node: answerName, type: 'main', index: 0 }],
    ],
  };
  if (!workflow.connections[answerName]) {
    workflow.connections[answerName] = {
      main: [[{ node: respondName, type: 'main', index: 0 }]],
    };
  }
}

function syncWorkflow(workflowPath, schemaIndex) {
  const workflow = readJson(workflowPath);

  const queryPlanner = workflow.nodes.find((n) => n?.name === 'Query Planner');
  if (queryPlanner?.parameters?.options?.systemMessage) {
    queryPlanner.parameters.options.systemMessage = buildQueryPlannerSystemMessage(schemaIndex);
  }

  const extractContext = workflow.nodes.find((n) => n?.name === 'Extract Context');
  if (extractContext?.parameters?.jsCode) {
    extractContext.parameters.jsCode = buildExtractContextJsCode();
  }

  const validateNode = workflow.nodes.find((n) => n?.name === 'Validate & Normalize Plan');
  if (!validateNode) {
    throw new Error(`Node "Validate & Normalize Plan" não encontrado em ${path.basename(workflowPath)}`);
  }
  validateNode.parameters = validateNode.parameters || {};
  validateNode.parameters.jsCode = buildValidateNormalizeJsCode(schemaIndex);

  const buildUrlNode = workflow.nodes.find((n) => n?.name === 'Build Supabase URL');
  if (!buildUrlNode) {
    throw new Error(`Node "Build Supabase URL" não encontrado em ${path.basename(workflowPath)}`);
  }
  buildUrlNode.parameters = buildUrlNode.parameters || {};
  buildUrlNode.parameters.jsCode = buildBuildSupabaseUrlJsCode();

  const postProcessNode = workflow.nodes.find((n) => n?.name === 'Post-process');
  if (postProcessNode?.parameters?.jsCode) {
    postProcessNode.parameters.jsCode = buildPostProcessJsCode();
  }

  const supabaseQueryNode = workflow.nodes.find((n) => n?.name === 'Supabase Query');
  if (supabaseQueryNode?.parameters) {
    supabaseQueryNode.parameters.method = "={{ $json.supabaseMethod || 'GET' }}";
    supabaseQueryNode.parameters.sendBody = true;
    supabaseQueryNode.parameters.jsonParameters = true;
    supabaseQueryNode.parameters.bodyParametersJson = "={{ $json.supabaseMethod === 'POST' ? JSON.stringify($json.supabaseBody || {}) : '{}' }}";
  }

  const wrapSupabase = workflow.nodes.find((n) => n?.name === 'Wrap Supabase Result');
  if (wrapSupabase?.parameters?.jsCode) {
    wrapSupabase.parameters.jsCode = buildWrapSupabaseResultJsCode();
  }

  const answerFormatter = workflow.nodes.find((n) => n?.name === 'Answer Formatter');
  if (answerFormatter?.parameters?.options?.systemMessage) {
    answerFormatter.parameters.options.systemMessage = buildAnswerFormatterSystemMessage();
  }
  if (answerFormatter?.parameters?.text) {
    answerFormatter.parameters.text = "={{ JSON.stringify({ question: $json.question || '', plan: $json.queryPlan || {}, validationError: $json.validationError || null, postProcessResult: $json.postProcessResult || null, rowsPreview: $json.supabasePreview || [], rowCount: $json.rowCount || 0, history: $json.history || null, supabaseError: $json.supabaseError || null, fastAnswer: $json.fastAnswer || null }) }}";
  }

  const respondNode = workflow.nodes.find((n) => n?.name === 'Respond to Webhook');
  if (respondNode?.parameters?.responseBody) {
    respondNode.parameters.responseBody = buildRespondToWebhookBody();
  }

  ensureFastAnswerBypass(workflow);

  writeJson(workflowPath, workflow);
  console.log('✅ Sync OK:', path.relative(projectRoot, workflowPath));
}

function main() {
  if (!fs.existsSync(schemaIndexPath)) {
    console.error('❌ Schema index não encontrado:', path.relative(projectRoot, schemaIndexPath));
    console.error('Rode primeiro: node scripts/generate-ai-schema-index.cjs');
    process.exit(1);
  }

  const schemaIndex = readJson(schemaIndexPath);
  for (const wfPath of workflowPaths) {
    if (!fs.existsSync(wfPath)) {
      console.warn('⚠️ Workflow não encontrado:', path.relative(projectRoot, wfPath));
      continue;
    }
    syncWorkflow(wfPath, schemaIndex);
  }
}

main();
