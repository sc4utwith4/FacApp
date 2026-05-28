// ============================================
// VALIDAÇÃO DE RELATÓRIO BANCO PDF
// Compara dados do PDF com fechamento do sistema
// ============================================

import { supabase } from "@/integrations/supabase/client";
import type {
  RelatorioBancoPDF,
  ResultadoValidacao,
  FechamentoDiario,
} from "@/types/relatorio-banco-pdf";

/**
 * Valida relatório bancário contra fechamento do sistema
 * Zero tolerância: qualquer diferença é considerada divergência
 */
export async function validarRelatorioBanco(
  relatorioId: string,
  fechamentoId: string
): Promise<ResultadoValidacao> {
  const resultado: ResultadoValidacao = {
    validado: true,
    divergencia_valor: 0,
    divergencia_qtd: 0,
    divergencias_detalhadas: [],
  };

  try {
    // Buscar relatório
    const { data: relatorio, error: relatorioError } = await supabase
      .from("relatorios_banco_pdf")
      .select("*")
      .eq("id", relatorioId)
      .single();

    if (relatorioError || !relatorio) {
      throw new Error(`Relatório não encontrado: ${relatorioError?.message}`);
    }

    // Buscar fechamento
    const { data: fechamento, error: fechamentoError } = await supabase
      .from("fechamentos_diarios")
      .select("*")
      .eq("id", fechamentoId)
      .single();

    if (fechamentoError || !fechamento) {
      throw new Error(`Fechamento não encontrado: ${fechamentoError?.message}`);
    }

    // Comparar campos principais (zero tolerância)
    const comparacoes = [
      {
        campo: "Saldo Anterior - Quantidade",
        valor_pdf: relatorio.saldo_anterior_qtd || 0,
        valor_sistema: fechamento.saldo_anterior_qtd || 0,
      },
      {
        campo: "Saldo Anterior - Valor",
        valor_pdf: Number(relatorio.saldo_anterior_valor || 0),
        valor_sistema: Number(fechamento.saldo_anterior_valor || 0),
      },
      {
        campo: "Entradas - Quantidade",
        valor_pdf: relatorio.saldo_entradas_qtd || 0,
        valor_sistema: fechamento.entradas_qtd || 0,
      },
      {
        campo: "Entradas - Valor",
        valor_pdf: Number(relatorio.saldo_entradas_valor || 0),
        valor_sistema: Number(fechamento.entradas_valor || 0),
      },
      {
        campo: "Baixas - Quantidade",
        valor_pdf: relatorio.saldo_baixas_qtd || 0,
        valor_sistema: fechamento.baixas_qtd || 0,
      },
      {
        campo: "Baixas - Valor",
        valor_pdf: Number(relatorio.saldo_baixas_valor || 0),
        valor_sistema: Number(fechamento.baixas_valor || 0),
      },
      {
        campo: "Saldo Atual - Quantidade",
        valor_pdf: relatorio.saldo_atual_qtd || 0,
        valor_sistema: fechamento.saldo_atual_qtd || 0,
      },
      {
        campo: "Saldo Atual - Valor",
        valor_pdf: Number(relatorio.saldo_atual_valor || 0),
        valor_sistema: Number(fechamento.saldo_atual_valor || 0),
      },
    ];

    // Calcular divergências
    let divergenciaValorTotal = 0;
    let divergenciaQtdTotal = 0;

    for (const comparacao of comparacoes) {
      const diferenca = Math.abs(comparacao.valor_pdf - comparacao.valor_sistema);
      
      // Zero tolerância: qualquer diferença é divergência
      if (diferenca > 0) {
        resultado.validado = false;
        resultado.divergencias_detalhadas.push({
          campo: comparacao.campo,
          valor_pdf: comparacao.valor_pdf,
          valor_sistema: comparacao.valor_sistema,
          diferenca: diferenca,
        });

        // Acumular divergências
        if (comparacao.campo.includes("Valor")) {
          divergenciaValorTotal += diferenca;
        } else if (comparacao.campo.includes("Quantidade")) {
          divergenciaQtdTotal += Math.abs(diferenca);
        }
      }
    }

    resultado.divergencia_valor = divergenciaValorTotal;
    resultado.divergencia_qtd = divergenciaQtdTotal;

    // Atualizar relatório com resultado da validação
    const { data: { user } } = await supabase.auth.getUser();
    
    await supabase
      .from("relatorios_banco_pdf")
      .update({
        validado_contra_fechamento: resultado.validado,
        divergencia_valor: resultado.divergencia_valor,
        divergencia_qtd: resultado.divergencia_qtd,
        divergencias_detalhadas: resultado.divergencias_detalhadas,
        validado_em: new Date().toISOString(),
        validado_por: user?.id || null,
        status: resultado.validado ? "validado" : "extraido",
      })
      .eq("id", relatorioId);

    // Atualizar fechamento também
    await supabase
      .from("fechamentos_diarios")
      .update({
        validado_contra_banco: resultado.validado,
        divergencia_valor: resultado.divergencia_valor,
      })
      .eq("id", fechamentoId);

  } catch (error) {
    throw new Error(
      `Erro ao validar relatório: ${error instanceof Error ? error.message : "Erro desconhecido"}`
    );
  }

  return resultado;
}

