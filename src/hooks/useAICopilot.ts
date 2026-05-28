import { useState, useCallback } from 'react';
import { generateUUID } from '@/lib/uuid';
import { useAICopilotConversations } from './useAICopilotConversations';
import { supabase, getSupabaseAnonKey } from '@/integrations/supabase/client';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  data?: MessageData | null;
}

export interface PageInfo {
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset?: number | null;
  prevOffset?: number | null;
}

export interface MessageData {
  rows: Record<string, any>[];
  columns: string[];
  rowCount: number;
  page: PageInfo | null;
  queryUrl: string | null;
}

export interface PageRequest {
  queryUrl: string;
  limit: number;
  offset: number;
  label?: string;
  addUserMessage?: boolean;
}

export interface ExportRequest {
  queryUrl: string;
  limit: number;
  fileName?: string;
  maxPages?: number;
}

export interface UseAICopilotReturn {
  messages: Message[];
  conversationId: string;
  isLoading: boolean;
  error: string | null;
  sendMessage: (question: string) => Promise<void>;
  fetchPage: (request: PageRequest) => Promise<void>;
  exportCsv: (request: ExportRequest) => Promise<void>;
  loadConversation: (conversationId: string) => Promise<void>;
  clearMessages: () => void;
}

export function useAICopilot(): UseAICopilotReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string>(() => generateUUID());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { saveConversation, loadConversation: loadConversationFromDb } = useAICopilotConversations();

  const serializeMessages = useCallback((list: Message[]) => (
    list.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp.toISOString(),
    }))
  ), []);

  const buildPageInfo = useCallback((limit: number, offset: number, rowsLength: number): PageInfo => {
    const hasMore = rowsLength >= limit;
    return {
      limit,
      offset,
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
      prevOffset: offset > 0 ? Math.max(0, offset - limit) : null,
    };
  }, []);

  const fetchRowsPage = useCallback(async (queryUrl: string, limit: number, offset: number) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    const url = new URL(queryUrl);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        apikey: getSupabaseAnonKey(),
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `Erro ${response.status}: ${response.statusText}`);
    }

    const rows = await response.json().catch(() => []);
    return Array.isArray(rows) ? rows : [];
  }, []);

  const loadConversation = useCallback(async (targetConversationId: string) => {
    if (!targetConversationId || typeof targetConversationId !== 'string') {
      console.warn('[IA Copilot] conversationId inválido para loadConversation:', targetConversationId);
      return;
    }

    console.log('[IA Copilot] Carregando conversa:', { conversationId: targetConversationId });
    setIsLoading(true);
    setError(null);

    try {
      const conversation = await loadConversationFromDb(targetConversationId);
      if (!conversation) {
        setError('Não foi possível carregar a conversa selecionada.');
        return;
      }

      const rawMessages = Array.isArray(conversation.messages) ? conversation.messages : [];
      const normalizedMessages: Message[] = rawMessages
        .map((m: any): Message | null => {
          if (!m) return null;
          const role: Message['role'] = m.role === 'assistant' ? 'assistant' : 'user';
          const content = typeof m.content === 'string' ? m.content : '';
          if (!content) return null;
          const timestamp = m.timestamp ? new Date(m.timestamp) : new Date();

          return {
            id: typeof m.id === 'string' && m.id ? m.id : generateUUID(),
            role,
            content,
            timestamp: Number.isFinite(timestamp.getTime()) ? timestamp : new Date(),
          };
        })
        .filter((m): m is Message => !!m);

      setConversationId(targetConversationId);
      setMessages(normalizedMessages);
    } catch (err) {
      console.error('[IA Copilot] Erro ao carregar conversa:', err);
      setError('Erro ao carregar conversa. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  }, [loadConversationFromDb]);

  const fetchPage = useCallback(async (request: PageRequest) => {
    if (!request?.queryUrl) return;

    const label = request.label || 'Próxima página';
    if (request.addUserMessage) {
      const userMessage: Message = {
        id: generateUUID(),
        role: 'user',
        content: label,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);
    }
    setIsLoading(true);
    setError(null);

    try {
      const rows = await fetchRowsPage(request.queryUrl, request.limit, request.offset);
      const columns = rows.length ? Object.keys(rows[0]) : [];
      const page = buildPageInfo(request.limit, request.offset, rows.length);
      const rangeStart = rows.length ? request.offset + 1 : request.offset;
      const rangeEnd = rows.length ? request.offset + rows.length : request.offset;
      const content = rows.length
        ? `Mostrando registros ${rangeStart}–${rangeEnd}.`
        : 'Nenhum registro encontrado nesta página.';

      const assistantMessage: Message = {
        id: generateUUID(),
        role: 'assistant',
        content,
        timestamp: new Date(),
        data: {
          rows,
          columns,
          rowCount: rows.length,
          page,
          queryUrl: request.queryUrl,
        },
      };

      setMessages((prev) => {
        const updated = [...prev, assistantMessage];
        const serializedMessages = serializeMessages(updated);
        saveConversation(conversationId, serializedMessages).catch(err => {
          console.error('[IA Copilot] Erro ao salvar conversa (paginação):', err);
        });
        return updated;
      });
    } catch (err) {
      console.error('[IA Copilot] Erro ao carregar página:', err);
      const errorMessage = err instanceof Error ? err.message : 'Erro ao carregar página.';
      setError(errorMessage);
      setMessages((prev) => {
        const errorMsg: Message = {
          id: generateUUID(),
          role: 'assistant',
          content: `❌ Erro: ${errorMessage}`,
          timestamp: new Date(),
          data: null,
        };
        const updated = [...prev, errorMsg];
        const serializedMessages = serializeMessages(updated);
        saveConversation(conversationId, serializedMessages).catch(saveErr => {
          console.error('[IA Copilot] Erro ao salvar conversa (paginação/erro):', saveErr);
        });
        return updated;
      });
    } finally {
      setIsLoading(false);
    }
  }, [buildPageInfo, conversationId, fetchRowsPage, saveConversation, serializeMessages]);

  const exportCsv = useCallback(async (request: ExportRequest) => {
    if (!request?.queryUrl) return;

    setIsLoading(true);
    setError(null);

    try {
      const maxPages = Number.isFinite(request.maxPages) ? request.maxPages : 20;
      const limit = request.limit || 100;
      let offset = 0;
      let page = 0;
      let allRows: Record<string, any>[] = [];

      while (page < maxPages) {
        const pageRows = await fetchRowsPage(request.queryUrl, limit, offset);
        allRows = allRows.concat(pageRows);
        if (pageRows.length < limit) break;
        offset += limit;
        page += 1;
      }

      if (!allRows.length) {
        throw new Error('Nenhum registro encontrado para exportação.');
      }

      const columns = Array.from(allRows.reduce((acc, row) => {
        Object.keys(row || {}).forEach((key) => acc.add(key));
        return acc;
      }, new Set<string>()));

      const escapeValue = (value: any) => {
        if (value === null || value === undefined) return '';
        const raw = typeof value === 'string' ? value : JSON.stringify(value);
        const escaped = raw.replace(/"/g, '""');
        return `"${escaped}"`;
      };

      const csvLines = [
        columns.join(','),
        ...allRows.map((row) => columns.map((col) => escapeValue(row?.[col])).join(',')),
      ];

      const csv = csvLines.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = request.fileName || `export-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[IA Copilot] Erro ao exportar CSV:', err);
      const errorMessage = err instanceof Error ? err.message : 'Erro ao exportar CSV.';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [fetchRowsPage]);

  const sendMessage = useCallback(async (question: string) => {
    if (!question.trim()) {
      console.warn('[IA Copilot] Tentativa de enviar mensagem vazia');
      return;
    }

    const normalizedQuestion = question.trim().toLowerCase();
    const isNextPage = /(proxima|próxima|seguinte|mais|continuar)/.test(normalizedQuestion);
    const isPrevPage = /(anterior|voltar|pagina anterior)/.test(normalizedQuestion);
    const pageMatch = normalizedQuestion.match(/pagina\s*(\d+)/);

    if (isNextPage || isPrevPage || pageMatch) {
      const lastPageMessage = [...messages]
        .slice()
        .reverse()
        .find((msg) => msg.role === 'assistant' && msg.data?.page && msg.data?.queryUrl);

      if (lastPageMessage?.data?.page && lastPageMessage.data.queryUrl) {
        const { page } = lastPageMessage.data;
        let targetOffset = isPrevPage ? page.prevOffset : page.nextOffset;

        if (pageMatch) {
          const pageNumber = Number(pageMatch[1]);
          if (Number.isFinite(pageNumber) && pageNumber > 0) {
            targetOffset = (pageNumber - 1) * page.limit;
          }
        }

        if (targetOffset !== null && targetOffset !== undefined) {
          await fetchPage({
            queryUrl: lastPageMessage.data.queryUrl,
            limit: page.limit,
            offset: targetOffset,
            label: question.trim(),
            addUserMessage: true,
          });
          return;
        }
      }
    }

    console.log('[IA Copilot] Enviando mensagem:', { question: question.trim(), conversationId });
    setIsLoading(true);
    setError(null);

    // Adicionar mensagem do usuário
    const userMessage: Message = {
      id: generateUUID(),
      role: 'user',
      content: question.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);

    try {
      const requestBody = {
        question: question.trim(),
        conversationId,
      };

      console.log('[IA Copilot] Fazendo requisição para /api/n8n-proxy:', requestBody);

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      // Chamar proxy Vercel
      const response = await fetch('/api/n8n-proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(requestBody),
      });

      console.log('[IA Copilot] Resposta recebida:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[IA Copilot] Erro na resposta:', errorData);
        throw new Error(errorData.message || `Erro ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('[IA Copilot] Dados recebidos:', {
        hasAnswer: !!data.answer,
        hasResponse: !!data.response,
        cached: data.cached
      });

      const payload = data?.data || null;
      const rows = Array.isArray(payload?.rows) ? payload.rows : [];
      const columns = rows.length ? Object.keys(rows[0]) : [];
      const messageData: MessageData | null = rows.length ? {
        rows,
        columns,
        rowCount: Number(payload?.rowCount || rows.length),
        page: payload?.page || null,
        queryUrl: typeof payload?.queryUrl === 'string' ? payload.queryUrl : null,
      } : null;

      const toText = (value: unknown): string | null => {
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        return null;
      };

      let finalContent =
        toText(payload?.output) ||
        toText(data.output) ||
        toText(data.answer) ||
        toText(data.response) ||
        'Não foi possível processar sua pergunta.';

      // Tentar interpretar a resposta caso seja um JSON stringificado do n8n (Query Planner)
      try {
        if (typeof finalContent === 'string' && finalContent.trim().startsWith('{')) {
          const parsed = JSON.parse(finalContent) as Record<string, unknown>;
          if (parsed && typeof parsed === 'object') {
            const intent = toText(parsed.intent);
            const clarifyQuestion = toText(parsed.clarifyQuestion);
            const answer = toText(parsed.answer);
            const needsQuery = parsed.needsQuery === true;
            const message = toText(parsed.message);

            if (intent === 'clarify' && clarifyQuestion) {
              finalContent = clarifyQuestion;
            } else if (intent === 'data' || needsQuery) {
              finalContent = answer || (rows.length > 0
                ? `Aqui estão os resultados encontrados para sua consulta (${rows.length} registros).`
                : 'Consulta realizada com sucesso, mas nenhum dado retornado.');
            } else if (answer) {
              finalContent = answer;
            } else if (!needsQuery && clarifyQuestion) {
              finalContent = clarifyQuestion;
            } else {
              // Fallback se não bater com as chaves conhecidas, mas for JSON
              finalContent = message || answer || 'Aqui está a resposta para sua solicitação.';
            }
          }
        }
      } catch (e) {
        console.warn('[IA Copilot] Não foi possível fazer parse da resposta como JSON, usando texto original.', e);
      }

      // Adicionar resposta da IA
      const assistantMessage: Message = {
        id: generateUUID(),
        role: 'assistant',
        content: finalContent,
        timestamp: new Date(),
        data: messageData,
      };

      setMessages((prev) => {
        const updated = [...prev, assistantMessage];
        // Salvar conversa no banco de dados (async, não bloqueia)
        // Converter Message[] para formato serializável (Date -> string)
        const serializedMessages = serializeMessages(updated);
        saveConversation(conversationId, serializedMessages).catch(err => {
          console.error('[IA Copilot] Erro ao salvar conversa:', err);
          // Não mostrar erro ao usuário, apenas logar
        });
        return updated;
      });
    } catch (err) {
      console.error('[IA Copilot] Erro ao processar mensagem:', err);
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido ao processar sua pergunta.';
      setError(errorMessage);

      // Adicionar mensagem de erro
      const errorMsg: Message = {
        id: generateUUID(),
        role: 'assistant',
        content: `❌ Erro: ${errorMessage}`,
        timestamp: new Date(),
        data: null,
      };

      setMessages((prev) => {
        const updated = [...prev, errorMsg];
        // Salvar conversa mesmo em caso de erro (para histórico)
        // Converter Message[] para formato serializável (Date -> string)
        const serializedMessages = serializeMessages(updated);
        saveConversation(conversationId, serializedMessages).catch(err => {
          console.error('[IA Copilot] Erro ao salvar conversa (erro):', err);
        });
        return updated;
      });
    } finally {
      setIsLoading(false);
    }
  }, [conversationId, fetchPage, messages, saveConversation, serializeMessages]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setConversationId(generateUUID());
  }, []);

  return {
    messages,
    conversationId,
    isLoading,
    error,
    sendMessage,
    fetchPage,
    exportCsv,
    loadConversation,
    clearMessages,
  };
}
