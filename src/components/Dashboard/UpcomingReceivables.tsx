import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Receivable {
  id: string;
  descricao: string;
  valor: number;
  vencimento: string;
}

interface UpcomingReceivablesProps {
  receivables?: Receivable[];
  days?: number;
  className?: string;
}

export function UpcomingReceivables({ 
  receivables = [], 
  days = 7,
  className 
}: UpcomingReceivablesProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const getDaysUntilDue = (vencimento: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(vencimento);
    dueDate.setHours(0, 0, 0, 0);
    const diffTime = dueDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const getDaysBadgeVariant = (days: number) => {
    if (days <= 2) return 'default';
    if (days <= 5) return 'default';
    return 'default';
  };

  const displayReceivables = receivables.slice(0, 5);

  return (
    <Card className={cn("col-span-full", className)}>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Contas a Receber (Próximos {days} dias)</CardTitle>
      </CardHeader>
      <CardContent>
        {displayReceivables.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">Nenhuma conta a receber nos próximos {days} dias</p>
          </div>
        ) : (
          <div className="space-y-2">
            {displayReceivables.map((receivable) => {
              const daysUntil = getDaysUntilDue(receivable.vencimento);
              return (
                <div
                  key={receivable.id}
                  className="flex items-center justify-between px-4 py-3 rounded-md hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {receivable.descricao}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 ml-4">
                    <span className="text-sm font-semibold text-success">
                      {formatCurrency(receivable.valor)}
                    </span>
                    <Badge 
                      variant={getDaysBadgeVariant(daysUntil)}
                      className="min-w-[60px] justify-center"
                    >
                      {daysUntil === 0 ? 'Hoje' : daysUntil === 1 ? '1 dia' : `${daysUntil} dias`}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      {receivables.length > 5 && (
        <CardFooter className="pt-4">
          <Link 
            to="/contas-a-receber" 
            className="text-sm text-primary hover:underline flex items-center gap-1 ml-auto"
          >
            Ver todas
            <ArrowRight className="h-4 w-4" />
          </Link>
        </CardFooter>
      )}
    </Card>
  );
}


