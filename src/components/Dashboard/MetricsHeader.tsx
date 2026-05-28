import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Calendar, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricsHeaderProps {
  periodo: string;
  setPeriodo: (value: string) => void;
  modoFiltro: 'periodo' | 'custom';
  setModoFiltro: (value: 'periodo' | 'custom') => void;
  dataInicio: string;
  setDataInicio: (value: string) => void;
  dataFim: string;
  setDataFim: (value: string) => void;
  contaBancariaId: string;
  setContaBancariaId: (value: string) => void;
  contasBancarias: Array<{ id: string; descricao: string }>;
}

export function MetricsHeader({
  periodo,
  setPeriodo,
  modoFiltro,
  setModoFiltro,
  dataInicio,
  setDataInicio,
  dataFim,
  setDataFim,
  contaBancariaId,
  setContaBancariaId,
  contasBancarias,
}: MetricsHeaderProps) {
  return (
    <div className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-4">
          {/* Modo de Filtro */}
          <div className="flex items-center gap-2">
            <Label htmlFor="modo-filtro" className="text-sm font-medium text-muted-foreground whitespace-nowrap">
              Modo:
            </Label>
            <Select value={modoFiltro} onValueChange={(value) => setModoFiltro(value as 'periodo' | 'custom')}>
              <SelectTrigger id="modo-filtro" className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="periodo">Período</SelectItem>
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Filtro de Período ou Datas Customizadas */}
          {modoFiltro === 'periodo' ? (
            <div className="flex items-center gap-2">
              <Label htmlFor="periodo" className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                Período:
              </Label>
              <Select value={periodo} onValueChange={setPeriodo}>
                <SelectTrigger id="periodo" className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hoje">Hoje</SelectItem>
                  <SelectItem value="7">Últimos 7 dias</SelectItem>
                  <SelectItem value="30">Últimos 30 dias</SelectItem>
                  <SelectItem value="90">Últimos 90 dias</SelectItem>
                  <SelectItem value="365">Últimos 365 dias</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Label htmlFor="data-inicio" className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                De:
              </Label>
              <Input
                id="data-inicio"
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="w-[160px]"
              />
              <Label htmlFor="data-fim" className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                Até:
              </Label>
              <Input
                id="data-fim"
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="w-[160px]"
              />
            </div>
          )}

          {/* Filtro de Conta Bancária */}
          <div className="flex items-center gap-2">
            <Label htmlFor="conta-bancaria" className="text-sm font-medium text-muted-foreground whitespace-nowrap">
              Conta:
            </Label>
            <Select value={contaBancariaId} onValueChange={setContaBancariaId}>
              <SelectTrigger id="conta-bancaria" className="w-[200px]">
                <SelectValue placeholder="Todas as contas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas as contas</SelectItem>
                {contasBancarias.map((conta) => (
                  <SelectItem key={conta.id} value={conta.id}>
                    {conta.descricao}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}

