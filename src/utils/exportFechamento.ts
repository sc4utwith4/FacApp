// ============================================
// EXPORTAÇÃO DE FECHAMENTO - COBRANÇA BANCÁRIA
// ============================================

import { supabase } from "@/integrations/supabase/client";
import type { FechamentoDiario } from "@/types/cobranca-bancaria";
import { formatCurrency } from "@/lib/utils";

type JsPdfModule = typeof import("jspdf");
type JsPdfAutoTableModule = typeof import("jspdf-autotable");
type XlsxModule = typeof import("xlsx");

let pdfDepsPromise: Promise<{ jsPDF: JsPdfModule["jsPDF"]; autoTable: JsPdfAutoTableModule["default"] }> | null = null;
let xlsxPromise: Promise<XlsxModule> | null = null;

async function loadPdfDeps() {
  if (!pdfDepsPromise) {
    pdfDepsPromise = Promise.all([import("jspdf"), import("jspdf-autotable")]).then(
      ([jspdfModule, autoTableModule]) => ({
        jsPDF: ("jsPDF" in jspdfModule
          ? jspdfModule.jsPDF
          : "default" in jspdfModule && jspdfModule.default && "jsPDF" in jspdfModule.default
            ? jspdfModule.default.jsPDF
            : undefined) as JsPdfModule["jsPDF"],
        autoTable: ("default" in autoTableModule && autoTableModule.default
          ? autoTableModule.default
          : autoTableModule) as unknown as JsPdfAutoTableModule["default"],
      }),
    );
  }
  return pdfDepsPromise;
}

async function loadXlsxModule() {
  if (!xlsxPromise) {
    xlsxPromise = import("xlsx").then((module) => {
      return ("default" in module && module.default ? module.default : module) as XlsxModule;
    });
  }
  return xlsxPromise;
}

/**
 * Exporta fechamento para PDF
 */
export async function exportarFechamentoPDF(
  fechamento: FechamentoDiario
): Promise<string> {
  try {
    const { jsPDF, autoTable } = await loadPdfDeps();
    if (!jsPDF || !autoTable) {
      throw new Error("Dependências de exportação PDF indisponíveis");
    }
    const doc = new jsPDF();
    let yPosition = 20;

    // Cabeçalho
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("Fechamento Diário - Cobrança Bancária", 20, yPosition);
    yPosition += 10;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text(
      `Data: ${new Date(fechamento.data_fechamento).toLocaleDateString("pt-BR")}`,
      20,
      yPosition
    );
    yPosition += 6;
    doc.text(`Gerado em: ${new Date().toLocaleDateString("pt-BR")}`, 20, yPosition);
    yPosition += 15;

    // Resumo Executivo
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Resumo Executivo", 20, yPosition);
    yPosition += 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(
      `Saldo Anterior: ${fechamento.saldo_anterior_qtd} títulos - ${formatCurrency(fechamento.saldo_anterior_valor)}`,
      20,
      yPosition
    );
    yPosition += 6;
    doc.text(
      `Entradas: ${fechamento.entradas_qtd} títulos - ${formatCurrency(fechamento.entradas_valor)}`,
      20,
      yPosition
    );
    yPosition += 6;
    doc.text(
      `Baixas: ${fechamento.baixas_qtd} títulos - ${formatCurrency(fechamento.baixas_valor)}`,
      20,
      yPosition
    );
    yPosition += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(
      `Saldo Atual: ${fechamento.saldo_atual_qtd} títulos - ${formatCurrency(fechamento.saldo_atual_valor)}`,
      20,
      yPosition
    );
    yPosition += 15;

    // Indicadores
    if (fechamento.indicadores && Object.keys(fechamento.indicadores).length > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("Indicadores", 20, yPosition);
      yPosition += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);

      if (fechamento.indicadores.liquidez !== undefined) {
        doc.text(
          `Liquidez: ${fechamento.indicadores.liquidez.toFixed(2)}%`,
          20,
          yPosition
        );
        yPosition += 6;
      }

      if (fechamento.indicadores.titulos_cartorio !== undefined) {
        doc.text(
          `Títulos em Cartório: ${fechamento.indicadores.titulos_cartorio} - ${formatCurrency(fechamento.indicadores.valor_cartorio || 0)}`,
          20,
          yPosition
        );
        yPosition += 6;
      }

      if (fechamento.indicadores.titulos_protesto !== undefined) {
        doc.text(
          `Títulos com Protesto: ${fechamento.indicadores.titulos_protesto} - ${formatCurrency(fechamento.indicadores.valor_protesto || 0)}`,
          20,
          yPosition
        );
        yPosition += 6;
      }

      yPosition += 10;
    }

    // Títulos do dia
    const { data: titulosDia } = await supabase
      .from("titulos_cobranca")
      .select("*")
      .eq("empresa_id", fechamento.empresa_id)
      .gte("created_at", `${fechamento.data_fechamento}T00:00:00`)
      .lt("created_at", `${fechamento.data_fechamento}T23:59:59`)
      .limit(100);

    if (titulosDia && titulosDia.length > 0) {
      if (yPosition > 250) {
        doc.addPage();
        yPosition = 20;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("Títulos do Dia", 20, yPosition);
      yPosition += 5;

      const titulosData = titulosDia.map((titulo) => [
        titulo.identificador_interno || titulo.nosso_numero || "-",
        titulo.sacado_nome || "-",
        new Date(titulo.vencimento).toLocaleDateString("pt-BR"),
        formatCurrency(titulo.valor_nominal),
        titulo.status_atual,
      ]);

      autoTable(doc, {
        head: [["ID", "Sacado", "Vencimento", "Valor", "Status"]],
        body: titulosData,
        startY: yPosition,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [66, 139, 202] },
        columnStyles: {
          0: { cellWidth: 40 },
          1: { cellWidth: 50 },
          2: { cellWidth: 30 },
          3: { cellWidth: 30, halign: "right" },
          4: { cellWidth: 30 },
        },
      });

      const lastTable = (doc as any).lastAutoTable;
      if (lastTable?.finalY) {
        yPosition = lastTable.finalY + 10;
      }
    }

    // Eventos do dia
    const { data: eventosDia } = await supabase
      .from("eventos_cobranca")
      .select("*, titulos_cobranca(identificador_interno, nosso_numero)")
      .gte("data_evento", `${fechamento.data_fechamento}T00:00:00`)
      .lt("data_evento", `${fechamento.data_fechamento}T23:59:59`)
      .limit(100);

    if (eventosDia && eventosDia.length > 0) {
      if (yPosition > 250) {
        doc.addPage();
        yPosition = 20;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("Eventos do Dia", 20, yPosition);
      yPosition += 5;

      const eventosData = eventosDia.map((evento) => [
        evento.tipo_evento,
        new Date(evento.data_evento).toLocaleString("pt-BR"),
        (evento.titulos_cobranca as any)?.identificador_interno ||
          (evento.titulos_cobranca as any)?.nosso_numero ||
          "-",
        formatCurrency(evento.valor_liquido),
      ]);

      autoTable(doc, {
        head: [["Tipo", "Data", "Título", "Valor Líquido"]],
        body: eventosData,
        startY: yPosition,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [66, 139, 202] },
        columnStyles: {
          0: { cellWidth: 40 },
          1: { cellWidth: 40 },
          2: { cellWidth: 40 },
          3: { cellWidth: 30, halign: "right" },
        },
      });
    }

    // Rodapé
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(
        `Página ${i} de ${pageCount} - Gerado em ${new Date().toLocaleString("pt-BR")}`,
        20,
        doc.internal.pageSize.height - 10
      );
    }

    // Gerar blob e fazer upload
    const pdfBlob = doc.output("blob");
    const fileName = `fechamento-${fechamento.data_fechamento}-${Date.now()}.pdf`;

    // Upload para Supabase Storage (se configurado) ou retornar blob
    // Por enquanto, retornamos o blob para download direto
    const url = URL.createObjectURL(pdfBlob);

    // Atualizar fechamento com URL (se storage estiver configurado)
    // await supabase.from("fechamentos_diarios").update({ exportado_pdf_url: url }).eq("id", fechamento.id);

    return url;
  } catch (error) {
    console.error("Erro ao exportar PDF:", error);
    throw error;
  }
}

/**
 * Exporta fechamento para Excel
 */
export async function exportarFechamentoExcel(
  fechamento: FechamentoDiario
): Promise<string> {
  try {
    const XLSX = await loadXlsxModule();
    const workbook = XLSX.utils.book_new();

    // Aba Resumo
    const resumoData = [
      ["Fechamento Diário - Cobrança Bancária"],
      [`Data: ${new Date(fechamento.data_fechamento).toLocaleDateString("pt-BR")}`],
      [`Gerado em: ${new Date().toLocaleDateString("pt-BR")}`],
      [],
      ["Resumo Executivo"],
      ["Saldo Anterior", fechamento.saldo_anterior_qtd, formatCurrency(fechamento.saldo_anterior_valor)],
      ["Entradas", fechamento.entradas_qtd, formatCurrency(fechamento.entradas_valor)],
      ["Baixas", fechamento.baixas_qtd, formatCurrency(fechamento.baixas_valor)],
      ["Saldo Atual", fechamento.saldo_atual_qtd, formatCurrency(fechamento.saldo_atual_valor)],
    ];

    const resumoSheet = XLSX.utils.aoa_to_sheet(resumoData);
    XLSX.utils.book_append_sheet(workbook, resumoSheet, "Resumo");

    // Aba Títulos
    const { data: titulosDia } = await supabase
      .from("titulos_cobranca")
      .select("*")
      .eq("empresa_id", fechamento.empresa_id)
      .gte("created_at", `${fechamento.data_fechamento}T00:00:00`)
      .lt("created_at", `${fechamento.data_fechamento}T23:59:59`);

    if (titulosDia && titulosDia.length > 0) {
      const titulosData = [
        ["ID", "Nosso Número", "Sacado", "Documento", "Vencimento", "Valor", "Status"],
        ...titulosDia.map((t) => [
          t.identificador_interno || "-",
          t.nosso_numero || "-",
          t.sacado_nome || "-",
          t.sacado_documento || "-",
          new Date(t.vencimento).toLocaleDateString("pt-BR"),
          t.valor_nominal,
          t.status_atual,
        ]),
      ];

      const titulosSheet = XLSX.utils.aoa_to_sheet(titulosData);
      XLSX.utils.book_append_sheet(workbook, titulosSheet, "Títulos");
    }

    // Aba Eventos
    const { data: eventosDia } = await supabase
      .from("eventos_cobranca")
      .select("*, titulos_cobranca(identificador_interno, nosso_numero)")
      .gte("data_evento", `${fechamento.data_fechamento}T00:00:00`)
      .lt("data_evento", `${fechamento.data_fechamento}T23:59:59`);

    if (eventosDia && eventosDia.length > 0) {
      const eventosData = [
        ["Tipo", "Data", "Título", "Valor Principal", "Juros", "Multa", "Desconto", "Tarifa", "Valor Líquido"],
        ...eventosDia.map((e) => [
          e.tipo_evento,
          new Date(e.data_evento).toLocaleString("pt-BR"),
          (e.titulos_cobranca as any)?.identificador_interno ||
            (e.titulos_cobranca as any)?.nosso_numero ||
            "-",
          e.valor_principal,
          e.juros,
          e.multa,
          e.desconto,
          e.tarifa,
          e.valor_liquido,
        ]),
      ];

      const eventosSheet = XLSX.utils.aoa_to_sheet(eventosData);
      XLSX.utils.book_append_sheet(workbook, eventosSheet, "Eventos");
    }

    // Aba Indicadores
    if (fechamento.indicadores && Object.keys(fechamento.indicadores).length > 0) {
      const indicadoresData = [
        ["Indicador", "Valor"],
        ...Object.entries(fechamento.indicadores).map(([key, value]) => [
          key,
          typeof value === "number" ? value : String(value),
        ]),
      ];

      const indicadoresSheet = XLSX.utils.aoa_to_sheet(indicadoresData);
      XLSX.utils.book_append_sheet(workbook, indicadoresSheet, "Indicadores");
    }

    // Gerar arquivo
    const excelBlob = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const fileName = `fechamento-${fechamento.data_fechamento}-${Date.now()}.xlsx`;

    // Criar URL para download
    const url = URL.createObjectURL(
      new Blob([excelBlob], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
    );

    return url;
  } catch (error) {
    console.error("Erro ao exportar Excel:", error);
    throw error;
  }
}
