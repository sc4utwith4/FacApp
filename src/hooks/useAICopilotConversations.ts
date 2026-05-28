import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Conversation {
  id: string;
  user_id: string;
  empresa_id: string;
  conversation_id: string;
  title: string | null;
  messages: any[];
  message_count: number;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

export interface UseAICopilotConversationsReturn {
  conversations: Conversation[];
  isLoading: boolean;
  error: string | null;
  loadConversations: () => Promise<void>;
  saveConversation: (conversationId: string, messages: any[], title?: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  loadConversation: (conversationId: string) => Promise<Conversation | null>;
}

export function useAICopilotConversations(): UseAICopilotConversationsReturn {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);

  // Obter usuário atual
  useEffect(() => {
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user || null);
    };

    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const loadConversations = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('ai_copilot_conversations')
        .select('*')
        .eq('user_id', user.id)
        .order('last_message_at', { ascending: false })
        .limit(50);

      if (fetchError) throw fetchError;

      setConversations(data || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro ao carregar conversas';
      setError(errorMessage);
      console.error('Error loading conversations:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  const saveConversation = useCallback(async (
    conversationId: string,
    messages: any[],
    title?: string
  ) => {
    if (!user) return;

    try {
      // Gerar título automático se não fornecido
      const autoTitle = title || generateTitleFromMessages(messages);

      // Buscar empresa_id do usuário
      const { data: profile } = await supabase
        .from('profiles')
        .select('empresa_id')
        .eq('id', user.id)
        .single();

      if (!profile?.empresa_id) {
        throw new Error('Empresa não encontrada para o usuário');
      }

      // Verificar se conversa já existe
      const { data: existing, error: checkError } = await supabase
        .from('ai_copilot_conversations')
        .select('id')
        .eq('user_id', user.id)
        .eq('conversation_id', conversationId)
        .maybeSingle(); // Usar maybeSingle em vez de single para evitar erro 406 se não existir
      
      if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows returned
        console.error('[Conversations] Erro ao verificar conversa existente:', checkError);
        throw checkError;
      }

      // Garantir que messages está no formato JSONB válido
      const messagesJsonb = Array.isArray(messages) ? messages : [];
      
      const conversationData = {
        user_id: user.id,
        empresa_id: profile.empresa_id,
        conversation_id: conversationId,
        title: autoTitle,
        messages: messagesJsonb, // JSONB aceita arrays diretamente
        message_count: messagesJsonb.length,
        last_message_at: new Date().toISOString(),
      };
      
      console.log('[Conversations] Salvando conversa:', {
        conversationId,
        messageCount: messagesJsonb.length,
        hasExisting: !!existing
      });

      if (existing) {
        // Atualizar conversa existente
        const { error: updateError } = await supabase
          .from('ai_copilot_conversations')
          .update(conversationData)
          .eq('id', existing.id)
          .eq('user_id', user.id); // Garantir que só atualiza conversas do próprio usuário

        if (updateError) {
          console.error('[Conversations] Erro ao atualizar conversa:', updateError);
          throw updateError;
        }
      } else {
        // Criar nova conversa
        const { error: insertError } = await supabase
          .from('ai_copilot_conversations')
          .insert(conversationData);

        if (insertError) {
          console.error('[Conversations] Erro ao inserir conversa:', insertError);
          throw insertError;
        }
      }

      // Recarregar lista de conversas
      await loadConversations();
    } catch (err) {
      console.error('Error saving conversation:', err);
      // Não mostrar erro ao usuário, apenas logar
    }
  }, [user, loadConversations]);

  const deleteConversation = useCallback(async (conversationId: string) => {
    if (!user) return;

    try {
      const { error: deleteError } = await supabase
        .from('ai_copilot_conversations')
        .delete()
        .eq('user_id', user.id)
        .eq('conversation_id', conversationId);

      if (deleteError) throw deleteError;

      // Recarregar lista
      await loadConversations();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro ao deletar conversa';
      setError(errorMessage);
      throw err;
    }
  }, [user, loadConversations]);

  const loadConversation = useCallback(async (conversationId: string): Promise<Conversation | null> => {
    if (!user) return null;

    try {
      const { data, error: fetchError } = await supabase
        .from('ai_copilot_conversations')
        .select('*')
        .eq('user_id', user.id)
        .eq('conversation_id', conversationId)
        .single();

      if (fetchError) throw fetchError;

      return data;
    } catch (err) {
      console.error('Error loading conversation:', err);
      return null;
    }
  }, [user]);

  // Carregar conversas quando usuário estiver disponível
  useEffect(() => {
    if (user) {
      loadConversations();
    }
  }, [user, loadConversations]);

  return {
    conversations,
    isLoading,
    error,
    loadConversations,
    saveConversation,
    deleteConversation,
    loadConversation,
  };
}

/**
 * Gera um título automático baseado nas primeiras mensagens
 */
function generateTitleFromMessages(messages: any[]): string {
  if (messages.length === 0) return 'Nova Conversa';

  // Pegar a primeira pergunta do usuário
  const firstUserMessage = messages.find(m => m.role === 'user');
  if (firstUserMessage?.content) {
    const content = firstUserMessage.content.trim();
    // Limitar a 50 caracteres
    if (content.length <= 50) {
      return content;
    }
    return content.substring(0, 47) + '...';
  }

  return 'Nova Conversa';
}

