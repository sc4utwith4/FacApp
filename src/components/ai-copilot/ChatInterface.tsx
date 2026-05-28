import { useEffect, useRef, useState } from 'react';
import { Loader2, Bot, User, Trash2, History, Download } from 'lucide-react';
import { useAICopilot, type Message } from '@/hooks/useAICopilot';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlaceholdersAndVanishInput } from '@/components/ui/placeholders-and-vanish-input';
import { UiRenderErrorBoundary } from '@/components/ui/ui-render-error-boundary';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ConversationHistory } from './ConversationHistory';
import { ResultTable } from './ResultTable';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const placeholders = [
  "Quanto já gastei este mês?",
  "Qual o saldo atual das contas bancárias?",
  "Quais fornecedores têm títulos em atraso?",
  "Quantos fornecedores temos cadastrados?",
  "Qual o valor total de contas a pagar pendentes?",
  "Mostre os lançamentos de caixa deste mês",
  "Qual o saldo atual do estoque SPPRO?",
  "Quanto recebi de contas a receber este mês?"
];

export function ChatInterface() {
  const {
    messages,
    isLoading,
    error,
    sendMessage,
    fetchPage,
    exportCsv,
    loadConversation,
    clearMessages,
    conversationId,
  } = useAICopilot();
  const [inputValue, setInputValue] = useState('');
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    // Scroll automático para o final quando novas mensagens chegarem
    // Usar requestAnimationFrame para garantir que o DOM atualizou
    const scrollToBottom = () => {
      requestAnimationFrame(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      });
    };
    scrollToBottom();
  }, [messages]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const submittedValue = new FormData(e.currentTarget).get('question');
    const question =
      typeof submittedValue === 'string' && submittedValue.trim().length > 0
        ? submittedValue.trim()
        : inputValue.trim();

    if (!question || isLoading) {
      return;
    }

    // Limpar inputValue (o componente PlaceholdersAndVanishInput gerencia seu próprio estado)
    setInputValue('');
    try {
      await sendMessage(question);
    } catch (error) {
      console.error('[ChatInterface] Erro ao chamar sendMessage:', error);
    }
  };

  const handleExport = () => {
    if (messages.length === 0) return;

    const data = {
      conversationId,
      exportedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp.toISOString(),
      })),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversa-${conversationId.substring(0, 8)}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSelectConversation = async (selectedConversationId: string) => {
    if (!selectedConversationId || isLoading) return;
    await loadConversation(selectedConversationId);
    setShowHistory(false);
  };

  const handlePageRequest = async (message: Message, direction: 'next' | 'prev') => {
    const page = message.data?.page;
    const queryUrl = message.data?.queryUrl;
    if (!page || !queryUrl) return;

    const targetOffset = direction === 'next' ? page.nextOffset : page.prevOffset;
    if (targetOffset === null || targetOffset === undefined) return;

    await fetchPage({
      queryUrl,
      limit: page.limit,
      offset: targetOffset,
      label: direction === 'next' ? 'Próxima página' : 'Página anterior',
      addUserMessage: false,
    });
  };

  const handleExportCsv = async (message: Message) => {
    const queryUrl = message.data?.queryUrl;
    const limit = message.data?.page?.limit || message.data?.rows?.length || 100;
    if (!queryUrl) return;

    await exportCsv({
      queryUrl,
      limit,
      fileName: `export-${conversationId.substring(0, 8)}-${new Date().toISOString().split('T')[0]}.csv`,
    });
  };

  // Removido formatMessage - agora usamos MarkdownRenderer

  return (
    <div className="flex flex-col h-full min-h-0">
      <Card className="flex flex-col h-full min-h-0 overflow-hidden border-0 shadow-none bg-transparent">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border-light bg-background">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-xl font-bold text-foreground leading-tight">Assfac IA</h2>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowHistory(true)}
              disabled={isLoading}
              className="text-muted-foreground hover:text-foreground hover:bg-muted"
              title="Ver histórico de conversas"
            >
              <History className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Histórico</span>
            </Button>
            {messages.length > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleExport}
                  disabled={isLoading}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted"
                  title="Exportar conversa"
                >
                  <Download className="h-4 w-4 mr-2" />
                  <span className="hidden sm:inline">Exportar</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearMessages}
                  disabled={isLoading}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted"
                  title="Limpar conversa atual"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  <span className="hidden sm:inline">Limpar</span>
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 min-h-0 overflow-hidden bg-background">
          <ScrollArea className="h-full" ref={scrollAreaRef}>
            <div className="space-y-5 px-6 py-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
                <h3 className="text-2xl font-bold text-foreground mb-2">Bem-vindo ao Assfac IA</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  Faça perguntas sobre dados financeiros e operacionais do sistema
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  isLoading={isLoading}
                  onPageRequest={handlePageRequest}
                  onExportCsv={handleExportCsv}
                />
              ))
            )}
            {isLoading && (
              <div className="flex items-start gap-3 animate-in fade-in duration-200">
                <div className="flex-shrink-0 w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center border border-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="bg-muted/80 rounded-xl p-4 inline-flex items-center gap-3 shadow-sm border border-border-light">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">Processando...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
        </div>

        {/* Error Display */}
        {error && (
          <div className="px-6 py-3 bg-destructive/10 border-t border-destructive/20">
            <p className="text-sm text-destructive font-medium">{error}</p>
          </div>
        )}

        {/* Input Area */}
        <div className="px-6 py-5 border-t border-border-light bg-background">
          <UiRenderErrorBoundary
            scope="ai-copilot/PlaceholdersAndVanishInput"
            action="submit-question"
            resetKey={isLoading ? "loading" : "idle"}
          >
            <PlaceholdersAndVanishInput
              placeholders={placeholders}
              onChange={handleChange}
              onSubmit={handleSubmit}
              disabled={isLoading}
            />
          </UiRenderErrorBoundary>
        </div>
      </Card>

      {/* Dialog de Histórico */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Histórico de Conversas</DialogTitle>
            <DialogDescription>
              Selecione uma conversa anterior para continuar ou visualizar o histórico.
            </DialogDescription>
          </DialogHeader>
          <ConversationHistory
            onSelectConversation={handleSelectConversation}
            onClose={() => setShowHistory(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface MessageBubbleProps {
  message: Message;
  isLoading: boolean;
  onPageRequest: (message: Message, direction: 'next' | 'prev') => void;
  onExportCsv: (message: Message) => void;
}

function MessageBubble({ message, isLoading, onPageRequest, onExportCsv }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const hasTable = !isUser && message.data?.rows?.length;

  return (
    <div className={`flex items-start gap-3 animate-in fade-in slide-in-from-bottom-4 duration-300 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center border ${
        isUser 
          ? 'bg-primary text-primary-foreground border-primary/20 shadow-sm' 
          : 'bg-primary/10 text-primary border-primary/10'
      }`}>
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className={`flex-1 ${isUser ? 'text-right' : ''}`}>
        <div
          className={`inline-block rounded-xl p-4 max-w-[85%] sm:max-w-[75%] shadow-sm border ${
            isUser
              ? 'bg-primary text-primary-foreground border-primary/20'
              : 'bg-muted/80 text-foreground border-border-light'
          }`}
        >
          {isUser ? (
            <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </div>
          ) : (
            <>
              <MarkdownRenderer content={message.content} className="text-sm leading-relaxed" />
              {hasTable ? (
                <div className="mt-4">
                  <ResultTable
                    rows={message.data?.rows || []}
                    columns={message.data?.columns || []}
                    page={message.data?.page || null}
                    rowCount={message.data?.rowCount || 0}
                    isLoading={isLoading}
                    onNext={message.data?.page?.hasMore ? () => onPageRequest(message, 'next') : undefined}
                    onPrev={message.data?.page && message.data.page.prevOffset !== null && message.data.page.prevOffset !== undefined
                      ? () => onPageRequest(message, 'prev')
                      : undefined}
                    onExport={() => onExportCsv(message)}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
        <p className={`text-xs text-muted-foreground mt-2 ${isUser ? 'text-right' : 'text-left'}`}>
          {message.timestamp.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>
    </div>
  );
}
