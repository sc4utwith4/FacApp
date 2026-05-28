import { describe, expect, it } from 'vitest';
import { routeBankChatIntent } from '../intentRouter';

describe('routeBankChatIntent', () => {
  it('detecta intenção de matching e roteia para conciliação canônica', () => {
    const result = routeBankChatIntent('Pode executar matching agora?');
    expect(result.kind).toBe('run_daily_reconciliation');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('detecta intenção de vinculação automática e roteia para conciliar', () => {
    const result = routeBankChatIntent('Executar vinculação automática');
    expect(result.kind).toBe('run_daily_reconciliation');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('detecta intenção de disparar IA e roteia para conciliar', () => {
    const result = routeBankChatIntent('Quero disparar IA do n8n');
    expect(result.kind).toBe('run_daily_reconciliation');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('não confunde "conciliação" com token curto "ia"', () => {
    const result = routeBankChatIntent('Execute a concialição');
    expect(result.kind).not.toBe('trigger_ai');
  });

  it('detecta intenção de atualizar resumo diário', () => {
    const result = routeBankChatIntent('Atualizar resumo do dia');
    expect(result.kind).toBe('refresh_summary');
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('detecta intenção de executar conciliação do dia', () => {
    const result = routeBankChatIntent('Conciliar extrato de hoje');
    expect(result.kind).toBe('run_daily_reconciliation');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('detecta confirmação textual de ação pendente', () => {
    expect(routeBankChatIntent('Confirmo').kind).toBe('confirm_pending_action');
    expect(routeBankChatIntent('Sim, executar').kind).toBe('confirm_pending_action');
  });

  it('detecta cancelamento textual de ação pendente', () => {
    expect(routeBankChatIntent('Cancelar').kind).toBe('cancel_pending_action');
  });

  it('detecta intenção de corrigir pendências', () => {
    const result = routeBankChatIntent('Corrija essas pendências');
    expect(result.kind).toBe('resolve_pending_issues');
  });

  it('detecta follow-up de status da execução', () => {
    expect(routeBankChatIntent('Executou?').kind).toBe('execution_status_query');
    expect(routeBankChatIntent('Deu certo?').kind).toBe('execution_status_query');
  });

  it('detecta follow-up de detalhe da execução', () => {
    expect(routeBankChatIntent('detalhe').kind).toBe('execution_details_query');
    expect(routeBankChatIntent('Me passe um resumo detalhado do que executou').kind).toBe(
      'execution_details_query'
    );
  });

  it('detecta atualização de plano/status da IA', () => {
    expect(routeBankChatIntent('Atualizar plano').kind).toBe('update_plan_status');
  });

  it('detecta intenção de aplicar plano de conciliação', () => {
    const result = routeBankChatIntent('Aplicar plano de conciliação');
    expect(result.kind).toBe('apply_reconciliation_plan');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('detecta intenção de fechar dia', () => {
    const result = routeBankChatIntent('Fechar o dia de hoje');
    expect(result.kind).toBe('daily_close');
  });

  it('detecta intenção de reabrir fechamento do dia', () => {
    const result = routeBankChatIntent('Reabrir fechamento do dia');
    expect(result.kind).toBe('daily_reopen');
  });

  it('mantém pergunta analítica como question', () => {
    const result = routeBankChatIntent('Quais lançamentos pendentes para hoje?');
    expect(result.kind).toBe('question');
  });
});
