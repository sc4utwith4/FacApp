// ============================================
// GERADOR DE FECHAMENTO DIÁRIO - COBRANÇA BANCÁRIA
// ============================================

import { supabase } from "@/integrations/supabase/client";
import type { FechamentoDiario, FechamentoDiarioInsert, IndicadoresFechamento } from "@/types/cobranca-bancaria";

export interface FechamentoCalculado {
  saldo_anterior: {
    qtd: number;
    valor: number;
  };
  entradas: {
    qtd: number;
    valor: number;
  };
  baixas: {
    qtd: number;
    valor: number;
  };
  saldo_atual: {
    qtd: number;
    valor: number;
  };
  indicadores: IndicadoresFechamento;
}

/**
 * Calcula os valores do fechamento diário
 */
export async function calcularFechamentoDiario(
  data: string,
  empresaId: string
): Promise<FechamentoCalculado> {
  // 1. Calcular saldo anterior (último fechamento ou títulos abertos até a data)
  const dataAnterior = new Date(data);
  dataAnterior.setDate(dataAnterior.getDate() - 1);
  const dataAnteriorStr = dataAnterior.toISOString().split("T")[0];

  // Buscar último fechamento
  const { data: ultimoFechamento } = await supabase
    .from("fechamentos_diarios")
    .select("*")
    .eq("empresa_id", empresaId)
    .lte("data_fechamento", dataAnteriorStr)
    .order("data_fechamento", { ascending: false })
    .limit(1)
    .maybeSingle();

  let saldoAnteriorQtd = 0;
  let saldoAnteriorValor = 0;

  if (ultimoFechamento) {
    saldoAnteriorQtd = ultimoFechamento.saldo_atual_qtd;
    saldoAnteriorValor = ultimoFechamento.saldo_atual_valor;
  } else {
    // Se não há fechamento anterior, contar títulos abertos até a data
    const { count: qtdAbertos, data: titulosAbertos } = await supabase
      .from("titulos_cobranca")
      .select("valor_nominal", { count: "exact", head: false })
      .eq("empresa_id", empresaId)
      .in("status_atual", ["ABERTO", "PROTESTO_INSTRUIDO", "EM_CARTORIO"])
      .lte("created_at", `${data}T23:59:59`);

    saldoAnteriorQtd = qtdAbertos || 0;
    saldoAnteriorValor =
      titulosAbertos?.reduce((acc, t) => acc + Number(t.valor_nominal || 0), 0) || 0;
  }

  // 2. Calcular entradas do dia (títulos criados na data)
  const { count: entradasQtd, data: titulosEntrada } = await supabase
    .from("titulos_cobranca")
    .select("valor_nominal", { count: "exact", head: false })
    .eq("empresa_id", empresaId)
    .gte("created_at", `${data}T00:00:00`)
    .lt("created_at", `${data}T23:59:59`);

  const entradasValor =
    titulosEntrada?.reduce((acc, t) => acc + Number(t.valor_nominal || 0), 0) || 0;

  // 3. Calcular baixas do dia (eventos de liquidação/baixa na data)
  const { data: eventosBaixa } = await supabase
    .from("eventos_cobranca")
    .select("valor_liquido, titulo_id")
    .in("tipo_evento", ["LIQUIDACAO", "BAIXA"])
    .gte("data_evento", `${data}T00:00:00`)
    .lt("data_evento", `${data}T23:59:59`);

  const baixasQtd = eventosBaixa?.length || 0;
  const baixasValor =
    eventosBaixa?.reduce((acc, e) => acc + Number(e.valor_liquido || 0), 0) || 0;

  // 4. Calcular saldo atual (títulos abertos no final do dia)
  const { count: saldoAtualQtd, data: titulosAbertos } = await supabase
    .from("titulos_cobranca")
    .select("valor_nominal", { count: "exact", head: false })
    .eq("empresa_id", empresaId)
    .in("status_atual", ["ABERTO", "PROTESTO_INSTRUIDO", "EM_CARTORIO"]);

  const saldoAtualValor =
    titulosAbertos?.reduce((acc, t) => acc + Number(t.valor_nominal || 0), 0) || 0;

  // 5. Calcular indicadores
  const { count: titulosCartorio } = await supabase
    .from("titulos_cobranca")
    .select("*", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .eq("status_atual", "EM_CARTORIO");

  const { count: titulosProtesto } = await supabase
    .from("titulos_cobranca")
    .select("*", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .eq("status_atual", "PROTESTO_INSTRUIDO");

  const { data: titulosCartorioData } = await supabase
    .from("titulos_cobranca")
    .select("valor_nominal")
    .eq("empresa_id", empresaId)
    .eq("status_atual", "EM_CARTORIO");

  const valorCartorio =
    titulosCartorioData?.reduce((acc, t) => acc + Number(t.valor_nominal || 0), 0) || 0;

  const { data: titulosProtestoData } = await supabase
    .from("titulos_cobranca")
    .select("valor_nominal")
    .eq("empresa_id", empresaId)
    .eq("status_atual", "PROTESTO_INSTRUIDO");

  const valorProtesto =
    titulosProtestoData?.reduce((acc, t) => acc + Number(t.valor_nominal || 0), 0) || 0;

  // Calcular liquidez (percentual de títulos liquidados no período)
  const liquidez =
    saldoAnteriorQtd > 0
      ? ((baixasQtd / (saldoAnteriorQtd + entradasQtd)) * 100) || 0
      : 0;

  const indicadores: IndicadoresFechamento = {
    liquidez: Math.round(liquidez * 100) / 100,
    titulos_cartorio: titulosCartorio || 0,
    valor_cartorio: valorCartorio,
    titulos_protesto: titulosProtesto || 0,
    valor_protesto: valorProtesto,
  };

  return {
    saldo_anterior: {
      qtd: saldoAnteriorQtd,
      valor: saldoAnteriorValor,
    },
    entradas: {
      qtd: entradasQtd || 0,
      valor: entradasValor,
    },
    baixas: {
      qtd: baixasQtd,
      valor: baixasValor,
    },
    saldo_atual: {
      qtd: saldoAtualQtd || 0,
      valor: saldoAtualValor,
    },
    indicadores,
  };
}

/**
 * Gera e salva um fechamento diário
 */
export async function gerarFechamentoDiario(
  data: string,
  empresaId: string
): Promise<FechamentoDiario> {
  // Verificar se já existe fechamento para a data
  // Garantir que a data está no formato ISO (YYYY-MM-DD)
  const dataISO = data instanceof Date ? data.toISOString().split("T")[0] : data;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataISO)) {
    throw new Error(`Formato de data inválido: ${data}. Use YYYY-MM-DD`);
  }

  const { data: fechamentoExistente, error: fechamentoError } = await supabase
    .from("fechamentos_diarios")
    .select("*")
    .eq("empresa_id", empresaId)
    .eq("data_fechamento", dataISO)
    .maybeSingle();

  if (fechamentoError && fechamentoError.code !== "PGRST116") {
    throw new Error(`Erro ao verificar fechamento existente: ${fechamentoError.message}`);
  }

  if (fechamentoExistente) {
    throw new Error(`Já existe um fechamento para a data ${data}`);
  }

  // Calcular valores
  const calculado = await calcularFechamentoDiario(data, empresaId);

  // Criar fechamento
  const fechamentoInsert: FechamentoDiarioInsert = {
    empresa_id: empresaId,
    data_fechamento: data,
    saldo_anterior_qtd: calculado.saldo_anterior.qtd,
    saldo_anterior_valor: calculado.saldo_anterior.valor,
    entradas_qtd: calculado.entradas.qtd,
    entradas_valor: calculado.entradas.valor,
    baixas_qtd: calculado.baixas.qtd,
    baixas_valor: calculado.baixas.valor,
    saldo_atual_qtd: calculado.saldo_atual.qtd,
    saldo_atual_valor: calculado.saldo_atual.valor,
    indicadores: calculado.indicadores,
    validado_contra_banco: false,
    divergencia_valor: 0,
  };

  const { data: fechamento, error } = await supabase
    .from("fechamentos_diarios")
    .insert(fechamentoInsert)
    .select()
    .single();

  if (error) throw error;
  return fechamento;
}

/**
 * Atualiza um fechamento existente (recalcular)
 */
export async function atualizarFechamentoDiario(
  fechamentoId: string,
  empresaId: string
): Promise<FechamentoDiario> {
  // Buscar fechamento
  const { data: fechamento } = await supabase
    .from("fechamentos_diarios")
    .select("*")
    .eq("id", fechamentoId)
    .eq("empresa_id", empresaId)
    .single();

  if (!fechamento) {
    throw new Error("Fechamento não encontrado");
  }

  // Recalcular valores
  const calculado = await calcularFechamentoDiario(
    fechamento.data_fechamento,
    empresaId
  );

  // Atualizar fechamento (preservar confirmação e validação se existir)
  const { data: fechamentoAtualizado, error } = await supabase
    .from("fechamentos_diarios")
    .update({
      saldo_anterior_qtd: calculado.saldo_anterior.qtd,
      saldo_anterior_valor: calculado.saldo_anterior.valor,
      entradas_qtd: calculado.entradas.qtd,
      entradas_valor: calculado.entradas.valor,
      baixas_qtd: calculado.baixas.qtd,
      baixas_valor: calculado.baixas.valor,
      saldo_atual_qtd: calculado.saldo_atual.qtd,
      saldo_atual_valor: calculado.saldo_atual.valor,
      indicadores: calculado.indicadores,
    })
    .eq("id", fechamentoId)
    .select()
    .single();

  if (error) throw error;
  return fechamentoAtualizado;
}

