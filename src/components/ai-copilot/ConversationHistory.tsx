import { useState, useEffect } from 'react';
import { useAICopilotConversations, type Conversation } from '@/hooks/useAICopilotConversations';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, MessageSquare, Trash2, Download, X } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ConversationHistoryProps {
  onSelectConversation: (conversationId: string) => void;
  onClose: () => void;
}

export function ConversationHistory({ onSelectConversation, onClose }: ConversationHistoryProps) {
  const { conversations, isLoading, error, loadConversations, deleteConversation } = useAICopilotConversations();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const handleDelete = async (conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm('Tem certeza que deseja excluir esta conversa?')) {
      return;
    }

    setDeletingId(conversationId);
    try {
      await deleteConversation(conversationId);
    } catch (err) {
      console.error('Error deleting conversation:', err);
      alert('Erro ao excluir conversa. Tente novamente.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleExport = (conversation: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const data = {
      title: conversation.title || 'Conversa sem título',
      conversationId: conversation.conversation_id,
      createdAt: conversation.created_at,
      lastMessageAt: conversation.last_message_at,
      messageCount: conversation.message_count,
      messages: conversation.messages,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversa-${conversation.conversation_id.substring(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="flex flex-col h-full max-h-[600px]">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">Histórico de Conversas</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-destructive">
            <p className="text-sm">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadConversations()}
              className="mt-4"
            >
              Tentar Novamente
            </Button>
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-sm">Nenhuma conversa salva ainda.</p>
            <p className="text-xs mt-2">Suas conversas serão salvas automaticamente.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                className="p-3 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => onSelectConversation(conversation.conversation_id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm truncate">
                      {conversation.title || 'Conversa sem título'}
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      {conversation.message_count} mensagem{conversation.message_count !== 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(conversation.last_message_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => handleExport(conversation, e)}
                      className="h-8 w-8 p-0"
                      title="Exportar conversa"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => handleDelete(conversation.conversation_id, e)}
                      disabled={deletingId === conversation.conversation_id}
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      title="Excluir conversa"
                    >
                      {deletingId === conversation.conversation_id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </Card>
  );
}

