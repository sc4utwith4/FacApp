// ============================================
// PARSERS - MÓDULO COBRANÇA BANCÁRIA
// ============================================

import type { EventoCobrancaInsert, TituloCobrancaInsert, OrigemEvento } from "@/types/cobranca-bancaria";

type XlsxModule = typeof import("xlsx");
let xlsxModulePromise: Promise<XlsxModule> | null = null;

async function loadXlsxModule(): Promise<XlsxModule> {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import("xlsx").then((module) => {
      return ("default" in module && module.default ? module.default : module) as XlsxModule;
    });
  }
  return xlsxModulePromise;
}

export interface ParsedTitulo {
  identificador_interno?: string;
  nosso_numero?: string;
  seu_numero?: string;
  sacado_nome?: string;
  sacado_documento?: string;
  valor_nominal: number;
  vencimento: string;
  data_emissao?: string;
  status_atual: string;
  tags?: string[];
  cliente_codigo?: string;
  registrado_banco: boolean;
}

export interface ParsedEvento {
  tipo_evento: string;
  data_evento: string;
  data_referencia?: string;
  codigo_banco?: string;
  descricao_banco?: string;
  valor_principal: number;
  juros: number;
  multa: number;
  desconto: number;
  abatimento: number;
  tarifa: number;
  valor_liquido: number;
  nosso_numero?: string;
  seu_numero?: string;
  identificador?: string;
}

export interface ParseResult {
  titulos: ParsedTitulo[];
  eventos: ParsedEvento[];
  errors: string[];
  warnings: string[];
}

/**
 * Parse uma planilha Excel (formato da planilha atual)
 */
export async function parsePlanilhaExcel(file: File): Promise<ParseResult> {
  const result: ParseResult = {
    titulos: [],
    eventos: [],
    errors: [],
    warnings: [],
  };

  try {
    const XLSX = await loadXlsxModule();
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });

    // Processar cada aba da planilha
    workbook.SheetNames.forEach((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

      if (sheetName === "Diversas" || sheetName.toLowerCase().includes("diversas")) {
        // Processar aba "Diversas" - fila de ocorrências
        parseAbaDiversas(data, result);
      } else if (sheetName === "Fechamento" || sheetName.toLowerCase().includes("fechamento")) {
        // Processar aba "Fechamento" - fechamento diário
        parseAbaFechamento(data, result);
      } else {
        // Tentar processar como títulos/eventos
        parseAbaTitulos(data, result);
      }
    });
  } catch (error) {
    result.errors.push(`Erro ao processar planilha: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
  }

  return result;
}

/**
 * Parse aba "Diversas" - fila de ocorrências
 */
function parseAbaDiversas(data: unknown[][], result: ParseResult) {
  if (data.length < 2) return;

  // Assumir primeira linha como cabeçalho
  const headers = (data[0] as string[]).map((h) => h?.toString().toLowerCase().trim() || "");
  const dataIndex = headers.findIndex((h) => h.includes("data"));
  const idIndex = headers.findIndex((h) => h.includes("id") || h.includes("identificador"));
  const acaoIndex = headers.findIndex((h) => h.includes("acao") || h.includes("ação"));
  const statusIndex = headers.findIndex((h) => h.includes("status"));
  const valorIndex = headers.findIndex((h) => h.includes("valor"));
  const tagIndex = headers.findIndex((h) => h.includes("tag"));

  for (let i = 1; i < data.length; i++) {
    const row = data[i] as unknown[];
    if (!row || row.length === 0) continue;

    const evento: ParsedEvento = {
      tipo_evento: "AJUSTE_MANUAL",
      data_evento: new Date().toISOString(),
      valor_principal: 0,
      juros: 0,
      multa: 0,
      desconto: 0,
      abatimento: 0,
      tarifa: 0,
      valor_liquido: 0,
    };

    if (dataIndex >= 0 && row[dataIndex]) {
      const dataStr = row[dataIndex]?.toString();
      if (dataStr) {
        try {
          evento.data_evento = new Date(dataStr).toISOString();
        } catch {
          // Ignorar erro de data
        }
      }
    }

    if (idIndex >= 0 && row[idIndex]) {
      evento.identificador = row[idIndex]?.toString();
      evento.nosso_numero = row[idIndex]?.toString();
    }

    if (acaoIndex >= 0 && row[acaoIndex]) {
      evento.descricao_banco = row[acaoIndex]?.toString();
    }

    if (statusIndex >= 0 && row[statusIndex]) {
      // Mapear status para tipo de evento
      const status = row[statusIndex]?.toString().toUpperCase();
      if (status.includes("BAIXADO")) {
        evento.tipo_evento = "BAIXA";
      } else if (status.includes("PROTESDADO") || status.includes("PROTESTO")) {
        evento.tipo_evento = "PROTESTO";
      }
    }

    if (valorIndex >= 0 && row[valorIndex]) {
      const valor = parseFloat(row[valorIndex]?.toString().replace(/[^\d,.-]/g, "").replace(",", ".") || "0");
      evento.valor_principal = valor;
      evento.valor_liquido = valor;
    }

    result.eventos.push(evento);
  }
}

/**
 * Parse aba "Fechamento" - fechamento diário
 */
function parseAbaFechamento(data: unknown[][], result: ParseResult) {
  // Esta aba é principalmente informativa para validação
  // Os dados de fechamento serão gerados automaticamente
  result.warnings.push("Aba 'Fechamento' detectada. Use a funcionalidade de fechamento automático do sistema.");
}

/**
 * Parse aba genérica de títulos
 */
function parseAbaTitulos(data: unknown[][], result: ParseResult) {
  if (data.length < 2) return;

  const headers = (data[0] as string[]).map((h) => h?.toString().toLowerCase().trim() || "");

  for (let i = 1; i < data.length; i++) {
    const row = data[i] as unknown[];
    if (!row || row.length === 0) continue;

    try {
      const titulo: ParsedTitulo = {
        valor_nominal: 0,
        vencimento: new Date().toISOString().split("T")[0],
        status_atual: "ABERTO",
        registrado_banco: true,
      };

      // Tentar mapear campos comuns
      headers.forEach((header, index) => {
        const value = row[index]?.toString().trim();
        if (!value) return;

        if (header.includes("identificador") || header.includes("id")) {
          titulo.identificador_interno = value;
        } else if (header.includes("nosso") && header.includes("numero")) {
          titulo.nosso_numero = value;
        } else if (header.includes("seu") && header.includes("numero")) {
          titulo.seu_numero = value;
        } else if (header.includes("sacado") || header.includes("nome")) {
          titulo.sacado_nome = value;
        } else if (header.includes("documento") || header.includes("cpf") || header.includes("cnpj")) {
          titulo.sacado_documento = value;
        } else if (header.includes("valor")) {
          titulo.valor_nominal = parseFloat(value.replace(/[^\d,.-]/g, "").replace(",", ".") || "0");
        } else if (header.includes("vencimento") || header.includes("venc")) {
          try {
            const date = new Date(value);
            if (!isNaN(date.getTime())) {
              titulo.vencimento = date.toISOString().split("T")[0];
            }
          } catch {
            // Ignorar erro de data
          }
        } else if (header.includes("status")) {
          titulo.status_atual = value.toUpperCase();
        } else if (header.includes("tag")) {
          titulo.tags = value.split(",").map((t) => t.trim());
        } else if (header.includes("cliente") || header.includes("codigo")) {
          titulo.cliente_codigo = value;
        }
      });

      if (titulo.valor_nominal > 0) {
        result.titulos.push(titulo);
      }
    } catch (error) {
      result.errors.push(`Erro ao processar linha ${i + 1}: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
    }
  }
}

/**
 * Parse um arquivo PDF (relatório do banco)
 * Nota: Esta é uma implementação básica. Para parsing completo de PDF,
 * será necessário usar uma biblioteca como pdf-parse ou pdfjs-dist
 */
export async function parsePDF(file: File): Promise<ParseResult> {
  const result: ParseResult = {
    titulos: [],
    eventos: [],
    errors: [],
    warnings: [],
  };

  try {
    // Por enquanto, retornamos um aviso
    // Para implementação completa, seria necessário:
    // 1. Instalar biblioteca de parsing de PDF (ex: pdf-parse, pdfjs-dist)
    // 2. Extrair texto do PDF
    // 3. Usar regex ou parsing estruturado para identificar títulos e eventos
    // 4. Mapear para os tipos ParsedTitulo e ParsedEvento

    result.warnings.push(
      "Parsing de PDF ainda não está completamente implementado. " +
      "Por favor, use arquivos Excel ou entre os dados manualmente."
    );

    // TODO: Implementar parsing real de PDF
    // Exemplo de estrutura esperada:
    // - Extrair texto do PDF
    // - Identificar padrões de títulos (nosso número, valor, vencimento)
    // - Identificar eventos (liquidações, baixas, etc.)
    // - Mapear para ParsedTitulo e ParsedEvento

  } catch (error) {
    result.errors.push(`Erro ao processar PDF: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
  }

  return result;
}

/**
 * Converte ParsedTitulo para TituloCobrancaInsert
 */
export function convertParsedTitulo(
  parsed: ParsedTitulo,
  empresaId: string,
  origem: OrigemEvento
): TituloCobrancaInsert {
  return {
    empresa_id: empresaId,
    identificador_interno: parsed.identificador_interno,
    nosso_numero: parsed.nosso_numero,
    seu_numero: parsed.seu_numero,
    sacado_nome: parsed.sacado_nome,
    sacado_documento: parsed.sacado_documento,
    sacado_contato: {},
    valor_nominal: parsed.valor_nominal,
    vencimento: parsed.vencimento,
    data_emissao: parsed.data_emissao,
    status_atual: (parsed.status_atual || "ABERTO") as any,
    tags: parsed.tags || [],
    cliente_codigo: parsed.cliente_codigo,
    registrado_banco: parsed.registrado_banco,
    carteira_id: null,
    operacao_id: null,
  };
}

/**
 * Converte ParsedEvento para EventoCobrancaInsert
 */
export function convertParsedEvento(
  parsed: ParsedEvento,
  tituloId: string,
  origem: OrigemEvento
): EventoCobrancaInsert {
  return {
    titulo_id: tituloId,
    carteira_id: null,
    tipo_evento: (parsed.tipo_evento || "AJUSTE_MANUAL") as any,
    data_evento: parsed.data_evento,
    data_referencia: parsed.data_referencia,
    codigo_banco: parsed.codigo_banco,
    descricao_banco: parsed.descricao_banco,
    valor_principal: parsed.valor_principal,
    juros: parsed.juros,
    multa: parsed.multa,
    desconto: parsed.desconto,
    abatimento: parsed.abatimento,
    tarifa: parsed.tarifa,
    valor_liquido: parsed.valor_liquido,
    origem: origem as any,
    conciliado: false,
    confianca_conciliacao: 0,
    observacoes: null,
  };
}
