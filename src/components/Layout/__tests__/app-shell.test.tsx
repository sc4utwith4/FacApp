import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type React from 'react';
import { AppShell } from '../app-shell';

const mockMenu = [
  { title: 'Dashboard', url: '/' },
  { title: 'Financeiro', url: '/financeiro' },
];

vi.mock('@/hooks/useNavbarMenu', () => ({
  useNavbarMenu: () => ({ menu: mockMenu, loading: false }),
}));

vi.mock('@/components/ui/navbar1', () => ({
  Navbar1: ({ menu, logo }: { menu: Array<{ title: string }>; logo: { title: string } }) => (
    <header data-testid="navbar1">
      <span>{logo.title}</span>
      {menu.map((item) => (
        <span key={item.title}>{item.title}</span>
      ))}
    </header>
  ),
}));

const renderAppShell = (props?: Partial<React.ComponentProps<typeof AppShell>>) =>
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppShell {...props}>
        <div>Main Content</div>
      </AppShell>
    </MemoryRouter>
  );

describe('AppShell Component', () => {
  it('renderiza navbar e conteudo principal', () => {
    renderAppShell();

    expect(screen.getByTestId('navbar1')).toBeInTheDocument();
    expect(screen.getByText('ASSFAC')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Financeiro')).toBeInTheDocument();
    expect(screen.getByText('Main Content')).toBeInTheDocument();
  });

  it('aplica className customizada no main', () => {
    renderAppShell({ className: 'custom-app-shell' });

    const main = screen.getByRole('main');
    expect(main).toHaveClass('custom-app-shell');
  });

  it('mantem estrutura de layout esperada', () => {
    renderAppShell();

    const main = screen.getByRole('main');
    expect(main).toHaveClass('flex-1', 'overflow-y-auto', 'bg-background');

    const contentContainer = main.firstElementChild;
    expect(contentContainer).toHaveClass('mx-auto', 'max-w-7xl', 'w-full', 'min-w-0');
  });

  it('nao quebra ao receber props legadas opcionais', () => {
    renderAppShell({
      headerActions: <button type="button">Acao</button>,
      sidebarItems: [
        {
          title: 'Legacy',
          icon: <span>L</span>,
          href: '/legacy',
        },
      ],
    });

    expect(screen.getByText('Main Content')).toBeInTheDocument();
  });
});
