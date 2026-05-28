'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function NotFound() {
  useEffect(() => {
    console.error('404 Error: User attempted to access non-existent route');
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/10">
      <div className="text-center space-y-6 px-4">
        <div className="space-y-2">
          <h1 className="text-6xl font-bold text-foreground">404</h1>
          <h2 className="text-2xl font-semibold text-foreground">Página não encontrada</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            A página que você está procurando não existe ou foi movida.
          </p>
        </div>
        <div className="flex gap-4 justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Voltar para Home
          </Link>
          <Link
            href="/auth"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Fazer Login
          </Link>
        </div>
      </div>
    </div>
  );
}

