import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ensureUUID, isConflictError } from "@/lib/uuid";
import { useState, useEffect } from "react";

export default function SeedData() {
  const [loading, setLoading] = useState(false);
  const [autoInsert, setAutoInsert] = useState(false);
  const [empresaId, setEmpresaId] = useState<string | null>(null);

  useEffect(() => {
    const fetchEmpresaId = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const { data: profile, error } = await supabase
            .from("profiles")
            .select("empresa_id")
            .eq("id", session.user.id)
            .maybeSingle();
          
          if (error) {
            if (process.env.NODE_ENV === 'development') {
              console.error("Erro ao buscar empresa_id:", error);
            }
            return;
          }
          
          // Se perfil não existe, criar automaticamente
          if (!profile) {
            const empresaIdPadrao = '00000000-0000-0000-0000-000000000001';
            const nomeUsuario = session.user.user_metadata?.nome || session.user.email?.split('@')[0] || 'Usuário';
            
            const { error: insertError } = await supabase
              .from("profiles")
              .insert({
                id: session.user.id,
                empresa_id: empresaIdPadrao,
                nome: nomeUsuario,
                email: session.user.email || '',
                perfil: 'Admin',
              });
            
            if (insertError) {
              // Se o erro for 409 (Conflict), o perfil já existe, então buscar novamente
              if (isConflictError(insertError)) {
                // Perfil já existe, buscar novamente
                const { data: existingProfile } = await supabase
                  .from("profiles")
                  .select("empresa_id")
                  .eq("id", session.user.id)
                  .maybeSingle();
                
                if (existingProfile && existingProfile.empresa_id) {
                  const empresaIdValue = ensureUUID(existingProfile.empresa_id);
                  if (empresaIdValue) {
                    setEmpresaId(empresaIdValue);
                    return;
                  }
                }
              } else {
                if (process.env.NODE_ENV === 'development') {
                  console.error("Erro ao criar perfil:", insertError);
                }
                toast.error("Erro ao criar perfil. Entre em contato com o administrador.");
                return;
              }
            } else {
              // Após criar, buscar novamente
              const { data: newProfile } = await supabase
                .from("profiles")
                .select("empresa_id")
                .eq("id", session.user.id)
                .maybeSingle();
              
              if (newProfile && newProfile.empresa_id) {
                const empresaIdValue = ensureUUID(newProfile.empresa_id);
                if (empresaIdValue) {
                  setEmpresaId(empresaIdValue);
                  return;
                }
              }
              return;
            }
          }
          
          // Se perfil existe, validar empresa_id
          if (profile.empresa_id) {
            const empresaIdValue = ensureUUID(profile.empresa_id);
            if (empresaIdValue) {
              setEmpresaId(empresaIdValue);
              if (process.env.NODE_ENV === 'development') {
                console.log('empresaId definido em SeedData:', empresaIdValue, 'tipo:', typeof empresaIdValue);
              }
            } else {
              if (process.env.NODE_ENV === 'development') {
                console.error('empresa_id não é UUID válido:', profile.empresa_id, typeof profile.empresa_id);
              }
            }
          }
        }
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error("Erro ao buscar empresa_id:", error);
        }
      }
    };
    fetchEmpresaId();
  }, []);

  const insertGruposContas = async () => {
    if (!empresaId) {
      toast.error("Erro: Empresa não encontrada. Faça login novamente.");
      return;
    }
    const grupos = [
      // Entradas
      { nome: 'Vendas de Produtos', natureza: 'entrada' },
      { nome: 'Vendas de Serviços', natureza: 'entrada' },
      { nome: 'Receitas Financeiras', natureza: 'entrada' },
      { nome: 'Outras Receitas', natureza: 'entrada' },
      // Saídas
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
      
      if (error && !error.message.includes('duplicate')) {
        console.error('Erro ao inserir grupo:', error);
      }
    }
  };

  const insertContasBancarias = async () => {
    if (!empresaId) {
      toast.error("Erro: Empresa não encontrada. Faça login novamente.");
      return;
    }

    const contas = [
      { banco_id: 1, agencia: '1234-5', conta: '12345-6', descricao: 'Conta Corrente Principal - BB', saldo_inicial: 15000.00 },
      { banco_id: 2, agencia: '4567-8', conta: '98765-4', descricao: 'Conta Corrente - CEF', saldo_inicial: 8500.00 },
      { banco_id: 3, agencia: '7890-1', conta: '54321-0', descricao: 'Conta Corrente - Bradesco', saldo_inicial: 12000.00 }
    ];

    for (const conta of contas) {
      const { error } = await supabase
        .from('contas_bancarias')
        .insert({ empresa_id: empresaId, ...conta });
      
      if (error && !error.message.includes('duplicate')) {
        console.error('Erro ao inserir conta:', error);
      }
    }
  };

  const insertLancamentos = async () => {
    if (!empresaId) {
      toast.error("Erro: Empresa não encontrada. Faça login novamente.");
      return;
    }

    // Buscar IDs dos grupos e contas (filtrar por empresa)
    const { data: grupos } = await supabase.from('grupos_contas').select('id, nome, natureza').eq('empresa_id', empresaId);
    const { data: contas } = await supabase.from('contas_bancarias').select('id, descricao').eq('empresa_id', empresaId);
    
    const gruposMap = {};
    grupos?.forEach(g => {
      gruposMap[g.nome] = g.id;
    });
    
    const contasMap = {};
    contas?.forEach(c => {
      contasMap[c.descricao] = c.id;
    });

    const hoje = new Date().toISOString().split('T')[0];
    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const anteontem = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

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
      
      if (error && !error.message.includes('duplicate')) {
        console.error('Erro ao inserir lançamento:', error);
      }
    }
  };

  const handleSeedData = async () => {
    setLoading(true);
    try {
      await insertGruposContas();
      toast.success('Grupos de contas inseridos!');
      
      await insertContasBancarias();
      toast.success('Contas bancárias inseridas!');
      
      await insertLancamentos();
      toast.success('Lançamentos inseridos!');
      
      toast.success('✅ Dados de exemplo inseridos com sucesso!');
    } catch (error) {
      toast.error('Erro ao inserir dados: ' + error);
    } finally {
      setLoading(false);
    }
  };

  // Executar inserção automática se ativada
  useEffect(() => {
    if (autoInsert) {
      handleSeedData();
    }
  }, [autoInsert]);

  return (
    <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inserir Dados de Exemplo</h1>
          <p className="text-muted-foreground">
            Esta página insere dados fictícios para demonstrar o sistema
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Dados que serão inseridos:</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Grupos de Contas:</h3>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Vendas de Produtos (entrada)</li>
                <li>• Vendas de Serviços (entrada)</li>
                <li>• Receitas Financeiras (entrada)</li>
                <li>• Outras Receitas (entrada)</li>
                <li>• Fornecedores (saída)</li>
                <li>• Salários e Encargos (saída)</li>
                <li>• Aluguel e Condomínio (saída)</li>
                <li>• Energia e Telefone (saída)</li>
                <li>• Marketing e Publicidade (saída)</li>
                <li>• Combustível e Transporte (saída)</li>
                <li>• Manutenção e Reparos (saída)</li>
                <li>• Impostos e Taxas (saída)</li>
                <li>• Outras Despesas (saída)</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Contas Bancárias:</h3>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Conta Corrente Principal - BB (R$ 15.000,00)</li>
                <li>• Conta Corrente - CEF (R$ 8.500,00)</li>
                <li>• Conta Corrente - Bradesco (R$ 12.000,00)</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Lançamentos de Caixa:</h3>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• 6 lançamentos de entrada (vendas, serviços, receitas)</li>
                <li>• 13 lançamentos de saída (fornecedores, salários, despesas)</li>
                <li>• Dados distribuídos nos últimos dias</li>
              </ul>
            </div>

            <div className="space-y-3">
              <Button 
                onClick={handleSeedData} 
                disabled={loading}
                className="w-full"
              >
                {loading ? 'Inserindo dados...' : 'Inserir Dados de Exemplo'}
              </Button>
              
              <Button 
                onClick={() => setAutoInsert(!autoInsert)} 
                variant="outline"
                className="w-full"
              >
                {autoInsert ? 'Desativar' : 'Ativar'} Inserção Automática
              </Button>
              
              {autoInsert && (
                <div className="text-sm text-muted-foreground text-center">
                  ⚠️ A inserção automática executará ao carregar a página
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
  );
}
