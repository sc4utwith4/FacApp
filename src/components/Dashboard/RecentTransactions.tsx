import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Transaction {
  id: string;
  descricao: string;
  valor: number;
  tipo: 'entrada' | 'saida';
  data: string;
}

interface RecentTransactionsProps {
  transactions?: Transaction[];
  limit?: number;
  className?: string;
}

export function RecentTransactions({ 
  transactions = [], 
  limit = 5,
  className 
}: RecentTransactionsProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', { 
      day: '2-digit', 
      month: '2-digit',
      year: 'numeric'
    });
  };

  const displayTransactions = transactions.slice(0, limit);

  return (
    <Card className={cn("h-full", className)}>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Últimos Lançamentos</CardTitle>
          {transactions.length > limit && (
            <Link 
              to="/lancamentos" 
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              Ver todas
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {displayTransactions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">Nenhum lançamento recente</p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayTransactions.map((transaction) => (
              <div
                key={transaction.id}
                className="flex items-start gap-3 px-4 py-3 rounded-md hover:bg-muted/50 transition-colors cursor-pointer"
              >
                <div className={cn(
                  "mt-0.5",
                  transaction.tipo === 'entrada' ? "text-success" : "text-destructive"
                )}>
                  {transaction.tipo === 'entrada' ? (
                    <ArrowUpCircle className="h-5 w-5" />
                  ) : (
                    <ArrowDownCircle className="h-5 w-5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {transaction.descricao}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDate(transaction.data)}
                  </p>
                </div>
                <div className={cn(
                  "text-sm font-semibold",
                  transaction.tipo === 'entrada' ? "text-success" : "text-destructive"
                )}>
                  {transaction.tipo === 'entrada' ? '+' : '-'} {formatCurrency(Math.abs(transaction.valor))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


