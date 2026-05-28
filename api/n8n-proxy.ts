// Vercel Serverless Function types
interface VercelRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: any;
  query?: Record<string, string | string[]>;
  socket?: {
    remoteAddress?: string;
  };
}

interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (data: any) => void;
  send: (data: any) => void;
}

interface CacheEntry {
  response: any;
  timestamp: number;
  version?: string;
}

/**
 * Vercel Serverless Function config.
 * maxDuration: 60s para plano Pro (default é 10s no Free).
 */
export const config = {
  maxDuration: 60,
};

/**
 * Cache em memória como fallback quando Supabase não está disponível.
 * Este cache é volátil e será perdido entre invocações da função serverless.
 */
const memoryCache = new Map<string, CacheEntry>();

/**
 * TTL (Time To Live) do cache em segundos.
 * Respostas são cacheadas por 1 hora para balancear performance e atualidade dos dados.
 */
const CACHE_TTL = 60 * 60; // 1 hora em segundos

/**
 * Prefixo consistente para todas as chaves de cache.
 * Facilita identificação e limpeza seletiva de cache no futuro.
 */
const CACHE_PREFIX = 'ai-copilot:cache:';

/**
 * Versão do formato de cache.
 * Útil para migrações futuras e compatibilidade entre versões.
 */
const CACHE_VERSION = '1.0';

/**
 * Verifica se o Supabase está disponível e configurado.
 * @returns true se Supabase está disponível, false caso contrário
 */
function isSupabaseAvailable(): boolean {
  return !!(process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    !!(process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Obtém a URL do Supabase das variáveis de ambiente.
 */
function getSupabaseUrl(): string {
  return process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    '';
}

/**
 * Obtém a chave anon do Supabase das variáveis de ambiente.
 */
function getSupabaseAnonKey(): string {
  return process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';
}

/**
 * Obtém a chave service role do Supabase das variáveis de ambiente.
 */
function getSupabaseServiceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    '';
}

function buildHistorySummary(history: Array<{ role: string; content: string }>): string | null {
  if (!Array.isArray(history) || history.length === 0) return null;
  const recent = history.slice(-4).map((m) => `${m.role}: ${m.content}`).join(' | ');
  return recent || null;
}

async function loadConversationHistory(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
  conversationId: string,
  limit = 8
): Promise<{ history: Array<{ role: string; content: string }>; messageCount: number; historySummary: string | null } | null> {
  if (!supabaseUrl || !serviceRoleKey || !userId || !conversationId) return null;

  try {
    const url = `${supabaseUrl}/rest/v1/ai_copilot_conversations?select=messages,message_count&user_id=eq.${encodeURIComponent(userId)}&conversation_id=eq.${encodeURIComponent(conversationId)}&limit=1`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: 'application/json',
      },
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      console.warn('[Proxy] Falha ao carregar histórico de conversas:', resp.status, txt.substring(0, 200));
      return null;
    }

    const data = await resp.json().catch(() => []);
    const convo = Array.isArray(data) ? data[0] : data;
    const messages = Array.isArray(convo?.messages) ? convo.messages : [];
    const history = messages
      .slice(-limit)
      .map((m: any) => ({
        role: String(m?.role || m?.type || 'user'),
        content: String(m?.content || m?.text || '').trim(),
      }))
      .filter((m: any) => m.content);

    return {
      history,
      messageCount: Number(convo?.message_count || messages.length || 0),
      historySummary: buildHistorySummary(history),
    };
  } catch (err: any) {
    console.warn('[Proxy] Erro ao carregar histórico de conversas:', err?.message || err);
    return null;
  }
}

/**
 * Rate limiting simples em memória.
 * Em produção, considere usar Redis ou Vercel KV para rate limiting distribuído.
 * 
 * Limita: 10 requisições por minuto por IP.
 */
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minuto em milissegundos
const RATE_LIMIT_MAX = 10; // Máximo de requisições por janela de tempo

/**
 * Extrai o IP do cliente da requisição.
 * Considera headers de proxy (X-Forwarded-For) para obter o IP real.
 * 
 * @param req - Requisição do Vercel
 * @returns IP do cliente ou 'unknown' se não puder ser determinado
 */
function getClientIP(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded
    ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0])
    : req.socket?.remoteAddress || 'unknown';
  return ip.trim();
}

function getHeaderValue(req: VercelRequest, headerName: string): string | null {
  const direct = req.headers[headerName];
  if (typeof direct === 'string') return direct;
  if (Array.isArray(direct)) return direct[0] ?? null;

  // Também checar variações de case (por segurança)
  const lowered = headerName.toLowerCase();
  const foundKey = Object.keys(req.headers).find((k) => k.toLowerCase() === lowered);
  if (!foundKey) return null;
  const value = req.headers[foundKey];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function logEvent(event: string, payload: Record<string, any>) {
  console.log(JSON.stringify({
    event,
    ts: new Date().toISOString(),
    ...payload,
  }));
}

/**
 * Verifica se um IP excedeu o limite de requisições.
 * Implementa rate limiting com janela deslizante.
 * 
 * @param ip - IP do cliente
 * @returns true se a requisição pode prosseguir, false se excedeu o limite
 */
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  // Nova janela ou janela expirada
  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }

  // Limite excedido
  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }

  // Incrementar contador
  record.count++;
  return true;
}

/**
 * Gera uma chave de cache única baseada na pergunta e ID da conversa.
 * Usa prefixo consistente para facilitar identificação e limpeza.
 * 
 * @param question - A pergunta do usuário
 * @param conversationId - ID único da conversa
 * @returns Chave de cache formatada com prefixo
 */
function generateCacheKey(question: string, conversationId: string, scope: string = ''): string {
  // Normalizar dados para garantir consistência
  const normalizedQuestion = question.trim().toLowerCase();
  const normalizedScope = scope ? scope.trim().toLowerCase() : '';
  const data = `${normalizedQuestion}:${conversationId}:${normalizedScope}`;

  // Gerar hash simples (em produção, considerar SHA256)
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  // Retornar chave com prefixo consistente
  return `${CACHE_PREFIX}${Math.abs(hash)}`;
}

/**
 * Obtém uma resposta do cache (Supabase ou memória).
 * Tenta Supabase primeiro, com fallback automático para cache em memória.
 * 
 * @param key - Chave de cache
 * @returns Resposta em cache ou null se não encontrada/expirada
 */
async function getCachedResponse(key: string): Promise<any | null> {
  console.log(`[Cache] Buscando cache para chave: ${key.substring(0, 50)}...`);

  // Tentar Supabase primeiro se disponível
  if (isSupabaseAvailable()) {
    try {
      const supabaseUrl = getSupabaseUrl();
      const supabaseKey = getSupabaseAnonKey();

      console.log(`[Cache] Tentando ler do Supabase...`);
      // Usar a função SQL get_cache_value via RPC
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_cache_value`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ p_cache_key: key }),
      });

      console.log(`[Cache] Resposta do Supabase:`, { status: response.status, ok: response.ok });

      if (response.ok) {
        const data = await response.json().catch((parseError: any) => {
          console.error('[Cache] Erro ao fazer parse da resposta do Supabase:', parseError?.message);
          throw parseError;
        });

        // A função SQL retorna um array com um objeto { result: JSONB }
        if (data && Array.isArray(data) && data.length > 0 && data[0].result) {
          const cacheValue = data[0].result;
          // O cache_value é um JSONB que contém { response, timestamp, version }
          const cacheEntry = typeof cacheValue === 'string' ? JSON.parse(cacheValue) : cacheValue;
          console.log(`[Cache] ✅ Hit no Supabase para chave: ${key.substring(0, 50)}...`);
          return cacheEntry.response || cacheEntry; // Suportar formato antigo e novo
        } else if (data && data !== null && !Array.isArray(data)) {
          // Caso retorne diretamente o JSONB
          const cacheEntry = typeof data === 'string' ? JSON.parse(data) : data;
          console.log(`[Cache] ✅ Hit no Supabase para chave: ${key.substring(0, 50)}...`);
          return cacheEntry.response || cacheEntry;
        } else {
          console.log(`[Cache] Cache não encontrado no Supabase (resposta vazia)`);
        }
      } else if (response.status !== 404) {
        // Log apenas se não for 404 (cache não encontrado é normal)
        const errorText = await response.text().catch(() => '');
        console.warn(`[Cache] Erro ao ler do Supabase (${response.status}): ${errorText.substring(0, 200)}, usando fallback`);
      } else {
        console.log(`[Cache] Cache não encontrado no Supabase (404)`);
      }
    } catch (error: any) {
      console.error('[Cache] Erro ao ler do Supabase, usando fallback:', {
        error: error?.message,
        stack: error?.stack?.substring(0, 300),
        name: error?.name
      });
      // Fallback para cache em memória em caso de erro
    }
  } else {
    console.log(`[Cache] Supabase não disponível, usando cache em memória`);
  }

  // Fallback para cache em memória
  const entry = memoryCache.get(key);
  if (!entry) {
    console.log(`[Cache] Cache não encontrado em memória`);
    return null;
  }

  // Verificar expiração
  const now = Date.now();
  const ttlMs = CACHE_TTL * 1000;
  if (now - entry.timestamp > ttlMs) {
    console.log(`[Cache] Cache expirado em memória, removendo`);
    memoryCache.delete(key);
    return null;
  }

  console.log(`[Cache] ✅ Hit no cache em memória para chave: ${key.substring(0, 50)}...`);
  return entry.response;
}

/**
 * Armazena uma resposta no cache (Supabase ou memória).
 * Tenta Supabase primeiro, com fallback automático para cache em memória.
 * 
 * @param key - Chave de cache
 * @param response - Resposta a ser cacheada
 */
async function setCachedResponse(key: string, response: any): Promise<void> {
  console.log(`[Cache] Armazenando cache para chave: ${key.substring(0, 50)}...`);

  const cacheEntry: CacheEntry = {
    response,
    timestamp: Date.now(),
    version: CACHE_VERSION,
  };

  // Tentar Supabase primeiro se disponível
  if (isSupabaseAvailable()) {
    try {
      const supabaseUrl = getSupabaseUrl();
      const supabaseKey = getSupabaseAnonKey();

      console.log(`[Cache] Tentando escrever no Supabase...`);
      // Usar a função SQL set_cache_value via RPC
      const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/set_cache_value`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          p_cache_key: key,
          p_cache_value: cacheEntry,
          p_ttl_seconds: CACHE_TTL,
        }),
      });

      console.log(`[Cache] Resposta do Supabase (write):`, { status: rpcResponse.status, ok: rpcResponse.ok });

      if (rpcResponse.ok) {
        console.log(`[Cache] ✅ Resposta armazenada no Supabase: ${key.substring(0, 50)}...`);
        return;
      } else {
        const errorText = await rpcResponse.text().catch(() => '');
        console.warn(`[Cache] Erro ao escrever no Supabase (${rpcResponse.status}): ${errorText.substring(0, 200)}, usando fallback`);
      }
    } catch (error: any) {
      console.error('[Cache] Erro ao escrever no Supabase, usando fallback:', {
        error: error?.message,
        stack: error?.stack?.substring(0, 300),
        name: error?.name
      });
      // Fallback para cache em memória em caso de erro
    }
  } else {
    console.log(`[Cache] Supabase não disponível, usando cache em memória`);
  }

  // Fallback para cache em memória
  memoryCache.set(key, cacheEntry);
  console.log(`[Cache] ✅ Resposta armazenada no cache em memória: ${key.substring(0, 50)}...`);
}

/**
 * Determina o timeout dinâmico baseado na complexidade da pergunta.
 * Configurado para plano Pro do Vercel (maxDuration: 60s).
 * 
 * Timeout pode ser configurado via variável de ambiente N8N_PROXY_TIMEOUT_MS.
 * Default: 55000ms (55s) para Vercel Pro, deixando 5s de margem para overhead.
 * 
 * @param question - Pergunta do usuário (não usado atualmente, mantido para compatibilidade)
 * @returns Timeout em milissegundos
 */
function determineTimeout(question: string): number {
  const envTimeout = Number(process.env.N8N_PROXY_TIMEOUT_MS);
  const MAX_TIMEOUT = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 55000; // 55 segundos default (Pro)
  return MAX_TIMEOUT;
}

/**
 * Faz uma requisição HTTP com retry automático e backoff exponencial.
 * Não faz retry em erros 4xx (client errors) ou timeouts.
 * 
 * @param url - URL da requisição
 * @param options - Opções da requisição (fetch)
 * @param maxRetries - Número máximo de tentativas (padrão: 3)
 * @returns Response da requisição bem-sucedida
 * @throws Error se todas as tentativas falharem
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastError: Error | null = null;
  const timeout = determineTimeout(typeof options.body === 'string' ? options.body : '');

  console.log(`[fetchWithRetry] Iniciando requisição com ${maxRetries} tentativas, timeout: ${timeout}ms`);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`[fetchWithRetry] Tentativa ${attempt + 1}/${maxRetries}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.log(`[fetchWithRetry] Timeout após ${timeout}ms na tentativa ${attempt + 1}`);
        controller.abort();
      }, timeout);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log(`[fetchWithRetry] Resposta recebida na tentativa ${attempt + 1}:`, {
        status: response.status,
        ok: response.ok
      });

      if (response.ok) {
        console.log(`[fetchWithRetry] ✅ Sucesso na tentativa ${attempt + 1}`);
        return response;
      }

      // Não retry em erros 4xx (client errors) - devolver a resposta para tratamento no handler
      if (response.status >= 400 && response.status < 500) {
        const errorText = await response.clone().text().catch(() => '');
        console.error(`[fetchWithRetry] Erro 4xx (não retry): ${response.status} - ${errorText.substring(0, 200)}`);
        return response;
      }

      lastError = new Error(`HTTP ${response.status}`);
      console.warn(`[fetchWithRetry] Erro ${response.status} na tentativa ${attempt + 1}, tentando novamente...`);
    } catch (error: any) {
      lastError = error;

      console.error(`[fetchWithRetry] Erro na tentativa ${attempt + 1}:`, {
        name: error?.name,
        message: error?.message,
        stack: error?.stack?.substring(0, 300)
      });

      // Não retry em abortos (timeouts)
      if (error.name === 'AbortError') {
        console.error(`[fetchWithRetry] AbortError - não retry`);
        throw error;
      }

      // Backoff exponencial
      if (attempt < maxRetries - 1) {
        const backoffDelay = Math.pow(2, attempt) * 1000;
        console.log(`[fetchWithRetry] Aguardando ${backoffDelay}ms antes da próxima tentativa...`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }
  }

  console.error(`[fetchWithRetry] ❌ Todas as ${maxRetries} tentativas falharam`);
  throw lastError || new Error('Max retries exceeded');
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  console.log('[Proxy] ========== Handler iniciado ==========');
  console.log('[Proxy] Método:', req.method);
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  logEvent('ai_copilot_request_start', { requestId, method: req.method });
  // Evitar logar headers/body completos para não vazar tokens (Authorization) em logs de produção
  console.log('[Proxy] Body type:', typeof req.body);

  try {
    // Apenas aceitar POST
    if (req.method !== 'POST') {
      console.warn('[Proxy] Método não permitido:', req.method);
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Rate limiting
    const clientIP = getClientIP(req);
    console.log('[Proxy] IP do cliente:', clientIP);
    if (!checkRateLimit(clientIP)) {
      console.warn('[Proxy] Rate limit excedido para IP:', clientIP);
      return res.status(429).json({
        error: 'Too many requests',
        message: 'Limite de requisições excedido. Tente novamente em alguns instantes.',
      });
    }

    // Validação de input rigorosa
    let requestBody;
    try {
      console.log('[Proxy] Tentando fazer parse do body...');
      requestBody = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      console.log('[Proxy] Body parseado com sucesso:', JSON.stringify(requestBody).substring(0, 200));
    } catch (parseError: any) {
      console.error('[Proxy] Erro ao fazer parse do body:', {
        error: parseError?.message,
        stack: parseError?.stack?.substring(0, 300),
        bodyType: typeof req.body,
        bodyPreview: typeof req.body === 'string' ? req.body.substring(0, 200) : 'not a string'
      });
      return res.status(400).json({
        error: 'Invalid JSON',
        message: 'Corpo da requisição inválido.',
      });
    }

    const { question, conversationId } = requestBody;
    console.log('[Proxy] Campos extraídos:', {
      hasQuestion: !!question,
      questionType: typeof question,
      questionLength: question?.length,
      hasConversationId: !!conversationId,
      conversationIdType: typeof conversationId
    });

    if (!question || typeof question !== 'string') {
      console.warn('[Proxy] Question inválido:', { question, type: typeof question });
      return res.status(400).json({
        error: 'Invalid input',
        message: 'O campo "question" é obrigatório e deve ser uma string.',
      });
    }

    // Sanitizar e validar input
    console.log('[Proxy] Sanitizando question...');
    let trimmedQuestion = question.trim();

    // Remover caracteres de controle
    trimmedQuestion = trimmedQuestion.replace(/[\x00-\x1F\x7F]/g, '');
    console.log('[Proxy] Question sanitizado, tamanho:', trimmedQuestion.length);

    // Validar tamanho mínimo
    if (trimmedQuestion.length === 0) {
      console.warn('[Proxy] Question vazio após sanitização');
      return res.status(400).json({
        error: 'Invalid input',
        message: 'A pergunta não pode estar vazia.',
      });
    }

    // Validar tamanho máximo (5000 caracteres)
    const MAX_QUESTION_LENGTH = 5000;
    if (trimmedQuestion.length > MAX_QUESTION_LENGTH) {
      console.warn('[Proxy] Question excede tamanho máximo:', trimmedQuestion.length);
      return res.status(400).json({
        error: 'Invalid input',
        message: `A pergunta não pode ter mais de ${MAX_QUESTION_LENGTH} caracteres.`,
      });
    }

    // Validar conversationId se fornecido
    if (conversationId && typeof conversationId !== 'string') {
      console.warn('[Proxy] ConversationId inválido:', { conversationId, type: typeof conversationId });
      return res.status(400).json({
        error: 'Invalid input',
        message: 'O campo "conversationId" deve ser uma string válida.',
      });
    }
    const sessionId = conversationId || 'default';
    console.log('[Proxy] Session ID:', sessionId);

    // Autenticação / escopo (empresa) para multi-tenant
    const supabaseUrl = getSupabaseUrl();
    const supabaseAnonKey = getSupabaseAnonKey();
    const authHeader = getHeaderValue(req, 'authorization');
    const accessToken = extractBearerToken(authHeader);

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[Proxy] ❌ Supabase não configurado (URL/Key ausentes)');
      return res.status(500).json({
        error: 'Configuration error',
        message: 'Serviço temporariamente indisponível. Tente novamente mais tarde.',
      });
    }

    if (!accessToken) {
      console.warn('[Proxy] ❌ Authorization Bearer token ausente');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Sessão expirada. Faça login novamente.',
      });
    }

    let userId: string | null = null;
    let empresaId: string | null = null;

    try {
      // 1) Validar token e obter user
      const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
        method: 'GET',
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!userResp.ok) {
        const txt = await userResp.text().catch(() => '');
        console.warn('[Proxy] Token inválido ao consultar /auth/v1/user:', userResp.status, txt.substring(0, 200));
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Sessão expirada. Faça login novamente.',
        });
      }

      const user = await userResp.json();
      userId = user?.id ?? null;
      if (!userId) {
        console.warn('[Proxy] Resposta de /auth/v1/user sem id');
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Sessão expirada. Faça login novamente.',
        });
      }

      // 2) Obter empresa_id do perfil (via RLS do próprio usuário)
      const profileUrl = `${supabaseUrl}/rest/v1/profiles?select=empresa_id&id=eq.${encodeURIComponent(userId)}&limit=1`;
      const profileResp = await fetch(profileUrl, {
        method: 'GET',
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      });

      if (!profileResp.ok) {
        const txt = await profileResp.text().catch(() => '');
        console.warn('[Proxy] Falha ao buscar profiles.empresa_id:', profileResp.status, txt.substring(0, 200));
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Não foi possível identificar a empresa do usuário.',
        });
      }

      const profiles = await profileResp.json().catch(() => []);
      empresaId = Array.isArray(profiles) ? profiles[0]?.empresa_id ?? null : profiles?.empresa_id ?? null;

      if (!empresaId) {
        console.warn('[Proxy] empresa_id não encontrado no perfil do usuário');
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Empresa não encontrada para o usuário.',
        });
      }
    } catch (authError: any) {
      console.error('[Proxy] Erro ao validar token/empresa:', {
        name: authError?.name,
        message: authError?.message,
        stack: authError?.stack?.substring(0, 300),
      });
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Erro ao validar sessão. Tente novamente.',
      });
    }

    const serviceRoleKey = getSupabaseServiceRoleKey();
    const historyData = userId && sessionId
      ? await loadConversationHistory(supabaseUrl, serviceRoleKey, userId, sessionId)
      : null;
    const history = historyData?.history ?? null;
    const historySummary = historyData?.historySummary ?? null;
    const messageCount = historyData?.messageCount ?? 0;

    // Verificar cache
    console.log('[Proxy] Verificando cache...');
    const cacheScope = `${empresaId || userId || ''}:${messageCount}`;
    const cacheKey = generateCacheKey(trimmedQuestion, sessionId, cacheScope);
    console.log('[Proxy] Cache key gerada:', cacheKey.substring(0, 50) + '...');
    try {
      const cached = await getCachedResponse(cacheKey);
      if (cached) {
        console.log('[Proxy] ✅ Cache hit, retornando resposta cacheada');
        logEvent('ai_copilot_cache_hit', {
          requestId,
          cacheKey: cacheKey.substring(0, 50),
          duration_ms: Date.now() - startedAt,
        });
        return res.status(200).json({
          ...cached,
          cached: true,
        });
      } else {
        console.log('[Proxy] Cache miss, continuando para n8n...');
        logEvent('ai_copilot_cache_miss', { requestId, cacheKey: cacheKey.substring(0, 50) });
      }
    } catch (error: any) {
      console.error('[Proxy] Erro ao ler cache (continuando sem cache):', {
        error: error?.message,
        stack: error?.stack?.substring(0, 300),
        name: error?.name
      });
      // Continuar sem cache se houver erro
    }

    // Obter URL do n8n
    console.log('[Proxy] Verificando variáveis de ambiente...');
    const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;
    const hasSupabaseUrl = !!(process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
    const hasSupabaseKey = !!(process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

    console.log('[Proxy] Configuração de ambiente:', {
      hasN8NWebhookUrl: !!n8nWebhookUrl,
      n8nWebhookUrlPreview: n8nWebhookUrl ? n8nWebhookUrl.substring(0, 50) + '...' : 'N/A',
      hasSupabaseUrl,
      hasSupabaseKey,
      supabaseAvailable: isSupabaseAvailable()
    });

    if (!n8nWebhookUrl) {
      console.error('[Proxy] ❌ N8N_WEBHOOK_URL não configurada nas variáveis de ambiente');
      return res.status(500).json({
        error: 'Configuration error',
        message: 'Serviço temporariamente indisponível. Tente novamente mais tarde.',
      });
    }

    console.log('[Proxy] Fazendo requisição para n8n:', {
      url: n8nWebhookUrl.substring(0, 50) + '...',
      questionLength: trimmedQuestion.length,
      conversationId: sessionId
    });

    try {
      const timeout = determineTimeout(trimmedQuestion);
      console.log('[Proxy] Timeout determinado:', timeout, 'ms');

      console.log('[Proxy] Chamando fetchWithRetry...');
      const response = await fetchWithRetry(
        n8nWebhookUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            question: trimmedQuestion,
            conversationId: sessionId,
            userId,
            empresaId,
            supabaseAccessToken: accessToken,
            history,
            historySummary,
            messageCount,
          }),
        },
        3
      );

      console.log('[Proxy] ✅ Resposta do n8n recebida:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries())
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Erro desconhecido');
        console.error(`[Proxy] ❌ n8n error: ${response.status} - ${errorText.substring(0, 500)}`);
        logEvent('ai_copilot_request_error', {
          requestId,
          duration_ms: Date.now() - startedAt,
          status: response.status,
          message: errorText.substring(0, 200),
        });
        return res.status(response.status >= 500 ? 502 : response.status).json({
          error: 'External service error',
          message: 'Erro ao processar sua pergunta. Tente novamente.',
          requestId,
          n8n_status: response.status,
        });
      }

      console.log('[Proxy] Fazendo parse da resposta JSON...');
      const data = await response.json().catch(async (parseError: any) => {
        console.error('[Proxy] ❌ Erro ao fazer parse da resposta do n8n:', {
          error: parseError?.message,
          stack: parseError?.stack?.substring(0, 300)
        });
        const text = await response.text().catch(() => 'Não foi possível ler o texto');
        console.error('[Proxy] Resposta do n8n (texto):', text.substring(0, 500));
        throw new Error('Resposta inválida do servidor');
      });

      console.log('[Proxy] ✅ Dados recebidos do n8n:', {
        hasAnswer: !!data.answer,
        hasResponse: !!data.response,
        dataKeys: Object.keys(data),
        dataPreview: JSON.stringify(data).substring(0, 200)
      });

      logEvent('ai_copilot_request_success', {
        requestId,
        cached: false,
        duration_ms: Date.now() - startedAt,
        status: response.status,
        hasAnswer: !!data.answer,
      });

      // Cachear resposta bem-sucedida (async, não bloqueia)
      const rowCount = Array.isArray(data?.data?.rows) ? data.data.rows.length : 0;
      const shouldCache = rowCount === 0 || rowCount <= 200;
      if (shouldCache) {
        console.log('[Proxy] Tentando cachear resposta...');
        setCachedResponse(cacheKey, data).catch((err: any) => {
          console.error('[Proxy] Erro ao cachear resposta (não crítico):', {
            error: err?.message,
            stack: err?.stack?.substring(0, 300)
          });
          // Não falhar a requisição se o cache falhar
        });
      } else {
        console.log('[Proxy] Cache ignorado por tamanho de resposta:', rowCount);
      }

      console.log('[Proxy] ========== Handler concluído com sucesso ==========');
      return res.status(200).json({
        ...data,
        cached: false,
      });
    } catch (error: any) {
      console.error('[Proxy] ❌ Erro ao processar requisição:', {
        name: error?.name,
        message: error?.message,
        stack: error?.stack?.substring(0, 500),
        cause: error?.cause
      });

      if (error.name === 'AbortError') {
        console.error('[Proxy] Timeout na requisição para n8n');
        const timeoutSeconds = Math.round(determineTimeout('') / 1000);
        logEvent('ai_copilot_request_timeout', {
          requestId,
          duration_ms: Date.now() - startedAt,
          timeout_seconds: timeoutSeconds,
        });
        return res.status(504).json({
          error: 'Timeout',
          message: `A consulta demorou mais de ${timeoutSeconds} segundos para processar. Tente uma pergunta mais específica com filtros adicionais (ex.: limitar datas ou apenas entradas/saídas). Para consultas complexas, considere usar os relatórios da plataforma.`,
        });
      }

      logEvent('ai_copilot_request_error', {
        requestId,
        duration_ms: Date.now() - startedAt,
        message: error?.message || 'unknown',
      });
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Erro ao processar sua pergunta. Tente novamente mais tarde.',
        requestId,
      });
    }
  } catch (error: any) {
    console.error('[Proxy] ❌❌❌ Erro fatal no handler:', {
      name: error?.name,
      message: error?.message,
      stack: error?.stack?.substring(0, 1000),
      cause: error?.cause,
      code: error?.code
    });
    console.error('[Proxy] ========== Handler falhou ==========');
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Erro inesperado ao processar sua requisição.',
      requestId,
    });
  }
}
