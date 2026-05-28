import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  History,
  ListTree,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import type {
  OperationIaBatchConfirmSummary,
  OperationIaHistoryData,
  OperationIaHistoryEvent,
  OperacoesIaChatSessionRow,
} from '@/types/operacoes-ia';
import type { DisecuritProgram, ImportParseStatus } from '@/types/disecurit-import';

export type OperacoesIaCopilotMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

type EditableItemSummary = {
  id: string;
  import_file_id: string;
  original_filename: string | null;
  program: string | null;
  status: string;
  face_titulos: number | null;
  valor_compra: number | null;
  documento: string | null;
  data_operacao: string | null;
};

export type OperacoesIaSessionImportEntry = {
  id: string;
  label: string;
  parse_status: ImportParseStatus | string;
  linked_operacao_id: number | null;
};

export type OperacoesIaUploadQueueStatus = 'queued' | 'uploading' | 'success' | 'error';

export type OperacoesIaUploadQueueItem = {
  id: string;
  name: string;
  status: OperacoesIaUploadQueueStatus;
  error_message?: string | null;
  import_file_id?: string | null;
};

const parseStatusLabel = (status: ImportParseStatus | string) => {
  switch (status) {
    case 'received':
      return 'Recebido';
    case 'processing':
      return 'Processando';
    case 'parsed':
      return 'Parseado';
    case 'parse_partial':
      return 'Parse parcial';
    case 'failed':
      return 'Falhou';
    case 'duplicate':
      return 'Duplicado';
    default:
      return String(status);
  }
};

const statusBadgeVariant = (status: string) => {
  if (status === 'created' || status === 'ready' || status === 'parsed' || status === 'success') return 'success';
  if (status === 'review' || status === 'parse_partial') return 'warning';
  if (status === 'failed' || status === 'error') return 'destructive';
  if (status === 'uploading') return 'secondary';
  if (status === 'ignored') return 'secondary';
  return 'outline';
};

const uploadStatusLabel = (status: OperacoesIaUploadQueueStatus): string => {
  if (status === 'queued') return 'Na fila';
  if (status === 'uploading') return 'Enviando';
  if (status === 'success') return 'Enviado';
  return 'Falhou';
};

export type OperacoesIaCopilotPanelProps = {
  className?: string;
  batchId: string | null;
  activeItem: EditableItemSummary | null;
  counts: {
    total: number;
    ready: number;
    review: number;
    error: number;
    created: number;
    failed: number;
    ignored: number;
  };
  lastSummary: OperationIaBatchConfirmSummary | null;
  onSendApi: (
    text: string,
    context: Record<string, unknown>
  ) => Promise<{ reply: string; session_id?: string | null }>;
  /** Troca de thread: use como `key` no assistente para resetar mensagens. */
  copilotThreadKey: string;
  /** Mensagens iniciais ao carregar sessão; `null` = mensagem de boas-vindas padrão. */
  copilotSeedMessages: OperacoesIaCopilotMessage[] | null;
  chatSessions?: OperacoesIaChatSessionRow[];
  chatSessionsLoading?: boolean;
  onOpenChatSessionsMenu?: () => void;
  onLoadChatSession?: (sessionId: string) => void | Promise<void>;
  onDeleteChatSession?: (sessionId: string) => void | Promise<void>;
  /** Nova conversa: limpa sessão ativa + hints (delegado ao pai). */
  onStartNewChatConversation?: () => void;
  /** Aba Entrada — programa do lote */
  programHint: '' | DisecuritProgram;
  onProgramHintChange: (value: '' | DisecuritProgram) => void;
  dataReferenciaLote: string;
  onDataReferenciaLoteChange: (value: string) => void;
  operationHint: string;
  onOperationHintChange: (value: string) => void;
  cnpjHint: string;
  onCnpjHintChange: (value: string) => void;
  uploadQueue: OperacoesIaUploadQueueItem[];
  onAddFiles: (files: File[]) => void;
  onUploadQueued: () => void | Promise<void>;
  onRetryUpload: (itemId: string) => void | Promise<void>;
  onRemoveUpload: (itemId: string) => void;
  onClearCompleted: () => void;
  uploadPending: boolean;
  sessionImports: OperacoesIaSessionImportEntry[];
  historyData?: OperationIaHistoryData | null;
  historyLoading?: boolean;
  historyError?: string | null;
  onOpenHistoryMenu?: () => void;
  onRefreshHistory?: () => void | Promise<void>;
  /** Conteúdo completo de diagnóstico do item selecionado (workspace). */
  selectedItemDetailContent?: ReactNode | null;
};

const formatCurrency = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

type HistoryFilter = 'all' | 'errors' | 'created' | 'corrections' | 'imports';

const formatDatePtBr = (value: string | null | undefined): string => {
  if (!value) return '—';
  const dateOnly = String(value).slice(0, 10);
  const [year, month, day] = dateOnly.split('-');
  if (!year || !month || !day) return String(value);
  return `${day}/${month}/${year}`;
};

const formatHistoryTime = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const historyCategoryLabel = (value: OperationIaHistoryEvent['categoria']): string => {
  if (value === 'imports') return 'Import';
  if (value === 'created') return 'Criada';
  if (value === 'errors') return 'Erro';
  if (value === 'corrections') return 'Correção';
  return 'Evento';
};

const historyStatusLabel = (value: OperationIaHistoryEvent['status']): string => {
  if (value === 'success') return 'Sucesso';
  if (value === 'warning') return 'Alerta';
  if (value === 'error') return 'Erro';
  return 'Info';
};

const historyStatusVariant = (value: OperationIaHistoryEvent['status']) => {
  if (value === 'success') return 'success';
  if (value === 'warning') return 'warning';
  if (value === 'error') return 'destructive';
  return 'outline';
};

const buildDefaultWelcomeMessage = (): OperacoesIaCopilotMessage => ({
  id: 'welcome',
  role: 'assistant',
  content:
    'Sou o copiloto de Operações com IA. Na aba Entrada, anexe os PDFs e defina programa e data do lote. Na revisão principal, gere o preview e confirme o lote. Aqui posso orientar sobre duplicidade e conferência.',
  createdAt: new Date().toISOString(),
});

type OperacoesIaAssistenteTabProps = {
  seedMessages: OperacoesIaCopilotMessage[] | null;
  batchId: string | null;
  activeItem: EditableItemSummary | null;
  counts: OperacoesIaCopilotPanelProps['counts'];
  lastSummary: OperationIaBatchConfirmSummary | null;
  onSendApi: OperacoesIaCopilotPanelProps['onSendApi'];
  onStartNewChatConversation?: () => void;
  programHint: '' | DisecuritProgram;
  dataReferenciaLote: string;
};

function OperacoesIaAssistenteTab({
  seedMessages,
  batchId,
  activeItem,
  counts,
  lastSummary,
  onSendApi,
  onStartNewChatConversation,
  programHint,
  dataReferenciaLote,
}: OperacoesIaAssistenteTabProps) {
  const [messages, setMessages] = useState<OperacoesIaCopilotMessage[]>(() =>
    seedMessages && seedMessages.length ? seedMessages : [buildDefaultWelcomeMessage()]
  );
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const handleClear = useCallback(() => {
    if (onStartNewChatConversation) {
      onStartNewChatConversation();
      return;
    }
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        role: 'assistant',
        content: 'Conversa limpa. Como posso ajudar com o lote atual?',
        createdAt: new Date().toISOString(),
      },
    ]);
  }, [onStartNewChatConversation]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;

    const userMsg: OperacoesIaCopilotMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setDraft('');
    setSending(true);

    try {
      const result = await onSendApi(text, {
        batch_id: batchId,
        item_id: activeItem?.id ?? null,
        import_file_id: activeItem?.import_file_id ?? null,
        program_hint: programHint || null,
        reference_date: dataReferenciaLote || null,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: result.reply,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          content: 'Não foi possível contatar o assistente. Tente novamente em instantes.',
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [batchId, activeItem, dataReferenciaLote, draft, onSendApi, programHint, sending]);

  return (
    <>
      <div className="shrink-0 space-y-2 border-b border-border/60 bg-muted/20 px-3 py-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-foreground">Resumo do workspace</p>
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={handleClear}>
            <Trash2 className="h-3.5 w-3.5" />
            Limpar chat
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-muted-foreground">
          <span>Total</span>
          <span className="text-right font-medium text-foreground">{counts.total}</span>
          <span>Prontos</span>
          <span className="text-right font-medium text-foreground">{counts.ready}</span>
          <span>Revisão</span>
          <span className="text-right font-medium text-foreground">{counts.review}</span>
          <span>Falhas</span>
          <span className="text-right font-medium text-foreground">{counts.failed}</span>
        </div>
        {lastSummary ? (
          <div className="mt-2 rounded-md border border-border/60 bg-background/80 px-2 py-1.5">
            <p className="font-medium text-foreground">Última confirmação</p>
            <p>
              Criados {lastSummary.created} · Ignorados {lastSummary.ignored} · Falhas {lastSummary.failed}
            </p>
            <p>Valor criado {formatCurrency(lastSummary.value_total_created)}</p>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-b border-border/60 px-3 py-2 text-xs">
        <p className="mb-1 font-medium text-foreground">Contexto ativo</p>
        {activeItem ? (
          <div className="space-y-0.5 text-muted-foreground">
            <p className="font-medium text-foreground">{activeItem.original_filename || activeItem.import_file_id}</p>
            <p>
              {activeItem.program || '—'} · {activeItem.status}
            </p>
            <p>
              Face {formatCurrency(activeItem.face_titulos)} · Compra {formatCurrency(activeItem.valor_compra)}
            </p>
            <p>
              Doc. {activeItem.documento || '—'} · Data {activeItem.data_operacao || '—'}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground">Nenhuma linha selecionada. Clique em um item no workspace.</p>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                'rounded-lg px-3 py-2 text-sm',
                m.role === 'user' ? 'ml-4 bg-primary/10 text-foreground' : 'mr-4 bg-muted/50 text-foreground'
              )}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          ))}
          {sending ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Enviando…
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t border-border/70 p-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Pergunte sobre o lote ou a linha selecionada…"
          className="min-h-[72px] resize-none text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <div className="mt-2 flex justify-end">
          <Button type="button" size="sm" className="gap-1" onClick={() => void handleSend()} disabled={sending || !draft.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar
          </Button>
        </div>
      </div>
    </>
  );
}

export function OperacoesIaCopilotPanel({
  className,
  batchId,
  activeItem,
  counts,
  lastSummary,
  onSendApi,
  copilotThreadKey,
  copilotSeedMessages,
  chatSessions = [],
  chatSessionsLoading = false,
  onOpenChatSessionsMenu,
  onLoadChatSession,
  onDeleteChatSession,
  onStartNewChatConversation,
  programHint,
  onProgramHintChange,
  dataReferenciaLote,
  onDataReferenciaLoteChange,
  operationHint,
  onOperationHintChange,
  cnpjHint,
  onCnpjHintChange,
  uploadQueue,
  onAddFiles,
  onUploadQueued,
  onRetryUpload,
  onRemoveUpload,
  onClearCompleted,
  uploadPending,
  sessionImports,
  historyData = null,
  historyLoading = false,
  historyError = null,
  onOpenHistoryMenu,
  onRefreshHistory,
  selectedItemDetailContent = null,
}: OperacoesIaCopilotPanelProps) {
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [chatSessionsMenuOpen, setChatSessionsMenuOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [detailsDrawerTab, setDetailsDrawerTab] = useState<'item' | 'day'>('day');

  const chatHistoryGroups = useMemo(() => {
    const map = new Map<string, OperacoesIaChatSessionRow[]>();
    const sorted = [...chatSessions].sort((a, b) =>
      String(b.last_message_at || '').localeCompare(String(a.last_message_at || ''))
    );
    for (const row of sorted) {
      const key = (row.reference_date || '').slice(0, 10) || 'sem-data';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, items]) => ({ date, items }));
  }, [chatSessions]);

  const handleChatSessionsMenuOpenChange = useCallback(
    (open: boolean) => {
      setChatSessionsMenuOpen(open);
      if (open) onOpenChatSessionsMenu?.();
    },
    [onOpenChatSessionsMenu]
  );

  const historyEvents = useMemo(() => historyData?.events || [], [historyData]);
  const historyPreviewEvents = useMemo(() => historyEvents.slice(0, 5), [historyEvents]);
  const filteredHistoryEvents = useMemo(() => {
    if (historyFilter === 'all') return historyEvents;
    if (historyFilter === 'errors') {
      return historyEvents.filter((event) => event.status === 'error' || event.categoria === 'errors');
    }
    if (historyFilter === 'created') {
      return historyEvents.filter((event) => event.categoria === 'created');
    }
    if (historyFilter === 'corrections') {
      return historyEvents.filter((event) => event.categoria === 'corrections');
    }
    return historyEvents.filter((event) => event.categoria === 'imports');
  }, [historyEvents, historyFilter]);

  const handleHistoryMenuOpenChange = useCallback(
    (open: boolean) => {
      setHistoryMenuOpen(open);
      if (open) {
        onOpenHistoryMenu?.();
      }
    },
    [onOpenHistoryMenu]
  );

  const openHistoryDrawer = useCallback(() => {
    setDetailsDrawerTab('day');
    setHistoryMenuOpen(false);
    setHistoryDrawerOpen(true);
    onOpenHistoryMenu?.();
  }, [onOpenHistoryMenu]);

  const openItemDetailsDrawer = useCallback(() => {
    setDetailsDrawerTab('item');
    setHistoryMenuOpen(false);
    setHistoryDrawerOpen(true);
    onOpenHistoryMenu?.();
  }, [onOpenHistoryMenu]);

  const entradaTab = (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-4 p-3 pb-6">
        <div className="space-y-2">
          <Label htmlFor="copilot-program">Programa *</Label>
          <select
            id="copilot-program"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={programHint}
            onChange={(e) => onProgramHintChange(e.target.value as '' | DisecuritProgram)}
          >
            <option value="">Selecione...</option>
            <option value="SPPRO">SPPRO</option>
            <option value="SOI">SOI</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="copilot-lote-date">Data do lote *</Label>
          <Input
            id="copilot-lote-date"
            type="date"
            value={dataReferenciaLote}
            onChange={(e) => onDataReferenciaLoteChange(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Enviada como hint em cada upload (n8n) e como fallback de data no preview quando o PDF não trouxer data.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="copilot-file">PDF (DISECURIT)</Label>
          <Input
            id="copilot-file"
            type="file"
            multiple
            accept="application/pdf,.pdf"
            onChange={(event) => {
              const selected = Array.from(event.target.files || []);
              if (selected.length) {
                onAddFiles(selected);
              }
              event.currentTarget.value = '';
            }}
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            type="button"
            className="w-full gap-2"
            onClick={() => void onUploadQueued()}
            disabled={uploadPending || uploadQueue.every((item) => item.status === 'success')}
          >
            {uploadPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Enviando fila…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Enviar fila
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={onClearCompleted}
            disabled={!uploadQueue.some((item) => item.status === 'success')}
          >
            Limpar concluídos
          </Button>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">Fila de upload ({uploadQueue.length})</p>
          {uploadQueue.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum PDF na fila.</p>
          ) : (
            <ul className="space-y-2">
              {uploadQueue.map((item) => (
                <li
                  key={item.id}
                  className="rounded-md border border-border/60 bg-background/80 px-2 py-1.5 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">{item.name}</span>
                    <Badge variant={statusBadgeVariant(item.status)}>{uploadStatusLabel(item.status)}</Badge>
                  </div>
                  {item.error_message ? (
                    <p className="mt-1 text-[11px] text-destructive">{item.error_message}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {item.status === 'error' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => void onRetryUpload(item.id)}
                        disabled={uploadPending}
                      >
                        Reenviar
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => onRemoveUpload(item.id)}
                      disabled={item.status === 'uploading'}
                    >
                      Remover
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-md border border-muted/60 bg-muted/20 p-3 text-xs text-muted-foreground">
          Escopo: SOI/SPPRO (DISECURIT). PDF genérico fora do MVP. Use o card principal para gerar o preview do lote.
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">Arquivos nesta sessão ({sessionImports.length})</p>
          {sessionImports.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum PDF adicionado ainda.</p>
          ) : (
            <ul className="space-y-2">
              {sessionImports.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-background/80 px-2 py-1.5 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">{row.label}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant={statusBadgeVariant(String(row.parse_status))}>{parseStatusLabel(row.parse_status)}</Badge>
                    {row.linked_operacao_id ? (
                      <span className="text-[10px] text-muted-foreground">Op. #{row.linked_operacao_id}</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ScrollArea>
  );

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-2">
        <MessageSquareText className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">Copiloto</span>
      </div>

      <Tabs defaultValue="entrada" className="flex min-h-0 flex-1 flex-col">
        <div className="mx-3 mt-2 flex shrink-0 items-center gap-2">
          <TabsList className="h-9 w-auto self-stretch justify-start sm:self-start">
            <TabsTrigger value="entrada" className="text-xs sm:text-sm">
              Entrada
            </TabsTrigger>
            <TabsTrigger value="assistente" className="text-xs sm:text-sm">
              Assistente
            </TabsTrigger>
          </TabsList>
          <DropdownMenu open={chatSessionsMenuOpen} onOpenChange={handleChatSessionsMenuOpenChange}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-3 text-xs sm:text-sm"
              >
                <History className="h-3.5 w-3.5" />
                Conversas
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-[380px] overflow-y-auto p-2">
              {chatSessionsLoading ? (
                <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Carregando conversas…
                </div>
              ) : chatHistoryGroups.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">Nenhuma conversa salva ainda.</p>
              ) : (
                <div className="space-y-2">
                  {chatHistoryGroups.map((group) => (
                    <div key={group.date} className="space-y-1">
                      <div className="px-2 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {group.date === 'sem-data' ? 'Sem data' : formatDatePtBr(group.date)}
                      </div>
                      {group.items.map((sessionRow) => {
                        const lineTitle =
                          sessionRow.title ||
                          [sessionRow.program_hint, sessionRow.reference_date].filter(Boolean).join(' · ') ||
                          'Conversa';
                        return (
                          <div
                            key={sessionRow.id}
                            className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground">{lineTitle}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {formatHistoryTime(sessionRow.last_message_at)}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  void onLoadChatSession?.(sessionRow.id);
                                  setChatSessionsMenuOpen(false);
                                }}
                              >
                                Carregar
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                                onClick={() => {
                                  if (
                                    typeof window !== 'undefined' &&
                                    !window.confirm('Excluir esta conversa do histórico?')
                                  ) {
                                    return;
                                  }
                                  void onDeleteChatSession?.(sessionRow.id);
                                }}
                              >
                                Excluir
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu open={historyMenuOpen} onOpenChange={handleHistoryMenuOpenChange}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-3 text-xs sm:text-sm"
              >
                <ListTree className="h-3.5 w-3.5" />
                Detalhes
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[340px] max-w-[90vw] p-2">
              <div className="space-y-2 text-xs">
                {selectedItemDetailContent ? (
                  <div className="space-y-2 border-b border-border/60 pb-2">
                    <p className="font-medium text-foreground">Item selecionado</p>
                    <p className="text-[11px] text-muted-foreground">
                      Diagnóstico, histórico do item e campos raw do PDF ficam no painel lateral.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-full justify-between gap-1 text-xs"
                      onClick={openItemDetailsDrawer}
                    >
                      Abrir detalhes do item
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : null}

                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-foreground">Histórico do dia</p>
                    <p className="text-muted-foreground">
                      {historyData ? formatDatePtBr(historyData.date_ref) : 'Carregando contexto diário...'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-[11px]"
                    onClick={() => {
                      void onRefreshHistory?.();
                    }}
                    disabled={historyLoading}
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', historyLoading ? 'animate-spin' : '')} />
                    Atualizar
                  </Button>
                </div>

                {historyError ? (
                  <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-destructive">
                    {historyError}
                  </p>
                ) : null}

                {!historyError && historyData ? (
                  <>
                    <div className="grid grid-cols-2 gap-1 text-[11px]">
                      <div className="rounded border border-border/60 px-2 py-1 text-muted-foreground">
                        Total <strong className="text-foreground">{historyData.summary.total}</strong>
                      </div>
                      <div className="rounded border border-border/60 px-2 py-1 text-muted-foreground">
                        Erros <strong className="text-foreground">{historyData.summary.errors}</strong>
                      </div>
                      <div className="rounded border border-border/60 px-2 py-1 text-muted-foreground">
                        Criadas <strong className="text-foreground">{historyData.summary.created}</strong>
                      </div>
                      <div className="rounded border border-border/60 px-2 py-1 text-muted-foreground">
                        Correções <strong className="text-foreground">{historyData.summary.corrections}</strong>
                      </div>
                    </div>

                    <div className="space-y-1">
                      {historyPreviewEvents.length ? (
                        historyPreviewEvents.map((event) => (
                          <div key={event.id} className="rounded border border-border/60 px-2 py-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-[11px] font-medium text-foreground">{event.tipo_evento}</p>
                              <span className="text-[10px] text-muted-foreground">{formatHistoryTime(event.timestamp)}</span>
                            </div>
                            <p className="truncate text-[11px] text-muted-foreground">{event.mensagem || 'Sem mensagem.'}</p>
                          </div>
                        ))
                      ) : historyLoading ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Carregando eventos...
                        </div>
                      ) : (
                        <p className="text-muted-foreground">Sem eventos relevantes para este dia.</p>
                      )}
                    </div>
                  </>
                ) : null}

                {!historyError && !historyData && !historyLoading ? (
                  <p className="text-muted-foreground">Abra o menu para carregar o histórico do dia.</p>
                ) : null}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full justify-between text-xs"
                  onClick={openHistoryDrawer}
                >
                  Ver detalhes do dia
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <TabsContent
          value="entrada"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden focus-visible:ring-0 data-[state=inactive]:hidden"
        >
          {entradaTab}
        </TabsContent>

        <TabsContent
          value="assistente"
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden focus-visible:ring-0 data-[state=inactive]:hidden"
        >
          <OperacoesIaAssistenteTab
            key={copilotThreadKey}
            seedMessages={copilotSeedMessages}
            batchId={batchId}
            activeItem={activeItem}
            counts={counts}
            lastSummary={lastSummary}
            onSendApi={onSendApi}
            onStartNewChatConversation={onStartNewChatConversation}
            programHint={programHint}
            dataReferenciaLote={dataReferenciaLote}
          />
        </TabsContent>
      </Tabs>

      <Sheet
        open={historyDrawerOpen}
        onOpenChange={(open) => {
          setHistoryDrawerOpen(open);
          if (!open) setDetailsDrawerTab('day');
        }}
      >
        <SheetContent
          side="right"
          className="flex h-full w-full flex-col p-0 sm:max-w-[430px]"
          title="Detalhes - Operacoes IA"
          description="Diagnóstico do item selecionado e histórico diário."
        >
          {selectedItemDetailContent ? (
            <Tabs
              value={detailsDrawerTab}
              onValueChange={(value) => setDetailsDrawerTab(value as 'item' | 'day')}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="shrink-0 border-b border-border/70 px-3 py-2">
                <TabsList className="h-9 w-full justify-start gap-1">
                  <TabsTrigger value="item" className="text-xs">
                    Item
                  </TabsTrigger>
                  <TabsTrigger value="day" className="text-xs">
                    Histórico do dia
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent
                value="item"
                className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden focus-visible:ring-0 data-[state=inactive]:hidden"
              >
                <ScrollArea className="min-h-0 flex-1">
                  <div className="space-y-2 p-3">{selectedItemDetailContent}</div>
                </ScrollArea>
              </TabsContent>
              <TabsContent
                value="day"
                className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden focus-visible:ring-0 data-[state=inactive]:hidden"
              >
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border/70 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-foreground">Histórico diário</p>
                <p className="text-xs text-muted-foreground">
                  {historyData ? `${formatDatePtBr(historyData.date_ref)} (${historyData.timezone})` : 'Sem dados carregados.'}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => {
                  void onRefreshHistory?.();
                }}
                disabled={historyLoading}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', historyLoading ? 'animate-spin' : '')} />
                Atualizar
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap gap-1">
              {([
                { id: 'all', label: 'Todos' },
                { id: 'errors', label: 'Erros' },
                { id: 'created', label: 'Criadas' },
                { id: 'corrections', label: 'Correções' },
                { id: 'imports', label: 'Imports' },
              ] as Array<{ id: HistoryFilter; label: string }>).map((filterItem) => (
                <Button
                  key={filterItem.id}
                  type="button"
                  variant={historyFilter === filterItem.id ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setHistoryFilter(filterItem.id)}
                >
                  {filterItem.label}
                </Button>
              ))}
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 p-3">
              {historyError ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                  {historyError}
                </p>
              ) : null}

              {historyLoading ? (
                <div className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Carregando eventos do dia...
                </div>
              ) : null}

              {!historyLoading && !historyError && filteredHistoryEvents.length === 0 ? (
                <p className="rounded-md border border-border/60 px-2 py-1.5 text-xs text-muted-foreground">
                  Nenhum evento encontrado para o filtro selecionado.
                </p>
              ) : null}

              {!historyLoading && !historyError
                ? filteredHistoryEvents.map((event) => (
                    <div key={event.id} className="rounded-md border border-border/60 bg-background/80 px-2 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-medium text-foreground">{event.tipo_evento}</p>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{formatHistoryTime(event.timestamp)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <Badge variant={historyStatusVariant(event.status)} className="text-[10px]">
                          {historyStatusLabel(event.status)}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {historyCategoryLabel(event.categoria)}
                        </Badge>
                        {event.programa ? (
                          <Badge variant="outline" className="text-[10px]">
                            {event.programa}
                          </Badge>
                        ) : null}
                        {event.operacao ? (
                          <span className="text-[11px] text-muted-foreground">Op. {event.operacao}</span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-muted-foreground">{event.mensagem || 'Sem mensagem registrada.'}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                        {event.import_file_id ? <span>Import: {event.import_file_id}</span> : null}
                        {event.usuario ? <span>Usuário: {event.usuario}</span> : null}
                        <span>Origem: {event.origin}</span>
                      </div>
                    </div>
                  ))
                : null}
            </div>
          </ScrollArea>
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border/70 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-foreground">Histórico diário</p>
                <p className="text-xs text-muted-foreground">
                  {historyData ? `${formatDatePtBr(historyData.date_ref)} (${historyData.timezone})` : 'Sem dados carregados.'}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => {
                  void onRefreshHistory?.();
                }}
                disabled={historyLoading}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', historyLoading ? 'animate-spin' : '')} />
                Atualizar
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap gap-1">
              {([
                { id: 'all', label: 'Todos' },
                { id: 'errors', label: 'Erros' },
                { id: 'created', label: 'Criadas' },
                { id: 'corrections', label: 'Correções' },
                { id: 'imports', label: 'Imports' },
              ] as Array<{ id: HistoryFilter; label: string }>).map((filterItem) => (
                <Button
                  key={filterItem.id}
                  type="button"
                  variant={historyFilter === filterItem.id ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setHistoryFilter(filterItem.id)}
                >
                  {filterItem.label}
                </Button>
              ))}
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 p-3">
              {historyError ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                  {historyError}
                </p>
              ) : null}

              {historyLoading ? (
                <div className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Carregando eventos do dia...
                </div>
              ) : null}

              {!historyLoading && !historyError && filteredHistoryEvents.length === 0 ? (
                <p className="rounded-md border border-border/60 px-2 py-1.5 text-xs text-muted-foreground">
                  Nenhum evento encontrado para o filtro selecionado.
                </p>
              ) : null}

              {!historyLoading && !historyError
                ? filteredHistoryEvents.map((event) => (
                    <div key={event.id} className="rounded-md border border-border/60 bg-background/80 px-2 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-medium text-foreground">{event.tipo_evento}</p>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{formatHistoryTime(event.timestamp)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <Badge variant={historyStatusVariant(event.status)} className="text-[10px]">
                          {historyStatusLabel(event.status)}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {historyCategoryLabel(event.categoria)}
                        </Badge>
                        {event.programa ? (
                          <Badge variant="outline" className="text-[10px]">
                            {event.programa}
                          </Badge>
                        ) : null}
                        {event.operacao ? (
                          <span className="text-[11px] text-muted-foreground">Op. {event.operacao}</span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-muted-foreground">{event.mensagem || 'Sem mensagem registrada.'}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                        {event.import_file_id ? <span>Import: {event.import_file_id}</span> : null}
                        {event.usuario ? <span>Usuário: {event.usuario}</span> : null}
                        <span>Origem: {event.origin}</span>
                      </div>
                    </div>
                  ))
                : null}
            </div>
          </ScrollArea>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
