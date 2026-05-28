import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DashboardLayoutProps {
  children: React.ReactNode;
  className?: string;
}

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: {
    value: string;
    type: "increase" | "decrease" | "neutral";
  };
  icon?: React.ReactNode;
  className?: string;
}

interface ActivityFeedProps {
  title: string;
  activities: Array<{
    id: string;
    message: string;
    timestamp: string;
    type: "success" | "warning" | "info" | "error";
  }>;
  className?: string;
}

interface ChartCardProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

// Componente para cards de métricas
export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  change,
  icon,
  className,
}) => {
  const changeColor = {
    increase: "text-success",
    decrease: "text-destructive",
    neutral: "text-muted-foreground",
  };

  return (
    <Card className={cn("hover:shadow-medium transition-shadow duration-fast", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          {icon && <div className="text-muted-foreground">{icon}</div>}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {change && (
          <p className={cn("text-xs", changeColor[change.type])}>
            {change.value}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

// Componente para feed de atividades
export const ActivityFeed: React.FC<ActivityFeedProps> = ({
  title,
  activities,
  className,
}) => {
  const typeColors = {
    success: "bg-success",
    warning: "bg-warning",
    info: "bg-primary",
    error: "bg-destructive",
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activities.map((activity) => (
            <div key={activity.id} className="flex items-center space-x-4">
              <div className={cn("w-2 h-2 rounded-full", typeColors[activity.type])} />
              <div className="flex-1">
                <p className="text-sm">{activity.message}</p>
                <p className="text-xs text-muted-foreground">{activity.timestamp}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

// Componente para cards de gráficos
export const ChartCard: React.FC<ChartCardProps> = ({
  title,
  children,
  className,
}) => {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {children}
      </CardContent>
    </Card>
  );
};

// Layout principal do dashboard com Bento Grid
export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  children,
  className,
}) => {
  return (
    <div className={cn("space-y-6", className)}>
      {/* Grid de métricas */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {children}
      </div>
    </div>
  );
};

// Layout para seções maiores (gráficos, tabelas)
export const DashboardSection: React.FC<DashboardLayoutProps> = ({
  children,
  className,
}) => {
  return (
    <div className={cn("grid grid-cols-1 lg:grid-cols-2 gap-6", className)}>
      {children}
    </div>
  );
};

// Layout para tabelas completas
export const DashboardFullWidth: React.FC<DashboardLayoutProps> = ({
  children,
  className,
}) => {
  return (
    <div className={cn("w-full", className)}>
      {children}
    </div>
  );
};





