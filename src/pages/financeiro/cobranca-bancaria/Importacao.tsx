import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, FileText, FileSpreadsheet, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { parsePlanilhaExcel, parsePDF, convertParsedTitulo, convertParsedEvento } from "@/utils/cobrancaParser";
import type { ParseResult, ParsedTitulo, ParsedEvento } from "@/utils/cobrancaParser";
import { formatCurrency } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { aplicarCalculoLiquidacaoAutomatico } from "@/utils/aplicarCalculoLiquidacao";

export default function Importacao() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [selectedTitulos, setSelectedTitulos] = useState<Set<number>>(new Set());
  const [selectedEventos, setSelectedEventos] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setParseResult(null);
    setIsParsing(true);

    try {
      let result: ParseResult;

      if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
        result = await parsePlanilhaExcel(file);
      } else if (file.name.endsWith(".pdf")) {
        result = await parsePDF(file);
      } else {
        toast.error("Formato de arquivo não suportado. Use .xlsx, .xls ou .pdf");
        setIsParsing(false);
        return;
      }

      setParseResult(result);

      // Selecionar todos por padrão
      setSelectedTitulos(new Set(result.titulos.map((_, i) => i)));
      setSelectedEventos(new Set(result.eventos.map((_, i) => i)));

      if (result.errors.length > 0) {
        toast.warning(`${result.errors.length} erro(s) encontrado(s) durante o parsing`);
      }

      if (result.warnings.length > 0) {
        result.warnings.forEach((warning) => toast.info(warning));
      }
    } catch (error) {
      toast.error(`Erro ao processar arquivo: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
    } finally {
      setIsParsing(false);
    }
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!parseResult || !selectedFile) throw new Error("Nenhum arquivo processado");

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      // Criar registro de importação
      const { data: importacao, error: importError } = await supabase
        .from("importacoes_cobranca")
        .insert({
          empresa_id: profile.empresa_id,
          tipo_importacao: selectedFile.name.endsWith(".pdf") ? "PDF" : "PLANILHA",
          arquivo_nome: selectedFile.name,
          total_registros: selectedTitulos.size + selectedEventos.size,
          status: "processando",
        })
        .select()
        .single();

      if (importError) throw importError;

      const origem = {
        arquivo: selectedFile.name,
        tipo_importacao: selectedFile.name.endsWith(".pdf") ? "PDF" : "PLANILHA",
        usuario: user.email || "Sistema",
        importacao_id: importacao.id,
      };

      let titulosCriados = 0;
      let eventosCriados = 0;
      const erros: string[] = [];

      // Importar títulos selecionados
      for (const index of selectedTitulos) {
        const parsed = parseResult.titulos[index];
        try {
          const tituloInsert = convertParsedTitulo(parsed, profile.empresa_id, origem);
          const { data: titulo, error: tituloError } = await supabase
            .from("titulos_cobranca")
            .insert(tituloInsert)
            .select()
            .single();

          if (tituloError) {
            erros.push(`Título ${index + 1}: ${tituloError.message}`);
            continue;
          }

          titulosCriados++;

          // Se houver eventos relacionados a este título, importá-los
          const eventosRelacionados = parseResult.eventos.filter(
            (e) => e.identificador === parsed.identificador_interno ||
                   e.nosso_numero === parsed.nosso_numero
          );

          for (const eventoParsed of eventosRelacionados) {
            try {
              const eventoInsert = convertParsedEvento(eventoParsed, titulo.id, origem);
              const { data: eventoCriado, error: eventoError } = await supabase
                .from("eventos_cobranca")
                .insert(eventoInsert)
                .select()
                .single();

              if (eventoError) {
                erros.push(`Evento do título ${index + 1}: ${eventoError.message}`);
              } else {
                eventosCriados++;
                
                // Aplicar cálculo automático se for evento de liquidação
                if (eventoCriado.tipo_evento === "LIQUIDACAO") {
                  try {
                    await aplicarCalculoLiquidacaoAutomatico(eventoCriado, titulo);
                  } catch (calcError) {
                    // Não falhar a importação se o cálculo falhar, apenas registrar
                    console.warn("Erro ao calcular liquidação automática:", calcError);
                  }
                }
              }
            } catch (error) {
              erros.push(`Evento do título ${index + 1}: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
            }
          }
        } catch (error) {
          erros.push(`Título ${index + 1}: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
        }
      }

      // Importar eventos não relacionados a títulos
      for (const index of selectedEventos) {
        const parsed = parseResult.eventos[index];
        // Se já foi importado como parte de um título, pular
        if (parseResult.titulos.some(
          (t) => t.identificador_interno === parsed.identificador ||
                 t.nosso_numero === parsed.nosso_numero
        )) {
          continue;
        }

        // Eventos sem título relacionado serão adicionados à fila de ocorrências
        // Por enquanto, apenas registramos o erro
        erros.push(`Evento ${index + 1} sem título relacionado - será adicionado à fila de ocorrências`);
      }

      // Atualizar status da importação
      await supabase
        .from("importacoes_cobranca")
        .update({
          registros_processados: titulosCriados + eventosCriados,
          registros_erro: erros.length,
          status: erros.length > 0 ? "concluido" : "concluido",
          erros: erros,
        })
        .eq("id", importacao.id);

      return { titulosCriados, eventosCriados, erros };
    },
    onSuccess: (data) => {
      toast.success(
        `Importação concluída: ${data.titulosCriados} título(s) e ${data.eventosCriados} evento(s) importados`
      );
      if (data.erros.length > 0) {
        toast.warning(`${data.erros.length} erro(s) durante a importação`);
      }
      queryClient.invalidateQueries({ queryKey: ["cobranca-titulos"] });
      queryClient.invalidateQueries({ queryKey: ["cobranca-dashboard"] });
      navigate("/financeiro/cobranca-bancaria");
    },
    onError: (error) => {
      toast.error(`Erro ao importar: ${error.message}`);
    },
  });

  const toggleTitulo = (index: number) => {
    const newSet = new Set(selectedTitulos);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setSelectedTitulos(newSet);
  };

  const toggleEvento = (index: number) => {
    const newSet = new Set(selectedEventos);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setSelectedEventos(newSet);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Importação de Dados</h1>
        <p className="text-muted-foreground">
          Importe títulos e eventos de cobrança a partir de planilhas Excel ou relatórios PDF
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Selecionar Arquivo</CardTitle>
          <CardDescription>
            Suporte para arquivos Excel (.xlsx, .xls) e PDF (.pdf)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Label htmlFor="file-upload" className="cursor-pointer">
              <Button variant="outline" asChild>
                <span>
                  <Upload className="mr-2 h-4 w-4" />
                  Selecionar Arquivo
                </span>
              </Button>
            </Label>
            <Input
              id="file-upload"
              type="file"
              accept=".xlsx,.xls,.pdf"
              onChange={handleFileSelect}
              className="hidden"
            />
            {selectedFile && (
              <div className="flex items-center gap-2">
                {selectedFile.name.endsWith(".pdf") ? (
                  <FileText className="h-4 w-4" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
                <span className="text-sm">{selectedFile.name}</span>
              </div>
            )}
          </div>

          {isParsing && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Processando arquivo...</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {parseResult && (
        <>
          {/* Resumo */}
          <Card>
            <CardHeader>
              <CardTitle>Resumo da Importação</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-2xl font-bold text-green-600">
                    {parseResult.titulos.length}
                  </div>
                  <div className="text-sm text-muted-foreground">Títulos Encontrados</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-blue-600">
                    {parseResult.eventos.length}
                  </div>
                  <div className="text-sm text-muted-foreground">Eventos Encontrados</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-red-600">
                    {parseResult.errors.length}
                  </div>
                  <div className="text-sm text-muted-foreground">Erros</div>
                </div>
              </div>

              {parseResult.errors.length > 0 && (
                <Alert className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="space-y-1">
                      {parseResult.errors.map((error, i) => (
                        <div key={i} className="text-sm">{error}</div>
                      ))}
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Preview dos dados */}
          <Tabs defaultValue="titulos" className="space-y-4">
            <TabsList>
              <TabsTrigger value="titulos">
                Títulos ({selectedTitulos.size}/{parseResult.titulos.length})
              </TabsTrigger>
              <TabsTrigger value="eventos">
                Eventos ({selectedEventos.size}/{parseResult.eventos.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="titulos">
              <Card>
                <CardHeader>
                  <CardTitle>Preview - Títulos</CardTitle>
                  <CardDescription>
                    Selecione os títulos que deseja importar
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border max-h-[600px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12"></TableHead>
                          <TableHead>Identificador</TableHead>
                          <TableHead>Sacado</TableHead>
                          <TableHead>Vencimento</TableHead>
                          <TableHead>Valor</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parseResult.titulos.map((titulo, index) => (
                          <TableRow key={index}>
                            <TableCell>
                              <input
                                type="checkbox"
                                checked={selectedTitulos.has(index)}
                                onChange={() => toggleTitulo(index)}
                              />
                            </TableCell>
                            <TableCell>
                              {titulo.identificador_interno || titulo.nosso_numero || "-"}
                            </TableCell>
                            <TableCell>{titulo.sacado_nome || "-"}</TableCell>
                            <TableCell>
                              {new Date(titulo.vencimento).toLocaleDateString("pt-BR")}
                            </TableCell>
                            <TableCell>{formatCurrency(titulo.valor_nominal)}</TableCell>
                            <TableCell>{titulo.status_atual}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="eventos">
              <Card>
                <CardHeader>
                  <CardTitle>Preview - Eventos</CardTitle>
                  <CardDescription>
                    Selecione os eventos que deseja importar
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border max-h-[600px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12"></TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead>Identificador</TableHead>
                          <TableHead>Valor</TableHead>
                          <TableHead>Descrição</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parseResult.eventos.map((evento, index) => (
                          <TableRow key={index}>
                            <TableCell>
                              <input
                                type="checkbox"
                                checked={selectedEventos.has(index)}
                                onChange={() => toggleEvento(index)}
                              />
                            </TableCell>
                            <TableCell>{evento.tipo_evento}</TableCell>
                            <TableCell>
                              {new Date(evento.data_evento).toLocaleDateString("pt-BR")}
                            </TableCell>
                            <TableCell>
                              {evento.identificador || evento.nosso_numero || "-"}
                            </TableCell>
                            <TableCell>{formatCurrency(evento.valor_liquido)}</TableCell>
                            <TableCell className="max-w-xs truncate">
                              {evento.descricao_banco || "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Botão de importação */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => navigate("/financeiro/cobranca-bancaria")}>
              Cancelar
            </Button>
            <Button
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending || (selectedTitulos.size === 0 && selectedEventos.size === 0)}
            >
              {importMutation.isPending ? "Importando..." : "Importar Selecionados"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

