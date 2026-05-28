'use client';

import { ProtectedRoute } from '@/components/ProtectedRoute';
import { MainLayout } from '@/components/Layout/MainLayout';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <MainLayout>
        {children}
      </MainLayout>
    </ProtectedRoute>
  );
}













