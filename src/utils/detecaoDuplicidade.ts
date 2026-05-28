// ============================================
// DETECÇÃO DE DUPLICIDADE - COBRANÇA BANCÁRIA
// ============================================

import { supabase } from "@/integrations/supabase/client";
import type { TituloCobranca } from "@/types/cobranca-bancaria";

export interface DuplicidadeDetectada {
  titulo1: TituloCobranca;
  titulo2: TituloCobranca;
  tipo: "identificador_interno" | "nosso_numero" | "chave_composta";
  confianca: number; // 0-100
}

/**
 * Detecta duplicidades em títulos de cobrança
 */
export async function detectarDuplicidades(
  empresaId: string
): Promise<DuplicidadeDetectada[]> {
  const duplicidades: DuplicidadeDetectada[] = [];

  // 1. Buscar títulos com mesmo identificador_interno
  const { data: titulosPorIdInterno } = await supabase
    .from("titulos_cobranca")
    .select("*")
    .eq("empresa_id", empresaId)
    .not("identificador_interno", "is", null);

  if (titulosPorIdInterno) {
    const gruposPorIdInterno = new Map<string, TituloCobranca[]>();
    titulosPorIdInterno.forEach((titulo) => {
      const id = titulo.identificador_interno!;
      if (!gruposPorIdInterno.has(id)) {
        gruposPorIdInterno.set(id, []);
      }
      gruposPorIdInterno.get(id)!.push(titulo);
    });

    gruposPorIdInterno.forEach((grupo, idInterno) => {
      if (grupo.length > 1) {
        // Comparar todos os pares
        for (let i = 0; i < grupo.length; i++) {
          for (let j = i + 1; j < grupo.length; j++) {
            duplicidades.push({
              titulo1: grupo[i],
              titulo2: grupo[j],
              tipo: "identificador_interno",
              confianca: 100,
            });
          }
        }
      }
    });
  }

  // 2. Buscar títulos com mesmo nosso_numero
  const { data: titulosPorNossoNumero } = await supabase
    .from("titulos_cobranca")
    .select("*")
    .eq("empresa_id", empresaId)
    .not("nosso_numero", "is", null);

  if (titulosPorNossoNumero) {
    const gruposPorNossoNumero = new Map<string, TituloCobranca[]>();
    titulosPorNossoNumero.forEach((titulo) => {
      const nossoNumero = titulo.nosso_numero!;
      if (!gruposPorNossoNumero.has(nossoNumero)) {
        gruposPorNossoNumero.set(nossoNumero, []);
      }
      gruposPorNossoNumero.get(nossoNumero)!.push(titulo);
    });

    gruposPorNossoNumero.forEach((grupo, nossoNumero) => {
      if (grupo.length > 1) {
        // Comparar todos os pares
        for (let i = 0; i < grupo.length; i++) {
          for (let j = i + 1; j < grupo.length; j++) {
            // Verificar se já não foi detectado por identificador_interno
            const jaExiste = duplicidades.some(
              (d) =>
                (d.titulo1.id === grupo[i].id && d.titulo2.id === grupo[j].id) ||
                (d.titulo1.id === grupo[j].id && d.titulo2.id === grupo[i].id)
            );
            if (!jaExiste) {
              duplicidades.push({
                titulo1: grupo[i],
                titulo2: grupo[j],
                tipo: "nosso_numero",
                confianca: 100,
              });
            }
          }
        }
      }
    });
  }

  // 3. Buscar títulos com chave composta (CPF/CNPJ + vencimento + valor nominal + nome)
  // Tolerância de 1% no valor
  const { data: todosTitulos } = await supabase
    .from("titulos_cobranca")
    .select("*")
    .eq("empresa_id", empresaId)
    .not("sacado_documento", "is", null);

  if (todosTitulos) {
    for (let i = 0; i < todosTitulos.length; i++) {
      for (let j = i + 1; j < todosTitulos.length; j++) {
        const t1 = todosTitulos[i];
        const t2 = todosTitulos[j];

        // Verificar se já foi detectado
        const jaExiste = duplicidades.some(
          (d) =>
            (d.titulo1.id === t1.id && d.titulo2.id === t2.id) ||
            (d.titulo1.id === t2.id && d.titulo2.id === t1.id)
        );

        if (jaExiste) continue;

        // Verificar chave composta
        const mesmoDocumento = t1.sacado_documento === t2.sacado_documento;
        const mesmoVencimento =
          new Date(t1.vencimento).toISOString().split("T")[0] ===
          new Date(t2.vencimento).toISOString().split("T")[0];
        const valorSimilar =
          Math.abs(t1.valor_nominal - t2.valor_nominal) / t1.valor_nominal <= 0.01;
        const mesmoNome =
          t1.sacado_nome?.toLowerCase().trim() === t2.sacado_nome?.toLowerCase().trim();

        if (mesmoDocumento && mesmoVencimento && valorSimilar && mesmoNome) {
          // Calcular confiança baseada na similaridade
          let confianca = 80; // Base
          if (t1.identificador_interno && t2.identificador_interno) {
            if (t1.identificador_interno === t2.identificador_interno) {
              confianca = 100;
            }
          }
          if (t1.nosso_numero && t2.nosso_numero) {
            if (t1.nosso_numero === t2.nosso_numero) {
              confianca = 100;
            }
          }

          duplicidades.push({
            titulo1: t1,
            titulo2: t2,
            tipo: "chave_composta",
            confianca,
          });
        }
      }
    }
  }

  return duplicidades;
}

/**
 * Cria ocorrência na fila para uma duplicidade detectada
 */
export async function criarOcorrenciaDuplicidade(
  duplicidade: DuplicidadeDetectada,
  empresaId: string
): Promise<void> {
  const { error } = await supabase.from("fila_ocorrencias").insert({
    empresa_id: empresaId,
    titulo_id: duplicidade.titulo1.id,
    data_ocorrencia: new Date().toISOString(),
    identificador: `Duplicidade: ${duplicidade.tipo}`,
    acao: "duplicidade",
    status_motivo: `Título duplicado detectado (${duplicidade.confianca}% confiança)`,
    observacoes: `Título 1: ${duplicidade.titulo1.identificador_interno || duplicidade.titulo1.nosso_numero || duplicidade.titulo1.id}\nTítulo 2: ${duplicidade.titulo2.identificador_interno || duplicidade.titulo2.nosso_numero || duplicidade.titulo2.id}`,
    tags: ["duplicidade", duplicidade.tipo],
    referencia_cruzada: {
      titulo_duplicado_id: duplicidade.titulo2.id,
      tipo_duplicidade: duplicidade.tipo,
      confianca: duplicidade.confianca,
    },
    resolvido: false,
  });

  if (error) throw error;
}

