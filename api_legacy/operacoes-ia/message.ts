import { randomUUID } from 'node:crypto';
import {
  extractBearerToken,
  getAdminClient,
  getErrorMessage,
  getHeaderValue,
  getRuntimeBuildId,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  parseJsonBody,
  verifyTokenAndGetEmpresaId,
  type VercelRequest,
  type VercelResponse,
} from '../../src/server/bank-statement/_shared.js';

export type OperacoesIaMessageRequest = {
  message?: string;
  session_id?: string | null;
  context?: {
    import_file_id?: string | null;
    item_id?: string | null;
    batch_id?: string | null;
    program_hint?: string | null;
    reference_date?: string | null;
    operation_hint?: string | null;
    cnpj_hint?: string | null;
    session_import_ids?: string[];
  };
};

export type OperacoesIaMessageResponse = {
  ok: true;
  reply: string;
  suggested_actions?: unknown[];
  session_id: string;
  runtime_build_id?: string | null;
};

type NormalizedMessageContext = {
  import_file_id: string | null;
  item_id: string | null;
  batch_id: string | null;
  program_hint: 'SPPRO' | 'SOI' | null;
  reference_date: string | null;
  operation_hint: string | null;
  cnpj_hint: string | null;
  session_import_ids: string[];
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const trimOrNull = (value: unknown): string | null => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const normalizeProgramHint = (value: unknown): 'SPPRO' | 'SOI' | null => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'SPPRO' || normalized === 'SOI') return normalized;
  return null;
};

const normalizeReferenceDate = (value: unknown): string | null => {
  const normalized = trimOrNull(value);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  return normalized;
};

const normalizeSessionImportIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value) {
    const id = trimOrNull(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
};

const normalizeContext = (raw: OperacoesIaMessageRequest['context']): NormalizedMessageContext => ({
  import_file_id: trimOrNull(raw?.import_file_id),
  item_id: trimOrNull(raw?.item_id),
  batch_id: trimOrNull(raw?.batch_id),
  program_hint: normalizeProgramHint(raw?.program_hint),
  reference_date: normalizeReferenceDate(raw?.reference_date),
  operation_hint: trimOrNull(raw?.operation_hint),
  cnpj_hint: trimOrNull(raw?.cnpj_hint),
  session_import_ids: normalizeSessionImportIds(raw?.session_import_ids),
});

const getWebhookPublicTarget = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return 'n8n-webhook';
  }
};

const buildSessionTitle = (context: NormalizedMessageContext, firstMessage: string): string => {
  const parts: string[] = [];
  if (context.program_hint) parts.push(context.program_hint);
  if (context.reference_date) parts.push(context.reference_date);
  const tail = firstMessage.trim().slice(0, 48);
  if (tail) parts.push(tail);
  const title = parts.join(' · ') || 'Operações IA';
  return title.slice(0, 200);
};

const buildFallbackReply = (context: NormalizedMessageContext): string => {
  const replyParts = [
    'Entendi sua mensagem no contexto de Operações com IA.',
    'Use o workspace à esquerda para gerar o preview, ajustar fornecedor/estoque e confirmar o lote.',
    'Se um item estiver bloqueado por duplicidade, marque force_create com justificativa ou ignore o item com motivo.',
  ];
  if (context.item_id || context.import_file_id) {
    replyParts.push(`(Contexto lido preventivamente: item ${context.item_id || '—'})`);
  }
  return replyParts.join(' ');
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', message: 'Use POST.' });
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'Supabase não configurado.',
    });
  }

  const accessToken = extractBearerToken(getHeaderValue(req, 'authorization'));
  if (!accessToken) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Sessão expirada.' });
  }

  let body: OperacoesIaMessageRequest;
  try {
    body = (parseJsonBody(req) || {}) as OperacoesIaMessageRequest;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo inválido.' });
  }

  const text = String(body.message || '').trim();
  if (!text) {
    return res.status(400).json({ error: 'Invalid input', message: 'Informe uma mensagem.' });
  }

  const context = normalizeContext(body.context);
  const sessionIdInput = trimOrNull(body.session_id);

  let empresaId: string;
  let userId: string;
  try {
    const verified = await verifyTokenAndGetEmpresaId(supabaseUrl, supabaseAnonKey, accessToken);
    empresaId = verified.empresaId;
    userId = verified.userId;
  } catch (error) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: getErrorMessage(error, 'Não foi possível validar a sessão.'),
    });
  }

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);
  const runtimeBuildId = getRuntimeBuildId();

  let sessionId: string;

  if (sessionIdInput) {
    if (!UUID_RE.test(sessionIdInput)) {
      return res.status(400).json({ error: 'Invalid input', message: 'session_id inválido.' });
    }
    const { data: existing, error: loadErr } = await adminClient
      .from('operacoes_ia_chat_sessions')
      .select('id')
      .eq('id', sessionIdInput)
      .eq('empresa_id', empresaId)
      .eq('user_id', userId)
      .is('archived_at', null)
      .maybeSingle();

    if (loadErr) {
      return res.status(500).json({
        error: 'Internal server error',
        message: `Falha ao validar sessão: ${loadErr.message}`,
      });
    }
    if (!existing) {
      return res.status(404).json({ error: 'Not found', message: 'Sessão não encontrada.' });
    }
    sessionId = sessionIdInput;
  } else {
    const sessionKey = randomUUID();
    const title = buildSessionTitle(context, text);
    const { data: created, error: insertErr } = await adminClient
      .from('operacoes_ia_chat_sessions')
      .insert({
        empresa_id: empresaId,
        user_id: userId,
        session_key: sessionKey,
        reference_date: context.reference_date,
        program_hint: context.program_hint,
        operation_hint: context.operation_hint,
        cnpj_hint: context.cnpj_hint,
        title,
        last_message_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('[OperacoesIA Chat] Falha ao criar sessão', insertErr);
      return res.status(500).json({
        error: 'Internal server error',
        message: `Falha ao criar sessão de chat: ${insertErr.message}`,
      });
    }
    sessionId = created.id;
  }

  const contextForRow = {
    import_file_id: context.import_file_id,
    item_id: context.item_id,
    batch_id: context.batch_id,
    program_hint: context.program_hint,
    reference_date: context.reference_date,
    operation_hint: context.operation_hint,
    cnpj_hint: context.cnpj_hint,
    session_import_ids: context.session_import_ids,
  };

  const hintsPatch = {
    reference_date: context.reference_date,
    program_hint: context.program_hint,
    operation_hint: context.operation_hint,
    cnpj_hint: context.cnpj_hint,
    updated_at: new Date().toISOString(),
    last_message_at: new Date().toISOString(),
  };

  const { error: userMsgErr } = await adminClient.from('operacoes_ia_chat_messages').insert({
    session_id: sessionId,
    empresa_id: empresaId,
    role: 'user',
    content: text,
    context: contextForRow,
    metadata: {},
  });

  if (userMsgErr) {
    console.error('[OperacoesIA Chat] Falha ao gravar mensagem do usuário', userMsgErr);
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao gravar mensagem: ${userMsgErr.message}`,
    });
  }

  await adminClient.from('operacoes_ia_chat_sessions').update(hintsPatch).eq('id', sessionId);

  const webhookUrl = process.env.N8N_OPERACOES_IA_WEBHOOK_URL;
  const webhookSecret = process.env.N8N_OPERACOES_IA_INTEGRATION_SECRET;
  const webhookTarget = webhookUrl ? getWebhookPublicTarget(webhookUrl) : 'n8n-webhook';

  let reply: string;
  let suggested_actions: unknown[] = [];

  if (!webhookUrl || !webhookSecret) {
    reply = buildFallbackReply(context);
  } else {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 28000);

      const n8nResp = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-integration-secret': webhookSecret,
        },
        signal: controller.signal,
        body: JSON.stringify({
          empresa_id: empresaId,
          user_id: userId,
          message: text,
          context,
          contexto_linha: context,
          batch_id: context.batch_id,
          import_file_id: context.import_file_id,
          item_id: context.item_id,
          program_hint: context.program_hint,
          reference_date: context.reference_date,
          session_id: sessionId,
        }),
      });

      clearTimeout(timeoutId);

      if (!n8nResp.ok) {
        console.error('[OperacoesIA Chat] Erro HTTP retornado pelo n8n', {
          type: 'http',
          status: n8nResp.status,
          target: webhookTarget,
        });
        reply = `O assistente não respondeu corretamente (HTTP ${n8nResp.status}). Tente novamente em instantes.`;
      } else {
        const n8nData = (await n8nResp.json()) as { reply?: string; output?: string; suggested_actions?: unknown[] };
        reply = n8nData.reply || n8nData.output || 'Não consegui formular uma resposta.';
        suggested_actions = Array.isArray(n8nData.suggested_actions) ? n8nData.suggested_actions : [];
      }
    } catch (error: unknown) {
      const err = error as { name?: string; message?: string };
      if (err?.name === 'AbortError') {
        console.error('[OperacoesIA Chat] Timeout na request ao n8n', {
          type: 'timeout',
          target: webhookTarget,
        });
        reply = 'O assistente de IA demorou muito para responder. A mensagem foi registrada; tente de novo com uma pergunta mais curta.';
      } else {
        console.error('[OperacoesIA Chat] Erro de rede ao consultar n8n', {
          type: 'network',
          target: webhookTarget,
          reason: String(err?.message || 'fetch failed'),
        });
        reply = 'Falha de comunicação com o assistente. Tente novamente em instantes.';
      }
    }
  }

  const { error: asstErr } = await adminClient.from('operacoes_ia_chat_messages').insert({
    session_id: sessionId,
    empresa_id: empresaId,
    role: 'assistant',
    content: reply,
    context: {},
    metadata: { suggested_actions },
  });

  if (asstErr) {
    console.error('[OperacoesIA Chat] Falha ao gravar resposta do assistente', asstErr);
  }

  await adminClient
    .from('operacoes_ia_chat_sessions')
    .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', sessionId);

  const payload: OperacoesIaMessageResponse = {
    ok: true,
    reply,
    suggested_actions,
    session_id: sessionId,
    runtime_build_id: runtimeBuildId,
  };

  return res.status(200).json(payload);
}
