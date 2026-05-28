import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type React from 'react';
import { AppShell } from '@/components/Layout/app-shell';
import { ActivityFeed, DashboardLayout, MetricCard } from '@/components/Layout/dashboard-layout';

const authSubscription = { unsubscribe: vi.fn() };
const queryBuilder = {
  eq: vi.fn(() => queryBuilder),
  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  single: vi.fn().mockResolvedValue({ data: null, error: null }),
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: authSubscription } })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => queryBuilder),
    })),
  },
}));

const renderWithRouter = (component: React.ReactElement) =>
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {component}
    </MemoryRouter>
  );

describe('Layout Integration Tests', () => {
  it('renderiza AppShell com navbar e conteudo', async () => {
    renderWithRouter(
      <AppShell>
        <div>Main Content</div>
      </AppShell>
    );

    await waitFor(() => {
      expect(screen.getByText('Main Content')).toBeInTheDocument();
    });

    expect(screen.getAllByText('ASSFAC').length).toBeGreaterThan(0);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Financeiro')).toBeInTheDocument();
    expect(screen.getByText('Main Content')).toBeInTheDocument();
  });

  it('renderiza metricas no grid atual do DashboardLayout', () => {
    renderWithRouter(
      <DashboardLayout>
        <MetricCard
          title="Faturamento"
          value="R$ 50.000"
          change={{ value: '+12%', type: 'increase' }}
          icon={<span>💰</span>}
        />
        <MetricCard
          title="Clientes"
          value="342"
          change={{ value: '5 novos', type: 'neutral' }}
          icon={<span>👥</span>}
        />
      </DashboardLayout>
    );

    expect(screen.getByText('Faturamento')).toBeInTheDocument();
    expect(screen.getByText('R$ 50.000')).toBeInTheDocument();
    expect(screen.getByText('+12%')).toBeInTheDocument();
    expect(screen.getByText('Clientes')).toBeInTheDocument();
    expect(screen.getByText('342')).toBeInTheDocument();

    const root = screen.getByText('Faturamento').closest('div[class*="space-y-6"]');
    expect(root).toBeInTheDocument();
  });

  it('renderiza feed de atividades com indicadores', () => {
    const activities = [
      {
        id: '1',
        message: 'Novo lançamento criado',
        timestamp: 'Há 2 horas',
        type: 'success' as const,
      },
      {
        id: '2',
        message: 'Erro na sincronização',
        timestamp: 'Há 4 horas',
        type: 'error' as const,
      },
      {
        id: '3',
        message: 'Atenção: Vencimento próximo',
        timestamp: 'Há 6 horas',
        type: 'warning' as const,
      },
    ];

    renderWithRouter(<ActivityFeed title="Atividades Recentes" activities={activities} />);

    expect(screen.getByText('Atividades Recentes')).toBeInTheDocument();
    expect(screen.getByText('Novo lançamento criado')).toBeInTheDocument();
    expect(screen.getByText('Erro na sincronização')).toBeInTheDocument();
    expect(screen.getByText('Atenção: Vencimento próximo')).toBeInTheDocument();

    const indicators = document.querySelectorAll('div.w-2.h-2.rounded-full');
    expect(indicators.length).toBe(3);
  });
});
