/**
 * Cliente Supabase Admin para operações que requerem privilégios de admin
 * 
 * IMPORTANTE: Este cliente deve ser usado apenas no servidor/backend.
 * Para uso no frontend, use apenas quando necessário e com cuidado.
 * 
 * NOTA: No frontend, você precisará usar Edge Functions ou um backend
 * para fazer chamadas admin, pois o service_role key não deve ser
 * exposto no frontend.
 */

import { createClient } from "@supabase/supabase-js";

// Para uso no frontend, você precisará criar uma Edge Function
// ou usar um backend que tenha o service_role key
// Por enquanto, vamos usar o cliente regular e verificar permissões

export const getAdminClient = () => {
  // IMPORTANTE: Service role key NÃO deve ser usado no frontend
  // Para uso no frontend, você precisará:
  // 1. Criar uma Edge Function no Supabase
  // 2. Ou usar um backend que tenha o service_role key
  // 3. Ou usar RLS policies que permitam super admin fazer operações
  
  // Por enquanto, retornamos null para forçar uso de Edge Functions
  // ou backend para operações admin
  return null;
};

/**
 * Verifica se o usuário atual tem permissão para fazer operações admin
 * Isso deve ser verificado no frontend antes de chamar funções admin
 */
export const canPerformAdminActions = async (): Promise<boolean> => {
  // Esta verificação será feita via RLS policies no banco
  // ou via Edge Functions que verificam is_super_admin
  return false;
};


