// ============================================
// PARSER PDF BRADESCO - POSIÇÃO DE CARTEIRA
// ============================================

import type {
  PDFBradescoParsed,
} from "@/types/relatorio-banco-pdf";

type PdfJsModule = typeof import("pdfjs-dist");
let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

async function loadPdfJsModule(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist").then((module) => {
      const resolvedModule =
        ("default" in module && module.default ? module.default : module) as PdfJsModule;
      resolvedModule.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${resolvedModule.version}/build/pdf.worker.min.mjs`;
      return resolvedModule;
    });
  }
  return pdfJsModulePromise;
}

/**
 * Extrai número de uma string, removendo formatação
 */
function extrairNumero(texto: string): number {
  if (!texto) return 0;
  // Remove tudo exceto dígitos, vírgula e ponto
  const limpo = texto.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  return parseFloat(limpo) || 0;
}

/**
 * Extrai quantidade (número inteiro) de uma string
 */
function extrairQuantidade(texto: string): number {
  if (!texto) return 0;
  const limpo = texto.replace(/[^\d]/g, "");
  return parseInt(limpo, 10) || 0;
}

/**
 * Extrai percentual de uma string
 */
function extrairPercentual(texto: string): number {
  if (!texto) return 0;
  const limpo = texto.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  return parseFloat(limpo) || 0;
}

/**
 * Formata data do formato brasileiro para ISO
 */
function formatarData(dataStr: string): string {
  if (!dataStr) return "";
  // Tenta formatos: DD/MM/YYYY, DD-MM-YYYY, etc.
  const match = dataStr.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (match) {
    const [, dia, mes, ano] = match;
    return `${ano}-${mes}-${dia}`;
  }
  return dataStr;
}

/**
 * Extrai hora do formato HH:MM
 */
function formatarHora(horaStr: string): string {
  if (!horaStr) return "";
  const match = horaStr.match(/(\d{2}):(\d{2})/);
  if (match) {
    return horaStr;
  }
  return horaStr;
}

/**
 * Parse do PDF do Bradesco - Posição de Carteira
 */
export async function parsePDFBradesco(file: File): Promise<PDFBradescoParsed> {
  const pdfjsLib = await loadPdfJsModule();
  const result: PDFBradescoParsed = {
    dados_consulta: {
      agencia: "",
      conta: "",
      beneficiario_nome: "",
      beneficiario_razao: "",
      data_operacao: "",
      hora_operacao: "",
    },
    posicao_carteira: {
      saldo_anterior: { qtd: 0, valor: 0 },
      saldo_entradas: { qtd: 0, valor: 0 },
      saldo_baixas: { qtd: 0, valor: 0 },
      saldo_atual: { qtd: 0, valor: 0 },
      registrados_mes: { qtd: 0, valor: 0 },
      registrados_mes_anterior: { qtd: 0, valor: 0 },
      acumulados_pagos_mes: { qtd: 0, valor: 0 },
      acumulados_nao_pagos_mes: { qtd: 0, valor: 0 },
      acumulados_pagos_compensacao_mes: { qtd: 0, valor: 0 },
      pagos_mes_anterior: { qtd: 0, valor: 0 },
      pagos_compensacao_mes_anterior: { qtd: 0, valor: 0 },
      titulos_instrucao_protesto: { qtd: 0, valor: 0 },
      titulos_poder_cartorio: { qtd: 0, valor: 0 },
    },
    indice_liquidez: {
      diaria_percent: 0,
      mensal_percent: 0,
    },
    erros: [],
    warnings: [],
  };

  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    // Extrair texto de todas as páginas
    // Processar de forma assíncrona para não bloquear a UI
    let texto = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(" ");
      texto += pageText + "\n";
      
      // Yield ao event loop para permitir atualizações da UI
      // Isso evita que a tela congele durante o processamento
      // Usar um pequeno delay (10ms) para garantir que o React tenha tempo de atualizar
      if (i < pdf.numPages) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    // Extrair Dados da Consulta
    const dadosConsultaMatch = texto.match(/Agência\|Conta:\s*(\d+)\s*\|\s*(\d+)/i);
    if (dadosConsultaMatch) {
      result.dados_consulta.agencia = dadosConsultaMatch[1];
      result.dados_consulta.conta = dadosConsultaMatch[2];
    }

    const beneficiarioMatch = texto.match(/Nome do beneficiário:\s*([^\n]+)/i);
    if (beneficiarioMatch) {
      result.dados_consulta.beneficiario_nome = beneficiarioMatch[1].trim();
    }

    const razaoMatch = texto.match(/Razão:\s*(\d+)/i);
    if (razaoMatch) {
      result.dados_consulta.beneficiario_razao = razaoMatch[1];
    }

    const dataOperacaoMatch = texto.match(/Data da operação:\s*(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i);
    if (dataOperacaoMatch) {
      result.dados_consulta.data_operacao = formatarData(dataOperacaoMatch[1]);
    }

    const horaOperacaoMatch = texto.match(/(\d{2}:\d{2})/);
    if (horaOperacaoMatch && texto.indexOf("Data da operação") < texto.indexOf(horaOperacaoMatch[1])) {
      result.dados_consulta.hora_operacao = formatarHora(horaOperacaoMatch[1]);
    }

    // Extrair Posição de Carteira
    // Procurar pela tabela "Posição de Carteira"
    const posicaoCarteiraRegex = /Posição de Carteira[\s\S]*?Quantidade\s*Valor\s*\(R\$\)([\s\S]*?)(?:Índice|SAC|Ouvidoria)/i;
    const posicaoMatch = texto.match(posicaoCarteiraRegex);

    if (posicaoMatch) {
      const tabelaTexto = posicaoMatch[1];

      // Saldo anterior
      const saldoAnteriorMatch = tabelaTexto.match(/Saldo anterior\s+(\d+)\s+([\d.,]+)/i);
      if (saldoAnteriorMatch) {
        result.posicao_carteira.saldo_anterior.qtd = extrairQuantidade(saldoAnteriorMatch[1]);
        result.posicao_carteira.saldo_anterior.valor = extrairNumero(saldoAnteriorMatch[2]);
      }

      // Saldo entradas
      const saldoEntradasMatch = tabelaTexto.match(/Saldo entradas\s+(\d+)\s+([\d.,]+)/i);
      if (saldoEntradasMatch) {
        result.posicao_carteira.saldo_entradas.qtd = extrairQuantidade(saldoEntradasMatch[1]);
        result.posicao_carteira.saldo_entradas.valor = extrairNumero(saldoEntradasMatch[2]);
      }

      // Saldo baixas
      const saldoBaixasMatch = tabelaTexto.match(/Saldo baixas\s+(\d+)\s+([\d.,]+)/i);
      if (saldoBaixasMatch) {
        result.posicao_carteira.saldo_baixas.qtd = extrairQuantidade(saldoBaixasMatch[1]);
        result.posicao_carteira.saldo_baixas.valor = extrairNumero(saldoBaixasMatch[2]);
      }

      // Saldo atual
      const saldoAtualMatch = tabelaTexto.match(/Saldo atual\s+(\d+)\s+([\d.,]+)/i);
      if (saldoAtualMatch) {
        result.posicao_carteira.saldo_atual.qtd = extrairQuantidade(saldoAtualMatch[1]);
        result.posicao_carteira.saldo_atual.valor = extrairNumero(saldoAtualMatch[2]);
      }

      // Registrados mês
      const registradosMesMatch = tabelaTexto.match(/Registrados mês\s+(\d+)\s+([\d.,]+)/i);
      if (registradosMesMatch) {
        result.posicao_carteira.registrados_mes.qtd = extrairQuantidade(registradosMesMatch[1]);
        result.posicao_carteira.registrados_mes.valor = extrairNumero(registradosMesMatch[2]);
      }

      // Registrados mês anterior
      const registradosMesAnteriorMatch = tabelaTexto.match(/Registrados mês anterior\s+(\d+)\s+([\d.,]+)/i);
      if (registradosMesAnteriorMatch) {
        result.posicao_carteira.registrados_mes_anterior.qtd = extrairQuantidade(registradosMesAnteriorMatch[1]);
        result.posicao_carteira.registrados_mes_anterior.valor = extrairNumero(registradosMesAnteriorMatch[2]);
      }

      // Acumulados pagos no mês
      const acumuladosPagosMesMatch = tabelaTexto.match(/Acumulados pagos no mês\s+(\d+)\s+([\d.,]+)/i);
      if (acumuladosPagosMesMatch) {
        result.posicao_carteira.acumulados_pagos_mes.qtd = extrairQuantidade(acumuladosPagosMesMatch[1]);
        result.posicao_carteira.acumulados_pagos_mes.valor = extrairNumero(acumuladosPagosMesMatch[2]);
      }

      // Acumulados não pagos no mês
      const acumuladosNaoPagosMesMatch = tabelaTexto.match(/Acumulados não pagos no mês\s+(\d+)\s+([\d.,]+)/i);
      if (acumuladosNaoPagosMesMatch) {
        result.posicao_carteira.acumulados_nao_pagos_mes.qtd = extrairQuantidade(acumuladosNaoPagosMesMatch[1]);
        result.posicao_carteira.acumulados_nao_pagos_mes.valor = extrairNumero(acumuladosNaoPagosMesMatch[2]);
      }

      // Acumulados pagos compensação no mês
      const acumuladosPagosCompensacaoMesMatch = tabelaTexto.match(/Acumulados pagos compensação no mês\s+(\d+)\s+([\d.,]+)/i);
      if (acumuladosPagosCompensacaoMesMatch) {
        result.posicao_carteira.acumulados_pagos_compensacao_mes.qtd = extrairQuantidade(acumuladosPagosCompensacaoMesMatch[1]);
        result.posicao_carteira.acumulados_pagos_compensacao_mes.valor = extrairNumero(acumuladosPagosCompensacaoMesMatch[2]);
      }

      // Pagos mês anterior
      const pagosMesAnteriorMatch = tabelaTexto.match(/Pagos mês anterior\s+(\d+)\s+([\d.,]+)/i);
      if (pagosMesAnteriorMatch) {
        result.posicao_carteira.pagos_mes_anterior.qtd = extrairQuantidade(pagosMesAnteriorMatch[1]);
        result.posicao_carteira.pagos_mes_anterior.valor = extrairNumero(pagosMesAnteriorMatch[2]);
      }

      // Pagos compensação mês anterior
      const pagosCompensacaoMesAnteriorMatch = tabelaTexto.match(/Pagos compensação mês anterior\s+(\d+)\s+([\d.,]+)/i);
      if (pagosCompensacaoMesAnteriorMatch) {
        result.posicao_carteira.pagos_compensacao_mes_anterior.qtd = extrairQuantidade(pagosCompensacaoMesAnteriorMatch[1]);
        result.posicao_carteira.pagos_compensacao_mes_anterior.valor = extrairNumero(pagosCompensacaoMesAnteriorMatch[2]);
      }

      // Títulos com instrução de protesto
      const titulosProtestoMatch = tabelaTexto.match(/Títulos com instrução de protesto\s+(\d+)\s+([\d.,]+)/i);
      if (titulosProtestoMatch) {
        result.posicao_carteira.titulos_instrucao_protesto.qtd = extrairQuantidade(titulosProtestoMatch[1]);
        result.posicao_carteira.titulos_instrucao_protesto.valor = extrairNumero(titulosProtestoMatch[2]);
      }

      // Títulos em poder do cartório
      const titulosCartorioMatch = tabelaTexto.match(/Títulos em poder do cartório\s+(\d+)\s+([\d.,]+)/i);
      if (titulosCartorioMatch) {
        result.posicao_carteira.titulos_poder_cartorio.qtd = extrairQuantidade(titulosCartorioMatch[1]);
        result.posicao_carteira.titulos_poder_cartorio.valor = extrairNumero(titulosCartorioMatch[2]);
      }
    } else {
      result.warnings.push("Não foi possível encontrar a tabela 'Posição de Carteira' no PDF");
    }

    // Extrair Índice Liquidez
    const liquidezMatch = texto.match(/Índice Liquidez[\s\S]*?Diária sobre a data[\s\S]*?base:\s*([\d.,]+)%[\s\S]*?Mensal sobre os[\s\S]*?vencimentos do mês:\s*([\d.,]+)%/i);
    if (liquidezMatch) {
      result.indice_liquidez.diaria_percent = extrairPercentual(liquidezMatch[1]);
      result.indice_liquidez.mensal_percent = extrairPercentual(liquidezMatch[2]);
    } else {
      // Tentar padrão alternativo
      const liquidezAltMatch = texto.match(/Diária sobre a data[\s\S]*?base:\s*([\d.,]+)%[\s\S]*?Mensal sobre os[\s\S]*?vencimentos do mês:\s*([\d.,]+)%/i);
      if (liquidezAltMatch) {
        result.indice_liquidez.diaria_percent = extrairPercentual(liquidezAltMatch[1]);
        result.indice_liquidez.mensal_percent = extrairPercentual(liquidezAltMatch[2]);
      } else {
        result.warnings.push("Não foi possível extrair o Índice de Liquidez do PDF");
      }
    }

    // Validações
    if (!result.dados_consulta.agencia || !result.dados_consulta.conta) {
      result.warnings.push("Agência/Conta não encontrada no PDF");
    }

    if (!result.dados_consulta.beneficiario_nome) {
      result.warnings.push("Nome do beneficiário não encontrado no PDF");
    }

    if (result.posicao_carteira.saldo_atual.qtd === 0 && result.posicao_carteira.saldo_atual.valor === 0) {
      result.warnings.push("Saldo atual não foi extraído corretamente - verifique o PDF");
    }

  } catch (error) {
    result.erros.push(
      `Erro ao processar PDF: ${error instanceof Error ? error.message : "Erro desconhecido"}`
    );
  }

  return result;
}
