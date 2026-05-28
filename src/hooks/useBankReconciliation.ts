import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserEmpresa } from './useUserEmpresa';
import { useToast } from './use-toast';
import {
  buildOfxUploadContentTypeRetrySequence,
  isRetryableStorageUploadStatus,
  parseStorageUploadErrorDetails,
} from '@/lib/bank-reconciliation/ofxMime';
import { isValidUUID } from '@/lib/uuid';
import type {
  AiSuggestionCreatePayload,
  CreateReconciliationRuleRequest,
  DailyCloseRequest,
  DailyClosingRow,
  DailyReopenRequest,
  DailyReconciliationSummary,
  ExtratoTransacaoRow,
  IgnoreExtratoRequest,
  LinkExistingReconciliationRequest,
  ReconciliationRuleRow,
} from '../types/bank-reconciliation';

interface ApiResponseBase {
  ok?: boolean;
  message?: string;
  error?: string;
  parse_status?: string;
  parse_error_message?: string | null;
  import_id?: string;
}

class BankApiError extends Error {
  status: number;
  payload: ApiResponseBase | null;

  constructor(message: string, status: number, payload: ApiResponseBase | null) {
    super(message);
    this.name = 'BankApiError';
    this.status = status;
    this.payload = payload;
  }
}

interface ConciliacaoRow {
  id: string;
  status: 'suggested' | 'confirmed' | 'rejected';
  method: 'manual' | 'deterministic' | 'rule' | 'ai';
  explanation: string | null;
  valor_alocado_centavos: number;
  lancamento?: {
    id: string;
    data: string;
    valor: number;
    historico: string | null;
    documento: string | null;
  } | null;
}

export interface BankTransactionWithConciliation extends ExtratoTransacaoRow {
  conciliacoes: ConciliacaoRow[];
  view_status: 'pendente' | 'sugerido' | 'conciliado' | 'divergente';
}

export interface BankAiSuggestionWithTransaction extends AiSuggestionCreatePayload {
  id: string;
  status: 'suggested' | 'approved' | 'rejected' | 'applied';
  extrato_transacoes?: ExtratoTransacaoRow;
  proposed_lancamento?: Record<string, unknown> | null;
}

interface UploadImportResponse extends ApiResponseBase {
  duplicate?: boolean;
  import_row?: {
    id: string;
    conta_bancaria_id: string;
    parse_status: string;
  };
  parse_result?: {
    ok: boolean;
    parse_status: string;
    errors: string[];
    warnings: string[];
  };
}

interface DailySummaryResponse extends ApiResponseBase {
  data?: {
    summary: DailyReconciliationSummary;
    fechamento: Record<string, unknown> | null;
  };
}

const BANK_LOCAL_PROXY_HINT =
  'Possivel falha de proxy local. Verifique a API em http://localhost:3100 e execute `npm run dev:chat-local`.';

const summarizeHttpBody = (rawBody: string): string => {
  const normalized = String(rawBody || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized;
};

const parseApiResponsePayload = (rawBody: string, contentType: string): ApiResponseBase | null => {
  if (!rawBody) return null;
  const looksJson =
    contentType.includes('application/json') || rawBody.trim().startsWith('{') || rawBody.trim().startsWith('[');
  if (!looksJson) return null;
  try {
    const parsed = JSON.parse(rawBody);
    return parsed && typeof parsed === 'object' ? (parsed as ApiResponseBase) : null;
  } catch {
    return null;
  }
};

const isLikelyProxyInfraFailure = (status: number, contentType: string, rawBody: string): boolean =>
  status === 500 && !contentType.includes('application/json') && !String(rawBody || '').trim();

const QUERY_KEYS = {
  importFiles: (empresaId: string) => ['bank-import-files', empresaId],
  transactions: (empresaId: string, importId?: string, contaId?: string) => ['bank-transactions', empresaId, importId, contaId],
  aiSuggestions: (empresaId: string) => ['bank-ai-suggestions', empresaId],
  contas: (empresaId: string) => ['bank-contas', empresaId],
  gruposContas: (empresaId: string) => ['bank-grupos-contas', empresaId],
  rules: (empresaId: string) => ['bank-rules', empresaId],
  dailyClosings: (empresaId: string) => ['bank-daily-closings', empresaId],
};

const sanitizeFileName = (fileName: string): string =>
  String(fileName || 'extrato.ofx')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+/, '') || `extrato-${Date.now()}.ofx`;

async function getAccessTokenOrThrow(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('Sessao expirada. Faca login novamente.');
  }
  return token;
}

async function callBankApi<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
  } = {}
): Promise<T> {
  const token = await getAccessTokenOrThrow();
  const method = options.method || 'POST';

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await fetch(path, { method, headers, body });
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const rawBody = await response.text().catch(() => '');
  const payload = parseApiResponsePayload(rawBody, contentType);
  const bodyPreview = summarizeHttpBody(rawBody);

  if (import.meta.env.DEV && (response.status === 401 || response.status === 403)) {
    console.warn('[bank-api][auth]', {
      path,
      method,
      status: response.status,
      hint: 'Sessao/token invalido ou expirado.',
    });
  }

  if (!response.ok) {
    if (isLikelyProxyInfraFailure(response.status, contentType, rawBody)) {
      console.error('[bank-api][proxy-500]', {
        path,
        method,
        status: response.status,
        contentType: contentType || '(ausente)',
        body: '(vazio)',
        hint: BANK_LOCAL_PROXY_HINT,
      });
      throw new BankApiError(
        `Falha de conectividade local ao chamar ${path}. ${BANK_LOCAL_PROXY_HINT}`,
        response.status,
        payload
      );
    }

    if (response.status >= 500) {
      console.error('[bank-api][handler-500]', {
        path,
        method,
        status: response.status,
        contentType: contentType || '(ausente)',
        body: bodyPreview || '(vazio)',
      });
    }

    const details =
      payload?.parse_status || payload?.import_id
        ? ` [import_id=${payload?.import_id || '-'} parse_status=${payload?.parse_status || '-'}${
            payload?.parse_error_message ? ` parse_error=${payload.parse_error_message}` : ''
          }]`
        : '';
    const fallbackError = bodyPreview || 'Erro ao chamar API de conciliacao bancaria.';
    const message = `${payload?.message || payload?.error || fallbackError}${details}`;
    throw new BankApiError(message, response.status, payload);
  }

  return (payload || {}) as T;
}

export function useBankReconciliation(importId?: string, contaId?: string) {
  const { empresaId } = useUserEmpresa();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const importsQuery = useQuery({
    queryKey: QUERY_KEYS.importFiles(empresaId || ''),
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from('extratos_import')
        .select('*')
        .eq('empresa_id', empresaId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const dailyClosingsQuery = useQuery({
    queryKey: QUERY_KEYS.dailyClosings(empresaId || ''),
    queryFn: async (): Promise<DailyClosingRow[]> => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from('conciliacao_fechamentos_diarios')
        .select('id, empresa_id, conta_bancaria_id, data_referencia, status, created_at, updated_at')
        .eq('empresa_id', empresaId)
        .order('data_referencia', { ascending: false });
      if (error) throw error;
      return (data || []) as DailyClosingRow[];
    },
    enabled: !!empresaId,
  });

  const transactionsQuery = useQuery({
    queryKey: QUERY_KEYS.transactions(empresaId || '', importId, contaId),
    queryFn: async () => {
      if (!empresaId) return [];

      let query = supabase
        .from('extrato_transacoes')
        .select(`
          *,
          conciliacao:conciliacoes_bancarias!left(
            id, status, method, explanation, valor_alocado_centavos,
            lancamento:lancamento_caixa_id(id, data, valor, historico, documento)
          )
        `)
        .eq('empresa_id', empresaId)
        .order('data_movimento', { ascending: false });

      if (importId) query = query.eq('extrato_import_id', importId);
      if (contaId) query = query.eq('conta_bancaria_id', contaId);

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map((tx) => {
        const conciliacaoRaw = tx.conciliacao;
        const conciliacoes: ConciliacaoRow[] = conciliacaoRaw
          ? (Array.isArray(conciliacaoRaw) ? conciliacaoRaw : [conciliacaoRaw])
          : [];

        const merged: BankTransactionWithConciliation = {
          ...(tx as ExtratoTransacaoRow),
          conciliacoes,
          view_status: getTxStatus(conciliacoes),
        };

        return merged;
      });
    },
    enabled: !!empresaId,
    staleTime: 1000 * 60,
  });

  const contasQuery = useQuery({
    queryKey: QUERY_KEYS.contas(empresaId || ''),
    queryFn: async () => {
      if (!empresaId) return [];
      const base = supabase
        .from('contas_bancarias')
        .select('id, descricao')
        .eq('empresa_id', empresaId);

      const { data: activeData, error: activeError } = await base.eq('status', true);
      if (!activeError) {
        return activeData || [];
      }

      const { data: fallbackData, error: fallbackError } = await supabase
        .from('contas_bancarias')
        .select('id, descricao')
        .eq('empresa_id', empresaId);

      if (fallbackError) throw fallbackError;
      return fallbackData || [];
    },
    enabled: !!empresaId,
  });

  const gruposContasQuery = useQuery({
    queryKey: QUERY_KEYS.gruposContas(empresaId || ''),
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from('grupos_contas')
        .select('id, nome, natureza')
        .eq('empresa_id', empresaId);
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const aiSuggestionsQuery = useQuery({
    queryKey: QUERY_KEYS.aiSuggestions(empresaId || ''),
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from('bank_ai_suggestions')
        .select('*, extrato_transacoes!inner(*)')
        .eq('empresa_id', empresaId)
        .eq('status', 'suggested')
        .order('confidence', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  const rulesQuery = useQuery({
    queryKey: QUERY_KEYS.rules(empresaId || ''),
    queryFn: async () => {
      if (!empresaId) return [];
      const response = await callBankApi<{ ok: boolean; data: ReconciliationRuleRow[] }>(
        '/api/bank-statement/rules',
        { method: 'GET' }
      );
      return response.data || [];
    },
    enabled: !!empresaId,
  });

  const uploadImportMutation = useMutation({
    mutationFn: async ({
      file,
      conta_bancaria_id,
      source,
      file_format,
    }: {
      file: File;
      conta_bancaria_id: string;
      source: string;
      file_format: string;
    }) => {
      if (!empresaId) {
        throw new Error('Empresa nao identificada para upload.');
      }
      if (!isValidUUID(empresaId) || !isValidUUID(conta_bancaria_id)) {
        throw new Error('Contexto inválido para upload (empresa/conta). Recarregue a tela e tente novamente.');
      }

      const safeName = sanitizeFileName(file.name);
      const storageKey = `${empresaId}/${conta_bancaria_id}/${Date.now()}-${safeName}`;
      const contentTypeCandidates = buildOfxUploadContentTypeRetrySequence(file.name, file.type);
      let uploadSucceeded = false;
      let lastErrorMessage = 'Falha no upload do arquivo OFX.';
      let lastStatus: number | null = null;

      for (let attempt = 0; attempt < contentTypeCandidates.length; attempt += 1) {
        const contentType = contentTypeCandidates[attempt];
        const { error: uploadError } = await supabase.storage
          .from('extratos-bancarios')
          .upload(storageKey, file, {
            upsert: false,
            contentType,
          });

        if (!uploadError) {
          uploadSucceeded = true;
          break;
        }

        const details = parseStorageUploadErrorDetails(uploadError);
        lastErrorMessage = details.message;
        lastStatus = details.status;
        const canRetry = isRetryableStorageUploadStatus(details.status);
        if (!canRetry || attempt === contentTypeCandidates.length - 1) {
          break;
        }
      }

      if (!uploadSucceeded) {
        throw new Error(
          `Falha no upload OFX ao storage${lastStatus ? ` (${lastStatus})` : ''}: ${lastErrorMessage}`
        );
      }

      return await callBankApi<UploadImportResponse>('/api/bank-statement/import', {
        method: 'POST',
        body: {
          conta_bancaria_id,
          source,
          file_format,
          file_storage_bucket: 'extratos-bancarios',
          file_storage_key: storageKey,
          original_filename: file.name,
        },
      });
    },
    onSuccess: (result) => {
      if (result.duplicate) {
        toast({
          title: 'Arquivo duplicado detectado',
          description: 'A importacao anterior foi reaproveitada para evitar duplicidade.',
        });
      } else if (result.parse_result?.ok === false) {
        toast({
          title: 'Importacao concluida com erro de parse',
          description: result.parse_result.errors?.[0] || 'Verifique os detalhes da importacao.',
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Upload concluído e OFX processado' });
      }

      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.importFiles(empresaId || '') });
      queryClient.invalidateQueries({ queryKey: ['bank-transactions', empresaId || ''] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro no upload';
      toast({ title: 'Erro no upload', description: message, variant: 'destructive' });
    },
  });

  const matchImportMutation = useMutation({
    mutationFn: async ({ import_id, auto_confirm }: { import_id: string; auto_confirm: boolean }) => {
      return await callBankApi('/api/bank-statement/match', {
        method: 'POST',
        body: { import_id, auto_confirm },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions', empresaId || ''] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.aiSuggestions(empresaId || '') });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro no matching';
      toast({ title: 'Erro no matching', description: message, variant: 'destructive' });
    },
  });

  const reprocessImportMutation = useMutation({
    mutationFn: async (import_id: string) => {
      return await callBankApi('/api/bank-statement/reprocess', {
        method: 'POST',
        body: { import_id },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.importFiles(empresaId || '') });
      queryClient.invalidateQueries({ queryKey: ['bank-transactions', empresaId || ''] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro ao reprocessar';
      toast({ title: 'Erro ao reprocessar', description: message, variant: 'destructive' });
    },
  });

  const triggerAiWorkflowMutation = useMutation({
    mutationFn: async (importIdToTrigger: string) => {
      return await callBankApi('/api/bank-statement/ai/trigger', {
        method: 'POST',
        body: { extrato_import_id: importIdToTrigger },
      });
    },
    onSuccess: () => toast({ title: 'IA acionada com sucesso' }),
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro IA';
      toast({ title: 'Erro IA', description: message, variant: 'destructive' });
    },
  });

  const reviewAiSuggestionMutation = useMutation({
    mutationFn: async (payload: { suggestion_id: string; status: 'approved' | 'rejected' | 'applied'; explanation?: string }) => {
      return await callBankApi('/api/bank-statement/ai/review', {
        method: 'POST',
        body: payload,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.aiSuggestions(empresaId || '') });
      queryClient.invalidateQueries({ queryKey: ['bank-transactions', empresaId || ''] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro revisao';
      toast({ title: 'Erro revisao', description: message, variant: 'destructive' });
    },
  });

  const createAndReconcileMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      return await callBankApi('/api/bank-statement/reconcile/create', {
        method: 'POST',
        body: payload,
      });
    },
    onSuccess: () => {
      toast({ title: 'Sucesso', description: 'Transacao conciliada.' });
      queryClient.invalidateQueries({ queryKey: ['bank-transactions', empresaId || ''] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.aiSuggestions(empresaId || '') });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro conciliacao';
      toast({ title: 'Erro conciliacao', description: message, variant: 'destructive' });
    },
  });

  const confirmConciliationMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      return await callBankApi('/api/bank-statement/reconcile/confirm', {
        method: 'POST',
        body: payload,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions', empresaId || ''] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.aiSuggestions(empresaId || '') });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro confirmacao';
      toast({ title: 'Erro confirmacao', description: message, variant: 'destructive' });
    },
  });

  const rejectConciliationMutation = useMutation({
    mutationFn: async (payload: { conciliacao_id: string; explanation: string }) => {
      return await callBankApi('/api/bank-statement/reconcile/reject', {
        method: 'POST',
        body: payload,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions', empresaId || ''] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.aiSuggestions(empresaId || '') });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro rejeicao';
      toast({ title: 'Erro rejeicao', description: message, variant: 'destructive' });
    },
  });

  const splitAndReconcileMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      return await callBankApi('/api/bank-statement/reconcile/split', {
        method: 'POST',
        body: payload,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions', empresaId || ''] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.aiSuggestions(empresaId || '') });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro split';
      toast({ title: 'Erro split', description: message, variant: 'destructive' });
    },
  });

  const createRuleMutation = useMutation({
    mutationFn: async (rule: CreateReconciliationRuleRequest) => {
      return await callBankApi('/api/bank-statement/rules', {
        method: 'POST',
        body: rule,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.rules(empresaId || '') }),
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro ao criar regra';
      toast({ title: 'Erro ao criar regra', description: message, variant: 'destructive' });
    },
  });

  const updateRuleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ReconciliationRuleRow> }) => {
      return await callBankApi(`/api/bank-statement/rules?id=${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { id, ...data },
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.rules(empresaId || '') }),
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro ao atualizar regra';
      toast({ title: 'Erro ao atualizar regra', description: message, variant: 'destructive' });
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: string) => {
      return await callBankApi(`/api/bank-statement/rules?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: { id },
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.rules(empresaId || '') }),
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro ao remover regra';
      toast({ title: 'Erro ao remover regra', description: message, variant: 'destructive' });
    },
  });

  const dailySummaryMutation = useMutation({
    mutationFn: async ({
      conta_bancaria_id,
      data_referencia,
    }: {
      conta_bancaria_id: string;
      data_referencia: string;
    }) => {
      const query = new URLSearchParams({
        conta_bancaria_id,
        data_referencia,
      }).toString();
      return await callBankApi<DailySummaryResponse>(`/api/bank-statement/daily/summary?${query}`, {
        method: 'GET',
      });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro ao carregar resumo diario';
      toast({ title: 'Erro resumo diario', description: message, variant: 'destructive' });
    },
  });

  const dailyCloseMutation = useMutation({
    mutationFn: async (payload: DailyCloseRequest) => {
      return await callBankApi('/api/bank-statement/daily/close', {
        method: 'POST',
        body: payload,
      });
    },
    onSuccess: () => {
      toast({ title: 'Fechamento diario concluido' });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.importFiles(empresaId || '') });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailyClosings(empresaId || '') });
      queryClient.invalidateQueries({ queryKey: ['bank-transactions', empresaId || ''] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.aiSuggestions(empresaId || '') });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro ao fechar o dia';
      toast({ title: 'Erro fechamento diario', description: message, variant: 'destructive' });
    },
  });

  const dailyReopenMutation = useMutation({
    mutationFn: async (payload: DailyReopenRequest) => {
      return await callBankApi('/api/bank-statement/daily/reopen', {
        method: 'POST',
        body: payload,
      });
    },
    onSuccess: () => {
      toast({ title: 'Fechamento diario reaberto' });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.importFiles(empresaId || '') });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailyClosings(empresaId || '') });
      queryClient.invalidateQueries({ queryKey: ['bank-transactions', empresaId || ''] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.aiSuggestions(empresaId || '') });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro ao reabrir o dia';
      toast({ title: 'Erro reabrir diario', description: message, variant: 'destructive' });
    },
  });

  const linkExistingMutation = useMutation({
    mutationFn: async (payload: LinkExistingReconciliationRequest) => {
      return await callBankApi('/api/bank-statement/reconcile/link-existing', {
        method: 'POST',
        body: payload,
      });
    },
    onSuccess: () => {
      toast({ title: 'Item vinculado e conciliado' });
      queryClient.invalidateQueries({ queryKey: ['bank-transactions', empresaId || ''] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.aiSuggestions(empresaId || '') });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro ao vincular item existente';
      toast({ title: 'Erro vincular item', description: message, variant: 'destructive' });
    },
  });

  const ignoreExtratoMutation = useMutation({
    mutationFn: async (payload: IgnoreExtratoRequest) => {
      return await callBankApi('/api/bank-statement/reconcile/ignore', {
        method: 'POST',
        body: payload,
      });
    },
    onSuccess: () => {
      toast({ title: 'Transacao marcada como ignorada com justificativa' });
      queryClient.invalidateQueries({ queryKey: ['bank-transactions', empresaId || ''] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.aiSuggestions(empresaId || '') });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro ao ignorar transacao de extrato';
      toast({ title: 'Erro ignorar extrato', description: message, variant: 'destructive' });
    },
  });

  const statusCounts = useMemo(() => {
    const txs = (transactionsQuery.data || []) as BankTransactionWithConciliation[];
    return {
      pendente: txs.filter((t) => t.view_status === 'pendente').length,
      sugerido: txs.filter((t) => t.view_status === 'sugerido').length,
      conciliado: txs.filter((t) => t.view_status === 'conciliado').length,
      divergente: txs.filter((t) => t.view_status === 'divergente').length,
    };
  }, [transactionsQuery.data]);

  return {
    empresaId,
    importsQuery,
    dailyClosingsQuery,
    transactionsQuery,
    contasQuery,
    gruposContasQuery,
    aiSuggestionsQuery,
    rulesQuery,
    uploadImportMutation,
    matchImportMutation,
    reprocessImportMutation,
    triggerAiWorkflowMutation,
    reviewAiSuggestionMutation,
    createAndReconcileMutation,
    confirmConciliationMutation,
    rejectConciliationMutation,
    splitAndReconcileMutation,
    createRuleMutation,
    updateRuleMutation,
    deleteRuleMutation,
    dailySummaryMutation,
    dailyCloseMutation,
    dailyReopenMutation,
    linkExistingMutation,
    ignoreExtratoMutation,
    statusCounts,
  };
}

function getTxStatus(
  conciliacoes: ConciliacaoRow[]
): 'pendente' | 'sugerido' | 'conciliado' | 'divergente' {
  if (conciliacoes.some((c) => c.status === 'confirmed')) return 'conciliado';
  if (conciliacoes.some((c) => c.status === 'suggested')) return 'sugerido';
  if (conciliacoes.some((c) => c.status === 'rejected')) return 'divergente';
  return 'pendente';
}
