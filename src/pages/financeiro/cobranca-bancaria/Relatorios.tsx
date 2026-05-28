import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, FileSpreadsheet } from "lucide-react";
import { RelatorioPosicaoCarteira } from "@/components/cobranca-bancaria/RelatorioPosicaoCarteira";
import { RelatorioLiquidacoes } from "@/components/cobranca-bancaria/RelatorioLiquidacoes";
import { RelatorioDevolucoes } from "@/components/cobranca-bancaria/RelatorioDevolucoes";
import { RelatorioProtesto } from "@/components/cobranca-bancaria/RelatorioProtesto";
import { RelatorioDivergencias } from "@/components/cobranca-bancaria/RelatorioDivergencias";

export default function Relatorios() {
  const [filtrosComuns, setFiltrosComuns] = useState({
    dataInicio: new Date(new Date().setDate(new Date().getDate() - 30))
      .toISOString()
      .split("T")[0],
    dataFim: new Date().toISOString().split("T")[0],
    carteiraId: "todas" as string,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-muted-foreground">
          Gere relatórios detalhados de cobrança bancária
        </p>
      </div>

      {/* Filtros Comuns */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Data Início</Label>
              <Input
                type="date"
                value={filtrosComuns.dataInicio}
                onChange={(e) =>
                  setFiltrosComuns({ ...filtrosComuns, dataInicio: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Data Fim</Label>
              <Input
                type="date"
                value={filtrosComuns.dataFim}
                onChange={(e) =>
                  setFiltrosComuns({ ...filtrosComuns, dataFim: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Carteira</Label>
              <Select
                value={filtrosComuns.carteiraId}
                onValueChange={(value) =>
                  setFiltrosComuns({ ...filtrosComuns, carteiraId: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as Carteiras</SelectItem>
                  {/* TODO: Carregar carteiras dinamicamente */}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs de Relatórios */}
      <Tabs defaultValue="posicao" className="space-y-4">
        <TabsList>
          <TabsTrigger value="posicao">Posição de Carteira</TabsTrigger>
          <TabsTrigger value="liquidacoes">Liquidações</TabsTrigger>
          <TabsTrigger value="devolucoes">Devoluções</TabsTrigger>
          <TabsTrigger value="protesto">Protesto/Cartório</TabsTrigger>
          <TabsTrigger value="divergencias">Divergências</TabsTrigger>
        </TabsList>

        <TabsContent value="posicao">
          <RelatorioPosicaoCarteira filtros={filtrosComuns} />
        </TabsContent>

        <TabsContent value="liquidacoes">
          <RelatorioLiquidacoes filtros={filtrosComuns} />
        </TabsContent>

        <TabsContent value="devolucoes">
          <RelatorioDevolucoes filtros={filtrosComuns} />
        </TabsContent>

        <TabsContent value="protesto">
          <RelatorioProtesto filtros={filtrosComuns} />
        </TabsContent>

        <TabsContent value="divergencias">
          <RelatorioDivergencias filtros={filtrosComuns} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

