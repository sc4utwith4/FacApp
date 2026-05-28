import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface Alert {
  id: string;
  type: 'vencimento' | 'saldo-negativo' | 'conciliacao' | 'info';
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

interface AlertsWidgetProps {
  alerts?: Alert[];
  className?: string;
}

export function AlertsWidget({ alerts = [], className }: AlertsWidgetProps) {
  const unreadCount = alerts.length;

  const getIcon = (type: Alert['type']) => {
    switch (type) {
      case 'vencimento':
      case 'saldo-negativo':
        return <AlertTriangle className="h-4 w-4" />;
      case 'conciliacao':
        return <AlertCircle className="h-4 w-4" />;
      default:
        return <Info className="h-4 w-4" />;
    }
  };

  const getSeverityColor = (severity: Alert['severity']) => {
    switch (severity) {
      case 'error':
        return 'text-destructive';
      case 'warning':
        return 'text-warning';
      default:
        return 'text-primary';
    }
  };

  return (
    <Card className={cn("h-full", className)}>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Alertas e Notificações</CardTitle>
          {unreadCount > 0 && (
            <Badge variant="destructive" className="ml-2">
              {unreadCount}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Info className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Nenhum alerta no momento</p>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-start gap-3 px-4 py-3 rounded-md hover:bg-muted/50 transition-colors"
              >
                <div className={cn("mt-0.5", getSeverityColor(alert.severity))}>
                  {getIcon(alert.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {alert.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {alert.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


