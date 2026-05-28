import { supabase } from '@/integrations/supabase/client';

/**
 * Fetcher centralizado para requisições ao Supabase
 * Inclui interceptors e tratamento de erros padronizado
 */
class ApiClient {
  /**
   * Executa uma query no Supabase com tratamento de erros
   */
  async query<T = unknown>(
    table: string,
    options: {
      select?: string;
      filters?: Record<string, unknown>;
      orderBy?: { column: string; ascending?: boolean };
      limit?: number;
    } = {}
  ): Promise<{ data: T[] | null; error: Error | null }> {
    try {
      let query = supabase.from(table).select(options.select || '*');

      // Aplicar filtros
      if (options.filters) {
        Object.entries(options.filters).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            if (typeof value === 'object' && 'operator' in value) {
              // Suporte para operadores complexos
              const { operator, value: filterValue } = value as { operator: string; value: unknown };
              query = query.filter(key, operator as any, filterValue);
            } else {
              query = query.eq(key, value);
            }
          }
        });
      }

      // Aplicar ordenação
      if (options.orderBy) {
        query = query.order(options.orderBy.column, {
          ascending: options.orderBy.ascending ?? true,
        });
      }

      // Aplicar limite
      if (options.limit) {
        query = query.limit(options.limit);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(error.message || 'Erro ao buscar dados');
      }

      return { data: data as T[], error: null };
    } catch (error) {
      console.error(`[API Client] Erro ao buscar ${table}:`, error);
      return {
        data: null,
        error: error instanceof Error ? error : new Error('Erro desconhecido'),
      };
    }
  }

  /**
   * Insere um registro no Supabase
   */
  async insert<T = unknown>(
    table: string,
    data: Partial<T>
  ): Promise<{ data: T | null; error: Error | null }> {
    try {
      const { data: insertedData, error } = await supabase
        .from(table)
        .insert(data)
        .select()
        .single();

      if (error) {
        throw new Error(error.message || 'Erro ao inserir dados');
      }

      return { data: insertedData as T, error: null };
    } catch (error) {
      console.error(`[API Client] Erro ao inserir em ${table}:`, error);
      return {
        data: null,
        error: error instanceof Error ? error : new Error('Erro desconhecido'),
      };
    }
  }

  /**
   * Atualiza um registro no Supabase
   */
  async update<T = unknown>(
    table: string,
    id: string | number,
    data: Partial<T>
  ): Promise<{ data: T | null; error: Error | null }> {
    try {
      const { data: updatedData, error } = await supabase
        .from(table)
        .update(data)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw new Error(error.message || 'Erro ao atualizar dados');
      }

      return { data: updatedData as T, error: null };
    } catch (error) {
      console.error(`[API Client] Erro ao atualizar ${table}:`, error);
      return {
        data: null,
        error: error instanceof Error ? error : new Error('Erro desconhecido'),
      };
    }
  }

  /**
   * Deleta um registro no Supabase
   */
  async delete(
    table: string,
    id: string | number
  ): Promise<{ error: Error | null }> {
    try {
      const { error } = await supabase.from(table).delete().eq('id', id);

      if (error) {
        throw new Error(error.message || 'Erro ao deletar dados');
      }

      return { error: null };
    } catch (error) {
      console.error(`[API Client] Erro ao deletar de ${table}:`, error);
      return {
        error: error instanceof Error ? error : new Error('Erro desconhecido'),
      };
    }
  }
}

export const apiClient = new ApiClient();

