import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useEmpresaId } from '@/hooks/useEstoque';
import type {
  DisecuritImportWebhookResponse,
  DisecuritProgram,
  ImportParseStatus,
  OperationImportDocument,
  OperationImportFile,
  OperationImportHints,
} from '@/types/disecurit-import';
import { isImportPayloadReady } from '@/lib/disecurit/disecuritAdapters';

const DISECURIT_SOURCE = 'disecurit';
const DISECURIT_BUCKET = 'operacoes-disecurit-pdf';

export const normalizeCnpjValue = (value?: string | null): string => {
  if (!value) return '';
  return value.replace(/\D/g, '');
};

const sanitizeFilename = (filename: string): string => {
  return filename
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_');
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const cleaned = value.replace(/\s/g, '');
  if (!cleaned) return null;

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  if (hasComma && hasDot) {
    const normalized = cleaned.replace(/\./g, '').replace(',', '.');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (hasComma) {
    const parsed = Number.parseFloat(cleaned.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const toDateOnly = (value?: string | null): string | null => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    const [day, month, year] = value.split('/');
    return `${year}-${month}-${day}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().split('T')[0];
};

const buildStorageKey = (empresaId: string, originalName: string): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const timestamp = Date.now();
  const safeName = sanitizeFilename(originalName || `import-${timestamp}.pdf`);
  return `${empresaId}/${year}/${month}/${timestamp}-${safeName}`;
};

const getAccessToken = async (): Promise<string> => {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  return session.access_token;
};

const buildDisecuritApiErrorMessage = async (
  response: Response,
  endpoint: '/api/disecurit-import' | '/api/disecurit-reprocess',
  fallbackMessage: string
): Promise<string> => {
  const vercelRequestId = response.headers.get('x-vercel-id');
  const contentType = response.headers.get('content-type') || '';

  let payloadMessage: string | null = null;

  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null);
    payloadMessage =
      typeof payload?.message === 'string'
        ? payload.message
        : typeof payload?.error === 'string'
          ? payload.error
          : null;
  } else {
    const rawText = await response.text().catch(() => '');
    if (rawText) {
      payloadMessage = rawText.slice(0, 300);
    }
  }

  // Log curto para suporte sem expor dados sensíveis.
  console.warn('[DISECURIT] API request failed', {
    endpoint,
    status: response.status,
    requestId: vercelRequestId || null,
  });

  if (response.status === 401 || response.status === 403) {
    return payloadMessage || 'Sessão expirada ou sem permissão. Faça login novamente.';
  }

  if (response.status === 404) {
    return `Endpoint DISECURIT indisponível (HTTP 404). Verifique o deploy das rotas ${endpoint} e /api/disecurit-parse.`;
  }

  if (response.status >= 500) {
    return payloadMessage || `Serviço DISECURIT indisponível no momento (HTTP ${response.status}).`;
  }

  return payloadMessage || `${fallbackMessage} (HTTP ${response.status})`;
};

const toDocumentRows = (
  empresaId: string,
  importFileId: string,
  operacaoEstoqueId: number,
  documents: OperationImportDocument[]
) => {
  return documents.map((doc, index) => ({
    empresa_id: empresaId,
    operacao_estoque_id: operacaoEstoqueId,
    import_file_id: importFileId,
    line_index: index,
    sacado_nome: doc.sacado_nome?.trim() || null,
    sacado_cnpj: doc.sacado_cnpj?.trim() || null,
    documento: doc.documento?.trim() || null,
    vencimento: toDateOnly(doc.vencimento || null),
    flt: toNumber(doc.flt),
    prz_flt: toNumber(doc.prz_flt),
    valor: toNumber(doc.valor),
    desagio: toNumber(doc.desagio),
    liquido: toNumber(doc.liquido),
    prz: toNumber(doc.prz),
    carteira: doc.carteira === null || doc.carteira === undefined ? null : String(doc.carteira),
    tipo_doc: doc.tipo_doc?.trim() || null,
  }));
};

export interface UseDisecuritImportOptions {
  includeLinked?: boolean;
  statuses?: ImportParseStatus[];
  enabled?: boolean;
}

export interface UploadDisecuritImportInput {
  file: File;
  hints?: OperationImportHints;
  source?: string;
}

export interface ReprocessDisecuritImportInput {
  importFileId: string;
  reason?: string;
  programHint?: DisecuritProgram;
}

export interface LinkDisecuritImportPayload {
  importFileId: string;
  operacaoEstoqueId: number;
  documents?: OperationImportDocument[];
}

export function useDisecuritImport(options: UseDisecuritImportOptions = {}) {
  const queryClient = useQueryClient();
  const { data: empresaId } = useEmpresaId();

  const includeLinked = options.includeLinked ?? true;
  const statusesKey = useMemo(
    () => (options.statuses && options.statuses.length ? [...options.statuses].sort().join('|') : 'all'),
    [options.statuses]
  );

  const importsQuery = useQuery({
    queryKey: ['disecurit-import-files', empresaId, includeLinked, statusesKey],
    queryFn: async () => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      let query = supabase
        .from('operation_import_files')
        .select('*')
        .eq('empresa_id', empresaId)
        .eq('source', DISECURIT_SOURCE)
        .order('created_at', { ascending: false });

      if (!includeLinked) {
        query = query.is('linked_operacao_id', null);
      }

      if (options.statuses && options.statuses.length > 0) {
        query = query.in('parse_status', options.statuses);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Erro ao buscar imports DISECURIT: ${error.message}`);
      }

      return ((data || []) as OperationImportFile[]).map((item) => ({
        ...item,
        payload_ready: isImportPayloadReady(item),
      }));
    },
    enabled: (options.enabled ?? true) && !!empresaId,
    retry: false,
  });

  const uploadImportMutation = useMutation({
    mutationFn: async (input: UploadDisecuritImportInput) => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      const source = input.source || DISECURIT_SOURCE;
      if (source !== DISECURIT_SOURCE) {
        throw new Error('Source inválido para importação DISECURIT.');
      }

      const programHint = input.hints?.program_hint;
      if (programHint !== 'SPPRO' && programHint !== 'SOI') {
        throw new Error('Programa do PDF obrigatório. Selecione SPPRO ou SOI antes de enviar.');
      }

      if (!input.file) {
        throw new Error('Arquivo PDF é obrigatório.');
      }

      if (input.file.type !== 'application/pdf' && !input.file.name.toLowerCase().endsWith('.pdf')) {
        throw new Error('Selecione um arquivo PDF válido.');
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user?.id) {
        throw new Error('Usuário não autenticado.');
      }

      const storageKey = buildStorageKey(empresaId, input.file.name);

      const { error: uploadError } = await supabase.storage
        .from(DISECURIT_BUCKET)
        .upload(storageKey, input.file, {
          contentType: 'application/pdf',
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`Erro ao enviar PDF para storage: ${uploadError.message}`);
      }

      const { data: importRow, error: insertError } = await supabase
        .from('operation_import_files')
        .insert({
          empresa_id: empresaId,
          source,
          program_hint: programHint,
          file_storage_bucket: DISECURIT_BUCKET,
          file_storage_key: storageKey,
          original_filename: input.file.name,
          parse_status: 'received',
          created_by: session.user.id,
        })
        .select('*')
        .single();

      if (insertError || !importRow) {
        await supabase.storage.from(DISECURIT_BUCKET).remove([storageKey]).catch(() => null);
        throw new Error(`Erro ao registrar importação: ${insertError?.message || 'Erro desconhecido'}`);
      }

      const { error: processingError } = await supabase
        .from('operation_import_files')
        .update({ parse_status: 'processing', program_hint: programHint })
        .eq('id', importRow.id)
        .eq('empresa_id', empresaId);

      if (processingError) {
        throw new Error(`Erro ao atualizar status de processamento: ${processingError.message}`);
      }

      const accessToken = await getAccessToken();
      const response = await fetch('/api/disecurit-import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          import_file_id: importRow.id,
          storage_bucket: DISECURIT_BUCKET,
          storage_key: storageKey,
          source,
          program_hint: programHint,
          hints: input.hints || {},
        }),
      });

      if (!response.ok) {
        const errorMessage = await buildDisecuritApiErrorMessage(
          response,
          '/api/disecurit-import',
          'Falha ao iniciar parsing'
        );

        await supabase
          .from('operation_import_files')
          .update({
            parse_status: 'failed',
            error_message: String(errorMessage).slice(0, 1000),
          })
          .eq('id', importRow.id)
          .eq('empresa_id', empresaId);

        throw new Error(String(errorMessage));
      }

      const webhookPayload = (await response
        .json()
        .catch(() => null)) as DisecuritImportWebhookResponse | null;

      return {
        importRow: importRow as OperationImportFile,
        webhookPayload,
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['disecurit-import-files'] });
      const status = String(result?.webhookPayload?.status || '').toLowerCase();
      const reason = result?.webhookPayload?.reason ? String(result.webhookPayload.reason) : null;

      if (status === 'failed') {
        toast.error(reason || 'PDF enviado, mas o parsing DISECURIT falhou.');
        return;
      }

      if (status === 'duplicate') {
        const existingImportId = result?.webhookPayload?.existing_import_file_id || null;
        const linkedOperacaoId = result?.webhookPayload?.existing_linked_operacao_id || null;
        const duplicateReason =
          reason ||
          (existingImportId
            ? `PDF duplicado: já processado no import ${existingImportId}${
                linkedOperacaoId ? ` (operação #${linkedOperacaoId})` : ''
              }.`
            : 'PDF duplicado (hash já processado).');
        toast.info(duplicateReason);
        return;
      }

      if (status === 'parse_partial') {
        toast.warning(reason || 'PDF enviado. Parsing parcial: revise os campos antes de salvar.');
        return;
      }

      toast.success('PDF enviado. Parsing DISECURIT iniciado.');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao importar PDF DISECURIT');
    },
  });

  const reprocessImportMutation = useMutation({
    mutationFn: async (input: ReprocessDisecuritImportInput) => {
      if (!input.importFileId) {
        throw new Error('Import file ID inválido.');
      }

      const accessToken = await getAccessToken();
      const response = await fetch('/api/disecurit-reprocess', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          import_file_id: input.importFileId,
          reason: input.reason || null,
          program_hint: input.programHint || undefined,
        }),
      });

      if (!response.ok) {
        const message = await buildDisecuritApiErrorMessage(
          response,
          '/api/disecurit-reprocess',
          'Erro ao reprocessar'
        );
        throw new Error(String(message));
      }

      return response.json().catch(() => ({})) as Promise<DisecuritImportWebhookResponse>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['disecurit-import-files'] });
      const status = String(result?.status || '').toLowerCase();
      const reason = result?.reason ? String(result.reason) : null;

      if (status === 'failed') {
        toast.error(reason || 'Reprocessamento falhou.');
        return;
      }

      if (status === 'duplicate') {
        const existingImportId = result?.existing_import_file_id || null;
        const linkedOperacaoId = result?.existing_linked_operacao_id || null;
        const duplicateReason =
          reason ||
          (existingImportId
            ? `Reprocessamento duplicado: use o import ${existingImportId}${
                linkedOperacaoId ? ` (operação #${linkedOperacaoId})` : ''
              }.`
            : 'Reprocessamento retornou como duplicado.');
        toast.info(duplicateReason);
        return;
      }

      if (status === 'parse_partial') {
        toast.warning(reason || 'Reprocessamento concluído parcialmente.');
        return;
      }

      toast.success('Reprocessamento solicitado.');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao solicitar reprocessamento');
    },
  });

  const linkImportMutation = useMutation({
    mutationFn: async (payload: LinkDisecuritImportPayload) => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      if (!payload.importFileId || !payload.operacaoEstoqueId) {
        throw new Error('Dados de vínculo inválidos.');
      }

      if (payload.documents && payload.documents.length > 0) {
        const rows = toDocumentRows(
          empresaId,
          payload.importFileId,
          payload.operacaoEstoqueId,
          payload.documents
        );

        const { error: deleteError } = await supabase
          .from('operation_import_documents')
          .delete()
          .eq('empresa_id', empresaId)
          .eq('import_file_id', payload.importFileId)
          .eq('operacao_estoque_id', payload.operacaoEstoqueId);

        if (deleteError) {
          throw new Error(`Erro ao limpar documentos anteriores do import: ${deleteError.message}`);
        }

        const { error: insertError } = await supabase.from('operation_import_documents').insert(rows);

        if (insertError) {
          throw new Error(`Erro ao persistir documentos importados: ${insertError.message}`);
        }
      }

      const { error: linkError } = await supabase
        .from('operation_import_files')
        .update({
          linked_operacao_id: payload.operacaoEstoqueId,
          linked_at: new Date().toISOString(),
        })
        .eq('id', payload.importFileId)
        .eq('empresa_id', empresaId);

      if (linkError) {
        throw new Error(`Erro ao vincular import à operação: ${linkError.message}`);
      }

      await supabase.from('integration_audit_log').insert({
        import_file_id: payload.importFileId,
        empresa_id: empresaId,
        source: DISECURIT_SOURCE,
        event_type: 'operation_linked',
        status: 'success',
        message: `Import vinculado à operação #${payload.operacaoEstoqueId}`,
        details: {
          operacao_estoque_id: payload.operacaoEstoqueId,
          documents_count: payload.documents?.length || 0,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['disecurit-import-files'] });
      queryClient.invalidateQueries({ queryKey: ['operation-import-documents'] });
    },
  });

  const availableForPrefill = useMemo(() => {
    const imports = importsQuery.data || [];
    return imports.filter(
      (item) =>
        (item.parse_status === 'parsed' || item.parse_status === 'parse_partial') &&
        !item.linked_operacao_id &&
        isImportPayloadReady(item)
    );
  }, [importsQuery.data]);

  return {
    empresaId,
    importsQuery,
    availableForPrefill,
    uploadImportMutation,
    reprocessImportMutation,
    linkImportMutation,
  };
}
