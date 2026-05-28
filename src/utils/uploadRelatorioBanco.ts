// ============================================
// UPLOAD DE RELATÓRIOS BANCO PDF
// Upload para Supabase Storage com hash e versionamento
// ============================================

import { supabase } from "@/integrations/supabase/client";
import { parsePDFBradesco } from "./parsePDFBradesco";
import { validarRelatorioBanco } from "./validarRelatorioBanco";
import { sanitizarNomeArquivo } from "./sanitizarNomeArquivo";
import type {
  RelatorioBancoPDFInsert,
  PDFBradescoParsed,
} from "@/types/relatorio-banco-pdf";

/**
 * Calcula hash SHA-256 de um arquivo
 */
async function calcularHash(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Trunca texto para um tamanho máximo, retornando null se o texto for null/undefined
 */
function truncarTexto(texto: string | null | undefined, maxLength: number): string | null {
  if (!texto) return null;
  return texto.length > maxLength ? texto.substring(0, maxLength) : texto;
}

export { sanitizarNomeArquivo } from "./sanitizarNomeArquivo";

/**
 * Verifica se já existe um relatório com o mesmo hash
 */
async function verificarDuplicata(hash: string, empresaId: string): Promise<string | null> {
  const { data } = await supabase
    .from("relatorios_banco_pdf")
    .select("id")
    .eq("arquivo_hash", hash)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  return data?.id || null;
}

/**
 * Obtém próxima versão para um fechamento
 */
async function obterProximaVersao(fechamentoId: string): Promise<number> {
  const { data } = await supabase
    .from("relatorios_banco_pdf")
    .select("versao")
    .eq("fechamento_id", fechamentoId)
    .order("versao", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.versao || 0) + 1;
}

/**
 * Obtém ID da versão anterior para um fechamento
 */
async function obterVersaoAnteriorId(fechamentoId: string): Promise<string | null> {
  const { data } = await supabase
    .from("relatorios_banco_pdf")
    .select("id")
    .eq("fechamento_id", fechamentoId)
    .order("versao", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.id || null;
}

/**
 * Faz upload de PDF para Supabase Storage
 */
async function uploadPDFParaStorage(
  file: File,
  empresaId: string,
  fechamentoId: string | null
): Promise<string> {
  const timestamp = Date.now();
  const nomeArquivoSanitizado = sanitizarNomeArquivo(file.name);
  const nomeArquivo = `${timestamp}-${nomeArquivoSanitizado}`;
  const caminho = fechamentoId
    ? `${empresaId}/${fechamentoId}/${nomeArquivo}`
    : `${empresaId}/${nomeArquivo}`;

  const { data, error } = await supabase.storage
    .from("relatorios-banco-pdf")
    .upload(caminho, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    throw new Error(`Erro ao fazer upload: ${error.message}`);
  }

  // Obter URL pública
  const { data: urlData } = supabase.storage
    .from("relatorios-banco-pdf")
    .getPublicUrl(caminho);

  // Verificar se a URL foi gerada corretamente
  if (!urlData?.publicUrl) {
    throw new Error("Erro ao gerar URL pública do arquivo");
  }

  return urlData.publicUrl;
}

/**
 * Converte dados parseados do PDF para formato de inserção
 */
function converterParaInsert(
  parsed: PDFBradescoParsed,
  empresaId: string,
  fechamentoId: string | null,
  bancoId: number | null,
  arquivoNome: string,
  arquivoUrl: string,
  arquivoHash: string,
  arquivoTamanho: number,
  versao: number,
  versaoAnteriorId: string | null,
  uploadedBy: string
): RelatorioBancoPDFInsert {
  const { dados_consulta, posicao_carteira, indice_liquidez } = parsed;

  return {
    empresa_id: empresaId,
    fechamento_id: fechamentoId,
    banco_id: bancoId,
    arquivo_nome: truncarTexto(arquivoNome, 255) || arquivoNome.substring(0, 255),
    arquivo_url: arquivoUrl,
    arquivo_hash: arquivoHash,
    arquivo_tamanho: arquivoTamanho,
    data_upload: new Date().toISOString(),
    uploaded_by: uploadedBy,
    agencia: dados_consulta.agencia || null,
    conta: dados_consulta.conta || null,
    beneficiario_nome: truncarTexto(dados_consulta.beneficiario_nome, 255),
    beneficiario_razao: truncarTexto(dados_consulta.beneficiario_razao, 50),
    data_operacao: dados_consulta.data_operacao || null,
    hora_operacao: dados_consulta.hora_operacao || null,
    saldo_anterior_qtd: posicao_carteira.saldo_anterior.qtd || null,
    saldo_anterior_valor: posicao_carteira.saldo_anterior.valor || null,
    saldo_entradas_qtd: posicao_carteira.saldo_entradas.qtd || null,
    saldo_entradas_valor: posicao_carteira.saldo_entradas.valor || null,
    saldo_baixas_qtd: posicao_carteira.saldo_baixas.qtd || null,
    saldo_baixas_valor: posicao_carteira.saldo_baixas.valor || null,
    saldo_atual_qtd: posicao_carteira.saldo_atual.qtd || null,
    saldo_atual_valor: posicao_carteira.saldo_atual.valor || null,
    registrados_mes_qtd: posicao_carteira.registrados_mes.qtd || null,
    registrados_mes_valor: posicao_carteira.registrados_mes.valor || null,
    registrados_mes_anterior_qtd: posicao_carteira.registrados_mes_anterior.qtd || null,
    registrados_mes_anterior_valor: posicao_carteira.registrados_mes_anterior.valor || null,
    acumulados_pagos_mes_qtd: posicao_carteira.acumulados_pagos_mes.qtd || null,
    acumulados_pagos_mes_valor: posicao_carteira.acumulados_pagos_mes.valor || null,
    acumulados_nao_pagos_mes_qtd: posicao_carteira.acumulados_nao_pagos_mes.qtd || null,
    acumulados_nao_pagos_mes_valor: posicao_carteira.acumulados_nao_pagos_mes.valor || null,
    acumulados_pagos_compensacao_mes_qtd: posicao_carteira.acumulados_pagos_compensacao_mes.qtd || null,
    acumulados_pagos_compensacao_mes_valor: posicao_carteira.acumulados_pagos_compensacao_mes.valor || null,
    pagos_mes_anterior_qtd: posicao_carteira.pagos_mes_anterior.qtd || null,
    pagos_mes_anterior_valor: posicao_carteira.pagos_mes_anterior.valor || null,
    pagos_compensacao_mes_anterior_qtd: posicao_carteira.pagos_compensacao_mes_anterior.qtd || null,
    pagos_compensacao_mes_anterior_valor: posicao_carteira.pagos_compensacao_mes_anterior.valor || null,
    titulos_instrucao_protesto_qtd: posicao_carteira.titulos_instrucao_protesto.qtd || null,
    titulos_instrucao_protesto_valor: posicao_carteira.titulos_instrucao_protesto.valor || null,
    titulos_poder_cartorio_qtd: posicao_carteira.titulos_poder_cartorio.qtd || null,
    titulos_poder_cartorio_valor: posicao_carteira.titulos_poder_cartorio.valor || null,
    liquidez_diaria_percent: indice_liquidez.diaria_percent || null,
    liquidez_mensal_percent: indice_liquidez.mensal_percent || null,
    validado_contra_fechamento: false,
    divergencia_valor: 0,
    divergencia_qtd: 0,
    divergencias_detalhadas: {},
    validado_em: null,
    validado_por: null,
    versao: versao,
    versao_anterior_id: versaoAnteriorId,
    status: parsed.erros.length > 0 ? "erro" : "extraido",
    observacoes: parsed.erros.length > 0 ? parsed.erros.join("; ") : null,
  };
}

/**
 * Upload completo de relatório bancário PDF
 */
export async function uploadRelatorioBanco(
  file: File,
  empresaId: string,
  fechamentoId: string | null,
  bancoId: number | null
): Promise<{ relatorioId: string; parsed: PDFBradescoParsed }> {
  // 1. Calcular hash
  const arquivoHash = await calcularHash(file);

  // 2. Verificar duplicata
  const duplicataId = await verificarDuplicata(arquivoHash, empresaId);
  if (duplicataId) {
    throw new Error("Este arquivo já foi importado anteriormente");
  }

  // 3. Parse do PDF
  const parsed = await parsePDFBradesco(file);

  // 4. Upload para Storage
  const arquivoUrl = await uploadPDFParaStorage(file, empresaId, fechamentoId);

  // 5. Obter versão e versão anterior
  const versao = fechamentoId ? await obterProximaVersao(fechamentoId) : 1;
  const versaoAnteriorId = fechamentoId ? await obterVersaoAnteriorId(fechamentoId) : null;

  // 6. Obter usuário atual
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Usuário não autenticado");
  }

  // 7. Sanitizar nome do arquivo para salvar no banco (deve corresponder ao nome no storage)
  const timestamp = Date.now();
  const nomeArquivoSanitizado = sanitizarNomeArquivo(file.name);
  const nomeArquivoCompleto = `${timestamp}-${nomeArquivoSanitizado}`;

  // 8. Converter para formato de inserção
  const insertData = converterParaInsert(
    parsed,
    empresaId,
    fechamentoId,
    bancoId,
    nomeArquivoCompleto, // Usar nome sanitizado que corresponde ao nome no storage
    arquivoUrl,
    arquivoHash,
    file.size,
    versao,
    versaoAnteriorId,
    user.id
  );

  // 8. Inserir no banco
  const { data: relatorio, error } = await supabase
    .from("relatorios_banco_pdf")
    .insert(insertData)
    .select()
    .single();

  if (error) {
    throw new Error(`Erro ao salvar relatório: ${error.message}`);
  }

  // 9. Se houver fechamento, validar automaticamente
  if (fechamentoId && relatorio) {
    try {
      await validarRelatorioBanco(relatorio.id, fechamentoId);
    } catch (validationError) {
      // Não falhar o upload se a validação falhar
      console.error("Erro na validação automática:", validationError);
    }
  }

  return {
    relatorioId: relatorio.id,
    parsed,
  };
}
