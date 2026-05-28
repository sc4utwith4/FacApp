// ============================================
// CÁLCULO DE LIQUIDAÇÃO - COBRANÇA BANCÁRIA
// ============================================

export interface ParametrosLiquidacao {
  valor_nominal: number;
  data_vencimento: string;
  data_liquidacao: string;
  regras_juros_multa?: {
    juros_diario?: number; // Percentual diário (ex: 0.033 = 0.033% ao dia)
    multa_atraso?: number; // Percentual fixo (ex: 2 = 2%)
    desconto_antecipacao?: number; // Percentual fixo (ex: 1 = 1%)
  };
  tarifa_bancaria?: number; // Valor fixo ou percentual
  comissao_factoring?: number; // Percentual sobre o principal
  percentual_repasse?: number; // Percentual do principal a repassar ao cliente
}

export interface ResultadoLiquidacao {
  valor_principal: number;
  juros: number;
  multa: number;
  desconto: number;
  tarifa: number;
  comissao: number;
  repasse_cliente: number;
  valor_liquido: number;
  dias_atraso?: number;
  dias_antecipacao?: number;
}

/**
 * Calcula os valores de liquidação de um título
 */
export function calcularLiquidacao(
  parametros: ParametrosLiquidacao
): ResultadoLiquidacao {
  const {
    valor_nominal,
    data_vencimento,
    data_liquidacao,
    regras_juros_multa = {},
    tarifa_bancaria = 0,
    comissao_factoring = 0,
    percentual_repasse = 100,
  } = parametros;

  const vencimento = new Date(data_vencimento);
  const liquidacao = new Date(data_liquidacao);
  const diffDias = Math.floor(
    (liquidacao.getTime() - vencimento.getTime()) / (1000 * 60 * 60 * 24)
  );

  let juros = 0;
  let multa = 0;
  let desconto = 0;
  let dias_atraso: number | undefined;
  let dias_antecipacao: number | undefined;

  // Calcular juros e multa (se atrasado)
  if (diffDias > 0) {
    dias_atraso = diffDias;
    const jurosDiario = regras_juros_multa.juros_diario || 0;
    juros = valor_nominal * (jurosDiario / 100) * diffDias;

    const multaAtraso = regras_juros_multa.multa_atraso || 0;
    multa = valor_nominal * (multaAtraso / 100);
  }
  // Calcular desconto (se antecipado)
  else if (diffDias < 0) {
    dias_antecipacao = Math.abs(diffDias);
    const descontoAntecipacao = regras_juros_multa.desconto_antecipacao || 0;
    desconto = valor_nominal * (descontoAntecipacao / 100);
  }

  // Calcular tarifa bancária (fixa ou percentual)
  let tarifa = 0;
  if (tarifa_bancaria > 0) {
    // Se tarifa_bancaria < 1, assume-se que é percentual
    // Se tarifa_bancaria >= 1, assume-se que é valor fixo
    if (tarifa_bancaria < 1) {
      tarifa = valor_nominal * tarifa_bancaria;
    } else {
      tarifa = tarifa_bancaria;
    }
  }

  // Calcular comissão da factoring
  const comissao = valor_nominal * (comissao_factoring / 100);

  // Calcular repasse ao cliente
  const repasse_cliente = valor_nominal * (percentual_repasse / 100);

  // Calcular valor líquido
  // Valor líquido = principal + juros + multa - desconto - tarifa - comissão
  const valor_liquido =
    valor_nominal + juros + multa - desconto - tarifa - comissao;

  return {
    valor_principal: valor_nominal,
    juros,
    multa,
    desconto,
    tarifa,
    comissao,
    repasse_cliente,
    valor_liquido: Math.max(0, valor_liquido), // Garantir que não seja negativo
    dias_atraso,
    dias_antecipacao,
  };
}

/**
 * Valida os parâmetros de liquidação
 */
export function validarParametrosLiquidacao(
  parametros: ParametrosLiquidacao
): { valido: boolean; erros: string[] } {
  const erros: string[] = [];

  if (parametros.valor_nominal <= 0) {
    erros.push("Valor nominal deve ser maior que zero");
  }

  if (!parametros.data_vencimento) {
    erros.push("Data de vencimento é obrigatória");
  }

  if (!parametros.data_liquidacao) {
    erros.push("Data de liquidação é obrigatória");
  }

  if (parametros.data_vencimento && parametros.data_liquidacao) {
    const vencimento = new Date(parametros.data_vencimento);
    const liquidacao = new Date(parametros.data_liquidacao);

    if (isNaN(vencimento.getTime())) {
      erros.push("Data de vencimento inválida");
    }

    if (isNaN(liquidacao.getTime())) {
      erros.push("Data de liquidação inválida");
    }
  }

  if (parametros.regras_juros_multa) {
    if (
      parametros.regras_juros_multa.juros_diario !== undefined &&
      parametros.regras_juros_multa.juros_diario < 0
    ) {
      erros.push("Juros diário não pode ser negativo");
    }

    if (
      parametros.regras_juros_multa.multa_atraso !== undefined &&
      parametros.regras_juros_multa.multa_atraso < 0
    ) {
      erros.push("Multa de atraso não pode ser negativa");
    }

    if (
      parametros.regras_juros_multa.desconto_antecipacao !== undefined &&
      parametros.regras_juros_multa.desconto_antecipacao < 0
    ) {
      erros.push("Desconto de antecipação não pode ser negativo");
    }
  }

  if (parametros.comissao_factoring < 0 || parametros.comissao_factoring > 100) {
    erros.push("Comissão da factoring deve estar entre 0% e 100%");
  }

  if (parametros.percentual_repasse < 0 || parametros.percentual_repasse > 100) {
    erros.push("Percentual de repasse deve estar entre 0% e 100%");
  }

  return {
    valido: erros.length === 0,
    erros,
  };
}

