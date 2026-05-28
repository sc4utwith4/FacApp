import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Middleware simplificado - a proteção de rotas será feita no cliente
// para evitar problemas com Supabase client-side
export async function middleware(req: NextRequest) {
  // Por enquanto, apenas permitir todas as rotas
  // A proteção será feita nos componentes client-side
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

