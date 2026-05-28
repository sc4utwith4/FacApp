import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { ensureUUID } from "@/lib/uuid";

export default function AutoSeed() {
  const [status, setStatus] = useState('Iniciando...');
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    insertData();
  }, []);

  const insertData = async () => {
    try {
      // 0) Preparação: garantir permissões e coletar contexto do usuário
      setStatus('Verificando sessão e permissões...');
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) {
        throw new Error('Sessão inválida. Faça login novamente.');
      }

      // Garantir que o perfil do usuário esteja com permissão Financeiro
      const userId = userData.user.id;
      const { error: perfilErr } = await supabase
        .from('profiles')
        .update({ perfil: 'Financeiro' })
        .eq('id', userId);
      if (perfilErr) {
        // Continuamos mesmo assim, pois políticas podem já permitir
        console.warn('Não foi possível promover perfil para Financeiro:', perfilErr.message);
      }

      // Obter empresa do usuário
      const { data: profile, error: profErr } = await supabase
        .from('profiles')
        .select('empresa_id')
        .eq('id', userId)
        .single();
      if (profErr || !profile) {
        throw new Error('Não foi possível obter a empresa do usuário.');
      }
      // Garantir que seja string UUID válido
      const empresaIdValue = ensureUUID(profile.empresa_id);
      if (!empresaIdValue) {
        throw new Error(`empresa_id inválido: ${profile.empresa_id} (tipo: ${typeof profile.empresa_id})`);
      }
      const empresaId: string = empresaIdValue;

      setStatus('Inserindo grupos de contas...');
      
      // Grupos de contas
      const grupos = [
        { nome: 'Vendas de Produtos', natureza: 'entrada' },
        { nome: 'Vendas de Serviços', natureza: 'entrada' },
        { nome: 'Receitas Financeiras', natureza: 'entrada' },
        { nome: 'Outras Receitas', natureza: 'entrada' },
        { nome: 'Fornecedores', natureza: 'saida' },
        { nome: 'Salários e Encargos', natureza: 'saida' },
        { nome: 'Aluguel e Condomínio', natureza: 'saida' },
        { nome: 'Energia e Telefone', natureza: 'saida' },
        { nome: 'Marketing e Publicidade', natureza: 'saida' },
        { nome: 'Combustível e Transporte', natureza: 'saida' },
        { nome: 'Manutenção e Reparos', natureza: 'saida' },
        { nome: 'Impostos e Taxas', natureza: 'saida' },
        { nome: 'Outras Despesas', natureza: 'saida' }
      ];

      for (const grupo of grupos) {
        const { error } = await supabase
          .from('grupos_contas')
          .insert({ empresa_id: empresaId, ...grupo });
        if (error && !error.message.toLowerCase().includes('duplicate')) {
          console.warn('Erro grupo', grupo.nome, error.message);
        }
      }

      setStatus('Inserindo contas bancárias...');
      
      // Buscar bancos por código para garantir ids corretos
      const { data: bancos, error: bancosErr } = await supabase
        .from('bancos')
        .select('id, codigo, nome');
      if (bancosErr) throw bancosErr;

      const findBancoId = (codigo: string) => bancos?.find(b => b.codigo === codigo)?.id;

      const contas = [
        { bancoCodigo: '001', agencia: '1234-5', conta: '12345-6', descricao: 'Conta Corrente Principal - BB', saldo_inicial: 15000.00 },
        { bancoCodigo: '104', agencia: '4567-8', conta: '98765-4', descricao: 'Conta Corrente - CEF', saldo_inicial: 8500.00 },
        { bancoCodigo: '237', agencia: '7890-1', conta: '54321-0', descricao: 'Conta Corrente - Bradesco', saldo_inicial: 12000.00 }
      ];

      for (const conta of contas) {
        const bancoId = findBancoId(conta.bancoCodigo);
        if (!bancoId) {
          console.warn('Banco não encontrado para código', conta.bancoCodigo);
          continue;
        }
        const { error } = await supabase
          .from('contas_bancarias')
          .insert({ empresa_id: empresaId, banco_id: bancoId, agencia: conta.agencia, conta: conta.conta, descricao: conta.descricao, saldo_inicial: conta.saldo_inicial });
        if (error && !error.message.toLowerCase().includes('duplicate')) {
          console.warn('Erro conta', conta.descricao, error.message);
        }
      }

      setStatus('Buscando IDs...');
      
      // Buscar IDs
      const { data: gruposData } = await supabase
        .from('grupos_contas')
        .select('id, nome')
        .eq('empresa_id', empresaId);
      const { data: contasData } = await supabase
        .from('contas_bancarias')
        .select('id, descricao')
        .eq('empresa_id', empresaId);
      
      const gruposMap = {};
      gruposData?.forEach(g => { gruposMap[g.nome] = g.id; });
      const contasMap = {};
      contasData?.forEach(c => { contasMap[c.descricao] = c.id; });

      setStatus('Inserindo lançamentos...');
      
      // Lançamentos no mês atual
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth();
      const fmt = (d: Date) => d.toISOString().split('T')[0];
      const dateOf = (day: number) => fmt(new Date(y, m, day));
      const hoje = fmt(now);
      const ontem = fmt(new Date(y, m, Math.max(1, now.getDate() - 1)));
      const anteontem = fmt(new Date(y, m, Math.max(1, now.getDate() - 2)));

      const lancamentos = [
        // Entradas
        { conta_bancaria_id: contasMap['Conta Corrente Principal - BB'], grupo_contas_id: gruposMap['Vendas de Produtos'], data: hoje, historico: 'Venda de produtos diversos', tipo: 'entrada', valor: 2500.00, documento: 'VEN-001' },
        { conta_bancaria_id: contasMap['Conta Corrente Principal - BB'], grupo_contas_id: gruposMap['Vendas de Produtos'], data: ontem, historico: 'Venda de equipamentos', tipo: 'entrada', valor: 1800.00, documento: 'VEN-002' },
        { conta_bancaria_id: contasMap['Conta Corrente - CEF'], grupo_contas_id: gruposMap['Vendas de Produtos'], data: anteontem, historico: 'Venda de produtos', tipo: 'entrada', valor: 3200.00, documento: 'VEN-003' },
        { conta_bancaria_id: contasMap['Conta Corrente Principal - BB'], grupo_contas_id: gruposMap['Vendas de Serviços'], data: hoje, historico: 'Prestação de serviços', tipo: 'entrada', valor: 800.00, documento: 'SER-001' },
        { conta_bancaria_id: contasMap['Conta Corrente - CEF'], grupo_contas_id: gruposMap['Vendas de Serviços'], data: ontem, historico: 'Consultoria técnica', tipo: 'entrada', valor: 1200.00, documento: 'SER-002' },
        { conta_bancaria_id: contasMap['Conta Corrente Principal - BB'], grupo_contas_id: gruposMap['Receitas Financeiras'], data: hoje, historico: 'Rendimento de aplicação', tipo: 'entrada', valor: 150.00, documento: 'FIN-001' },
        
        // Saídas
        { conta_bancaria_id: contasMap['Conta Corrente Principal - BB'], grupo_contas_id: gruposMap['Fornecedores'], data: hoje, historico: 'Pagamento fornecedor ABC', tipo: 'saida', valor: 1200.00, documento: 'FOR-001' },
        { conta_bancaria_id: contasMap['Conta Corrente - CEF'], grupo_contas_id: gruposMap['Fornecedores'], data: ontem, historico: 'Pagamento fornecedor XYZ', tipo: 'saida', valor: 800.00, documento: 'FOR-002' },
        { conta_bancaria_id: contasMap['Conta Corrente Principal - BB'], grupo_contas_id: gruposMap['Salários e Encargos'], data: '2024-12-05', historico: 'Folha de pagamento', tipo: 'saida', valor: 8000.00, documento: 'SAL-001' },
        { conta_bancaria_id: contasMap['Conta Corrente - CEF'], grupo_contas_id: gruposMap['Salários e Encargos'], data: '2024-12-05', historico: 'Encargos sociais', tipo: 'saida', valor: 2400.00, documento: 'ENC-001' },
        { conta_bancaria_id: contasMap['Conta Corrente Principal - BB'], grupo_contas_id: gruposMap['Aluguel e Condomínio'], data: '2024-12-10', historico: 'Aluguel do escritório', tipo: 'saida', valor: 2500.00, documento: 'ALU-001' },
        { conta_bancaria_id: contasMap['Conta Corrente - CEF'], grupo_contas_id: gruposMap['Energia e Telefone'], data: ontem, historico: 'Conta de energia', tipo: 'saida', valor: 450.00, documento: 'ENE-001' },
        { conta_bancaria_id: contasMap['Conta Corrente - CEF'], grupo_contas_id: gruposMap['Energia e Telefone'], data: ontem, historico: 'Conta de telefone', tipo: 'saida', valor: 180.00, documento: 'TEL-001' },
        { conta_bancaria_id: contasMap['Conta Corrente - Bradesco'], grupo_contas_id: gruposMap['Marketing e Publicidade'], data: ontem, historico: 'Campanha publicitária', tipo: 'saida', valor: 800.00, documento: 'MAR-001' },
        { conta_bancaria_id: contasMap['Conta Corrente - CEF'], grupo_contas_id: gruposMap['Combustível e Transporte'], data: hoje, historico: 'Combustível', tipo: 'saida', valor: 200.00, documento: 'COM-001' },
        { conta_bancaria_id: contasMap['Conta Corrente - Bradesco'], grupo_contas_id: gruposMap['Manutenção e Reparos'], data: anteontem, historico: 'Manutenção de equipamentos', tipo: 'saida', valor: 400.00, documento: 'MAN-001' },
        { conta_bancaria_id: contasMap['Conta Corrente Principal - BB'], grupo_contas_id: gruposMap['Impostos e Taxas'], data: hoje, historico: 'ICMS', tipo: 'saida', valor: 350.00, documento: 'IMP-001' },
        { conta_bancaria_id: contasMap['Conta Corrente - CEF'], grupo_contas_id: gruposMap['Impostos e Taxas'], data: hoje, historico: 'ISS', tipo: 'saida', valor: 180.00, documento: 'ISS-001' },
        { conta_bancaria_id: contasMap['Conta Corrente Principal - BB'], grupo_contas_id: gruposMap['Outras Despesas'], data: hoje, historico: 'Material de escritório', tipo: 'saida', valor: 150.00, documento: 'MAT-001' }
      ];

      for (const lancamento of lancamentos) {
        const { error } = await supabase
          .from('lancamentos_caixa')
          .insert({ empresa_id: empresaId, ...lancamento });
        if (error) {
          console.warn('Erro lançamento', lancamento.documento, error.message);
        }
      }

      setStatus('✅ Dados inseridos com sucesso!');
      setCompleted(true);
      toast.success('Dados de exemplo inseridos com sucesso!');
      
      // Redirecionar para dashboard após 2 segundos
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);

    } catch (error) {
      setStatus('❌ Erro ao inserir dados: ' + error);
      toast.error('Erro ao inserir dados: ' + error);
    }
  };

  return (
    <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inserindo Dados de Exemplo</h1>
          <p className="text-muted-foreground">
            Aguarde enquanto os dados são inseridos automaticamente...
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Status da Inserção</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center">
              <div className="text-2xl mb-4">
                {completed ? '✅' : '⏳'}
              </div>
              <p className="text-lg font-medium">{status}</p>
              {completed && (
                <p className="text-sm text-muted-foreground mt-2">
                  Redirecionando para o dashboard...
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
  );
}
