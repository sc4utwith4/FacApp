import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Eye, Download, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import type { RelatorioBancoPDF } from "@/types/relatorio-banco-pdf";
import { formatCurrency } from "@/lib/utils";
import { sanitizarNomeArquivo } from "@/utils/sanitizarNomeArquivo";

interface HistoricoRelatorioBancoProps {
  relatorioId: string;
  onClose: () => void;
}

export function HistoricoRelatorioBanco({ relatorioId, onClose }: HistoricoRelatorioBancoProps) {
  const { data: relatorios, isLoading } = useQuery<RelatorioBancoPDF[]>({
    queryKey: ["relatorios-banco-historico", relatorioId],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      // Buscar o relatório atual para obter fechamento_id
      const { data: relatorioAtual, error: relatorioError } = await supabase
        .from("relatorios_banco_pdf")
        .select("fechamento_id")
        .eq("id", relatorioId)
        .eq("empresa_id", profile.empresa_id)
        .single();

      if (relatorioError || !relatorioAtual) {
        throw new Error("Relatório não encontrado");
      }

      // Se não tiver fechamento_id, buscar apenas este relatório
      if (!relatorioAtual.fechamento_id) {
        const { data: singleRelatorio, error: singleError } = await supabase
          .from("relatorios_banco_pdf")
          .select("*")
          .eq("id", relatorioId)
          .eq("empresa_id", profile.empresa_id)
          .single();

        if (singleError) throw singleError;
        return singleRelatorio ? [singleRelatorio] : [];
      }

      // Buscar todos os relatórios do mesmo fechamento, ordenados por versão
      const { data, error } = await supabase
        .from("relatorios_banco_pdf")
        .select("*")
        .eq("empresa_id", profile.empresa_id)
        .eq("fechamento_id", relatorioAtual.fechamento_id)
        .order("versao", { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!relatorioId,
  });

  const getStatusBadge = (relatorio: RelatorioBancoPDF) => {
    if (relatorio.status === "validado") {
      return (
        <Badge variant="secondary" className="bg-green-100 text-green-800">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Validado
        </Badge>
      );
    }
    if (relatorio.status === "erro") {
      return (
        <Badge variant="destructive">
          <XCircle className="mr-1 h-3 w-3" />
          Erro
        </Badge>
      );
    }
    return (
      <Badge variant="outline">
        <AlertCircle className="mr-1 h-3 w-3" />
        Extraído
      </Badge>
    );
  };

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Carregando...</div>;
  }

  if (!relatorios || relatorios.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Nenhuma versão anterior encontrada
      </div>
    );
  }

  /**
   * Extrai o caminho do arquivo da URL ou reconstrói a partir dos dados do relatório
   */
  const extrairCaminhoDoArquivo = (relatorio: RelatorioBancoPDF): string => {
    // Prioridade 1: Extrair diretamente da URL pública (mais confiável)
    if (relatorio.arquivo_url) {
      try {
        const url = new URL(relatorio.arquivo_url);
        const pathParts = url.pathname.split('/').filter(part => part); // Remove partes vazias
        
        // Procurar pelo padrão: /storage/v1/object/public/bucket/caminho
        const publicIndex = pathParts.findIndex(part => part === 'public');
        if (publicIndex !== -1 && pathParts.length > publicIndex + 2) {
          // Formato: storage/v1/object/public/bucket/caminho
          // Pular 'public' e o nome do bucket, pegar o resto
          const caminhoDecodificado = decodeURIComponent(pathParts.slice(publicIndex + 2).join('/'));
          
          // Se o caminho contém espaços (arquivo antigo), sanitizar o nome do arquivo
          const caminhoParts = caminhoDecodificado.split('/');
          const nomeArquivo = caminhoParts[caminhoParts.length - 1];
          if (nomeArquivo.includes(' ') || nomeArquivo !== nomeArquivo.toLowerCase()) {
            // Sanitizar o nome do arquivo
            const nomeArquivoSanitizado = sanitizarNomeArquivo(nomeArquivo);
            caminhoParts[caminhoParts.length - 1] = nomeArquivoSanitizado;
            return caminhoParts.join('/');
          }
          
          return caminhoDecodificado;
        }
        
        // Alternativa: se a URL já contém o caminho direto após o bucket
        const bucketIndex = pathParts.findIndex(part => part === 'relatorios-banco-pdf');
        if (bucketIndex !== -1 && pathParts.length > bucketIndex + 1) {
          const caminhoDecodificado = decodeURIComponent(pathParts.slice(bucketIndex + 1).join('/'));
          
          // Se o caminho contém espaços (arquivo antigo), sanitizar o nome do arquivo
          const caminhoParts = caminhoDecodificado.split('/');
          const nomeArquivo = caminhoParts[caminhoParts.length - 1];
          if (nomeArquivo.includes(' ') || nomeArquivo !== nomeArquivo.toLowerCase()) {
            // Sanitizar o nome do arquivo
            const nomeArquivoSanitizado = sanitizarNomeArquivo(nomeArquivo);
            caminhoParts[caminhoParts.length - 1] = nomeArquivoSanitizado;
            return caminhoParts.join('/');
          }
          
          return caminhoDecodificado;
        }
      } catch (error) {
        console.warn("Erro ao extrair caminho da URL:", error);
      }
    }
    
    // Prioridade 2: Reconstruir a partir do nome do arquivo (fallback)
    // Para arquivos antigos que podem ter espaços no nome do banco, mas foram salvos sanitizados no storage
    const nomeArquivo = relatorio.arquivo_nome;
    // Extrair timestamp e nome do arquivo
    const match = nomeArquivo.match(/^(\d+)-(.+)$/);
    
    if (match) {
      const timestamp = match[1];
      const nomeOriginal = match[2];
      // Sanitizar o nome para corresponder ao nome no storage
      const nomeSanitizado = sanitizarNomeArquivo(nomeOriginal);
      const nomeArquivoCompleto = `${timestamp}-${nomeSanitizado}`;
      
      if (relatorio.fechamento_id) {
        return `${relatorio.empresa_id}/${relatorio.fechamento_id}/${nomeArquivoCompleto}`;
      } else {
        return `${relatorio.empresa_id}/${nomeArquivoCompleto}`;
      }
    }
    
    throw new Error("Não foi possível determinar o caminho do arquivo");
  };

  /**
   * Abre o PDF em nova aba, usando signed URL se necessário
   */
  const handleVisualizarPDF = async (relatorio: RelatorioBancoPDF) => {
    try {
      // Tentar usar URL pública primeiro
      if (relatorio.arquivo_url) {
        // Testar se a URL pública funciona fazendo uma requisição HEAD
        try {
          const response = await fetch(relatorio.arquivo_url, { method: 'HEAD' });
          if (response.ok) {
            window.open(relatorio.arquivo_url, "_blank");
            return;
          }
        } catch (error) {
          // Se falhar, continuar para gerar signed URL
          console.warn("URL pública não acessível, gerando signed URL:", error);
        }
      }
      
      // Se não houver URL pública ou se falhar, gerar signed URL
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Usuário não autenticado");
        return;
      }
      
      const caminho = extrairCaminhoDoArquivo(relatorio);
      
      const { data: signedUrlData, error } = await supabase.storage
        .from("relatorios-banco-pdf")
        .createSignedUrl(caminho, 3600); // URL válida por 1 hora
      
      if (error) {
        throw new Error(`Erro ao gerar URL assinada: ${error.message}`);
      }
      
      if (signedUrlData?.signedUrl) {
        window.open(signedUrlData.signedUrl, "_blank");
      } else {
        throw new Error("URL assinada não foi gerada");
      }
    } catch (error) {
      toast.error(`Erro ao abrir PDF: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
      console.error("Erro ao visualizar PDF:", error);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Versões ({relatorios.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Versão</TableHead>
                  <TableHead>Data Upload</TableHead>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Validação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {relatorios.map((relatorio) => (
                  <TableRow key={relatorio.id}>
                    <TableCell className="font-medium">v{relatorio.versao}</TableCell>
                    <TableCell>
                      {new Date(relatorio.data_upload).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell>{relatorio.arquivo_nome}</TableCell>
                    <TableCell>{getStatusBadge(relatorio)}</TableCell>
                    <TableCell>
                      {relatorio.validado_contra_fechamento ? (
                        relatorio.divergencia_valor === 0 ? (
                          <Badge variant="secondary" className="bg-green-100 text-green-800">
                            OK
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-orange-100 text-orange-800">
                            Divergência: {formatCurrency(Math.abs(relatorio.divergencia_valor))}
                          </Badge>
                        )
                      ) : (
                        <Badge variant="outline">Não validado</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleVisualizarPDF(relatorio)}
                          title="Visualizar PDF"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            const link = document.createElement("a");
                            link.href = relatorio.arquivo_url;
                            link.download = relatorio.arquivo_nome;
                            link.click();
                          }}
                          title="Download"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button variant="outline" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </div>
  );
}
