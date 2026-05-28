import type { SupabaseClient } from '@supabase/supabase-js';
import {
    getBankReconciliationChatIntegrationSecret,
    getBankReconciliationChatWebhookUrl,
    getBankReconciliationAgentWebhookUrl,
    getBankReconciliationAgentIntegrationSecret
} from '../_shared.js';
import type { ChatIntentKind } from './intentRouter.js';
import type {
    ChatAiProcessingStatus,
    ChatLastExecutionSummary,
    ChatReconciliationPlan,
    ChatSuggestedNextAction,
} from '../../../types/bank-reconciliation.js';

export interface AgentResponse {
    message: string;
    suggestedIntent?: ChatIntentKind;
    suggestedParameters?: Record<string, any>;
    confidence: number;
}

export interface AgentContext {
    empresa_id: string;
    conta_bancaria_id: string;
    data: string;
    data_referencia?: string;
    import_id?: string | null;
    extrato_import_id?: string | null;
    session_id?: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    summary?: any; // Resumo diário
    pending_items_count: number;
    ai_processing_status?: ChatAiProcessingStatus | null;
    last_execution_summary?: ChatLastExecutionSummary | null;
    reconciliation_plan?: ChatReconciliationPlan | null;
    suggested_next_actions?: ChatSuggestedNextAction[] | null;
}

/**
 * Camada de Agente de Conciliação Bancária.
 * Atua como o "cérebro" que decide como responder ao usuário ou qual ferramenta chamar.
 */
export class BankReconciliationAgent {
    private supabase: SupabaseClient;

    constructor(supabase: SupabaseClient) {
        this.supabase = supabase;
    }

    /**
     * Dispara o Agente em modo assíncrono (fire-and-forget).
     * O n8n processará e fará callback para /api/bank-statement/chat/webhook.
     */
    triggerAsync(message: string, context: AgentContext): void {
        const webhookUrl = getBankReconciliationAgentWebhookUrl();
        const secret = getBankReconciliationAgentIntegrationSecret();

        if (!webhookUrl || !secret) {
            console.warn('Agent webhook nao configurado; triggerAsync ignorado.');
            return;
        }

        fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-integration-secret': secret,
            },
            body: JSON.stringify({
                source: 'bank_reconciliation_chat',
                message,
                context: {
                    ...context,
                    data_referencia: context.data_referencia || context.data,
                    extrato_import_id: context.extrato_import_id ?? context.import_id ?? null,
                    timestamp: new Date().toISOString(),
                },
            }),
        }).catch((err) => {
            console.error('Agent triggerAsync failed:', err);
        });
    }

    /**
     * Processa uma mensagem do usuário usando o Agente (via n8n ou LLM direto).
     */
    async think(message: string, context: AgentContext): Promise<AgentResponse> {
        const webhookUrl = getBankReconciliationAgentWebhookUrl();
        const secret = getBankReconciliationAgentIntegrationSecret();

        try {
            // Por enquanto, delegamos para o n8n que terá a inteligência conversacional
            // No futuro (Etapa 2), isso pode evoluir para Tool Calling local
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-integration-secret': secret,
                },
                body: JSON.stringify({
                    source: 'bank_reconciliation_chat', // Alinhado com o n8n
                    message,
                    context: {
                        ...context,
                        data_referencia: context.data_referencia || context.data,
                        extrato_import_id: context.extrato_import_id ?? context.import_id ?? null,
                        timestamp: new Date().toISOString(),
                    },
                }),
            });

            if (!response.ok) {
                throw new Error(`Agent thinking failed: ${response.statusText}`);
            }

            const data = await response.json();

            return {
                message: data.message || "Entendido. Como posso ajudar com a conciliação hoje?",
                suggestedIntent: data.suggestedIntent as ChatIntentKind,
                suggestedParameters: data.suggestedParameters,
                confidence: data.confidence || 0.8,
            };
        } catch (error) {
            console.error('Error in BankReconciliationAgent.think:', error);
            return {
                message: "Estou tendo um pouco de dificuldade para processar isso agora, mas posso tentar ajudar com as ferramentas de conciliação padrão.",
                confidence: 0,
            };
        }
    }
}
