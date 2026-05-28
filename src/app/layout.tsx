import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import '../index.css';
import { Providers } from './providers';

const inter = Inter({ 
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ASSFAC - Sistema Financeiro Integrado',
  description: 'Sistema Financeiro Integrado para controle de caixa e gestão financeira',
  authors: [{ name: 'ASSFAC Team' }],
  keywords: ['financeiro', 'caixa', 'gestão', 'contabilidade'],
  openGraph: {
    title: 'ASSFAC - Sistema Financeiro Integrado',
    description: 'Sistema Financeiro Integrado para controle de caixa e gestão financeira',
    type: 'website',
    images: ['/og-image.png'],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@assfac',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" translate="no" className="notranslate" suppressHydrationWarning>
      <body translate="no" className={`${inter.variable} font-sans antialiased notranslate`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
