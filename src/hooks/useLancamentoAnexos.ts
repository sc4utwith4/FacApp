import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { LancamentoAnexo } from "@/types/lancamentos";

const LANCAMENTOS_ANEXOS_BUCKET = "lancamentos-comprovantes";

const sanitizeFileName = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");

const buildStorageKey = (empresaId: string, lancamentoId: string, originalName: string): string => {
  const timestamp = Date.now();
  const safeName = sanitizeFileName(originalName || `anexo-${timestamp}`);
  return `${empresaId}/${lancamentoId}/${timestamp}-${safeName}`;
};

export function useLancamentoAnexos(empresaId: string | null, lancamentoId: string | null) {
  const queryClient = useQueryClient();

  const queryKey = ["lancamentos-anexos", empresaId, lancamentoId] as const;

  const anexosQuery = useQuery({
    queryKey,
    queryFn: async () => {
      if (!empresaId || !lancamentoId) return [] as LancamentoAnexo[];

      const { data, error } = await supabase
        .from("lancamentos_anexos")
        .select(
          "id,empresa_id,lancamento_caixa_id,storage_bucket,storage_key,nome_arquivo,mime_type,tamanho_bytes,uploaded_by,created_at"
        )
        .eq("empresa_id", empresaId)
        .eq("lancamento_caixa_id", lancamentoId)
        .order("created_at", { ascending: false });

      if (error) {
        throw new Error(error.message || "Erro ao buscar anexos.");
      }

      return (data || []) as LancamentoAnexo[];
    },
    enabled: Boolean(empresaId && lancamentoId),
  });

  const uploadAnexoMutation = useMutation({
    mutationFn: async ({ file }: { file: File }) => {
      if (!empresaId || !lancamentoId) {
        throw new Error("Selecione um lançamento válido para anexar arquivos.");
      }

      const storageKey = buildStorageKey(empresaId, lancamentoId, file.name);

      const { error: uploadError } = await supabase.storage
        .from(LANCAMENTOS_ANEXOS_BUCKET)
        .upload(storageKey, file, {
          upsert: false,
          contentType: file.type || undefined,
        });

      if (uploadError) {
        throw new Error(uploadError.message || "Erro no upload do anexo.");
      }

      const { data: authData } = await supabase.auth.getUser();

      const payload = {
        empresa_id: empresaId,
        lancamento_caixa_id: lancamentoId,
        storage_bucket: LANCAMENTOS_ANEXOS_BUCKET,
        storage_key: storageKey,
        nome_arquivo: file.name,
        mime_type: file.type || null,
        tamanho_bytes: file.size,
        uploaded_by: authData.user?.id || null,
      };

      const { data: inserted, error: insertError } = await supabase
        .from("lancamentos_anexos")
        .insert(payload)
        .select(
          "id,empresa_id,lancamento_caixa_id,storage_bucket,storage_key,nome_arquivo,mime_type,tamanho_bytes,uploaded_by,created_at"
        )
        .single();

      if (insertError) {
        await supabase.storage.from(LANCAMENTOS_ANEXOS_BUCKET).remove([storageKey]).catch(() => null);
        throw new Error(insertError.message || "Erro ao registrar metadados do anexo.");
      }

      return inserted as LancamentoAnexo;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Anexo enviado com sucesso.");
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Erro ao enviar anexo.";
      toast.error(message);
    },
  });

  const removeAnexoMutation = useMutation({
    mutationFn: async (anexo: LancamentoAnexo) => {
      const { error: storageError } = await supabase.storage
        .from(anexo.storage_bucket || LANCAMENTOS_ANEXOS_BUCKET)
        .remove([anexo.storage_key]);

      if (storageError) {
        throw new Error(storageError.message || "Erro ao remover arquivo do storage.");
      }

      const { error: deleteError } = await supabase
        .from("lancamentos_anexos")
        .delete()
        .eq("id", anexo.id)
        .eq("empresa_id", anexo.empresa_id);

      if (deleteError) {
        throw new Error(deleteError.message || "Erro ao remover metadados do anexo.");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Anexo removido com sucesso.");
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Erro ao remover anexo.";
      toast.error(message);
    },
  });

  const openAnexoMutation = useMutation({
    mutationFn: async (anexo: LancamentoAnexo) => {
      const { data, error } = await supabase.storage
        .from(anexo.storage_bucket || LANCAMENTOS_ANEXOS_BUCKET)
        .createSignedUrl(anexo.storage_key, 60 * 10);

      if (error || !data?.signedUrl) {
        throw new Error(error?.message || "Erro ao abrir anexo.");
      }

      return data.signedUrl;
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Erro ao abrir anexo.";
      toast.error(message);
    },
  });

  return {
    anexosQuery,
    uploadAnexoMutation,
    removeAnexoMutation,
    openAnexoMutation,
  };
}
