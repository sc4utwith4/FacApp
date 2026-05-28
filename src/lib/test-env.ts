// Arquivo temporário para testar variáveis de ambiente
export function testEnvVars() {
  if (typeof process !== 'undefined' && process.env) {
    console.log('🔍 Testando variáveis de ambiente:');
    console.log('NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL || 'NOT FOUND');
    console.log('NEXT_PUBLIC_SUPABASE_ANON_KEY:', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'EXISTS' : 'NOT FOUND');
    console.log('VITE_SUPABASE_URL:', process.env.VITE_SUPABASE_URL || 'NOT FOUND');
    console.log('VITE_SUPABASE_PUBLISHABLE_KEY:', process.env.VITE_SUPABASE_PUBLISHABLE_KEY ? 'EXISTS' : 'NOT FOUND');
  }
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    console.log('🔍 Testando import.meta.env:');
    console.log('VITE_SUPABASE_URL:', import.meta.env.VITE_SUPABASE_URL || 'NOT FOUND');
  }
}

