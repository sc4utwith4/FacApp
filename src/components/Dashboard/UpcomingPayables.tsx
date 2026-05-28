import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Payable {
  id: string;
  descricao: string;
  valor: number;
  vencimento: string;
}

interface UpcomingPayablesProps {
  payables?: Payable[];
  days?: number;
  className?: string;
}

export function UpcomingPayables({ 
  payables = [], 
  days = 7,
  className 
}: UpcomingPayablesProps) {
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
    if (days <= 2) return 'destructive';
    if (days <= 5) return 'warning';
    return 'default';
  };

  const displayPayables = payables.slice(0, 5);

  return (
    <Card className={cn("col-span-full", className)}>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Contas a Pagar (Próximos {days} dias)</CardTitle>
      </CardHeader>
      <CardContent>
        {displayPayables.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">Nenhuma conta a pagar nos próximos {days} dias</p>
          </div>
        ) : (
          <div className="space-y-2">
            {displayPayables.map((payable) => {
              const daysUntil = getDaysUntilDue(payable.vencimento);
              return (
                <div
                  key={payable.id}
                  className="flex items-center justify-between px-4 py-3 rounded-md hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {payable.descricao}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 ml-4">
                    <span className="text-sm font-semibold text-foreground">
                      {formatCurrency(payable.valor)}
                    </span>
                    <Badge 
                      variant={getDaysBadgeVariant(daysUntil) as "default" | "destructive" | "warning" | "secondary" | "outline"}
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
      {payables.length > 5 && (
        <CardFooter className="pt-4">
          <Link 
            to="/contas-a-pagar" 
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


