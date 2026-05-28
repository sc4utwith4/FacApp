import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import type { TituloCobranca, TituloCobrancaInsert, StatusTitulo } from "@/types/cobranca-bancaria";
import { normalizeDateForDB } from "@/lib/utils";

interface TituloFormProps {
  titulo?: TituloCobranca | null;
  onSuccess: () => void;
  onCancel?: () => void;
  onClose?: () => void;
}

const STATUS_OPTIONS: StatusTitulo[] = [
  "ABERTO",
  "LIQUIDADO",
  "BAIXADO",
  "DEVOLVIDO",
  "PROTESTO_INSTRUIDO",
  "EM_CARTORIO",
  "ACORDO_DESCONTO",
  "DIVERGENCIA",
];

export function TituloForm({ titulo, onSuccess, onCancel, onClose }: TituloFormProps) {
  const handleCancel = () => {
    if (onCancel) onCancel();
    if (onClose) onClose();
  };
  const [formData, setFormData] = useState({
    identificador_interno: "",
    nosso_numero: "",
    seu_numero: "",
    sacado_nome: "",
    sacado_documento: "",
    valor_nominal: "",
    vencimento: "",
    data_emissao: "",
    status_atual: "ABERTO" as StatusTitulo,
    tags: [] as string[],
    cliente_codigo: "",
    registrado_banco: true,
    carteira_id: "",
    operacao_id: "",
  });

  const [tagInput, setTagInput] = useState("");

  useEffect(() => {
    if (titulo) {
      setFormData({
        identificador_interno: titulo.identificador_interno || "",
        nosso_numero: titulo.nosso_numero || "",
        seu_numero: titulo.seu_numero || "",
        sacado_nome: titulo.sacado_nome || "",
        sacado_documento: titulo.sacado_documento || "",
        valor_nominal: titulo.valor_nominal.toString(),
        vencimento: titulo.vencimento,
        data_emissao: titulo.data_emissao || "",
        status_atual: titulo.status_atual,
        tags: titulo.tags || [],
        cliente_codigo: titulo.cliente_codigo || "",
        registrado_banco: titulo.registrado_banco,
        carteira_id: titulo.carteira_id || "",
        operacao_id: titulo.operacao_id || "",
      });
    }
  }, [titulo]);

  const createMutation = useMutation({
    mutationFn: async (data: TituloCobrancaInsert) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data: profile } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", user.id)
        .single();

      if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

      const payload: TituloCobrancaInsert = {
        ...data,
        empresa_id: profile.empresa_id,
        sacado_contato: {},
        tags: formData.tags,
      };

      const { error } = await supabase
        .from("titulos_cobranca")
        .insert(payload);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Título criado com sucesso");
      onSuccess();
    },
    onError: (error) => {
      toast.error(`Erro ao criar título: ${error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<TituloCobranca>) => {
      if (!titulo) throw new Error("Título não encontrado");

      const { error } = await supabase
        .from("titulos_cobranca")
        .update(data)
        .eq("id", titulo.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Título atualizado com sucesso");
      onSuccess();
    },
    onError: (error) => {
      toast.error(`Erro ao atualizar título: ${error.message}`);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const payload = {
      identificador_interno: formData.identificador_interno || null,
      nosso_numero: formData.nosso_numero || null,
      seu_numero: formData.seu_numero || null,
      sacado_nome: formData.sacado_nome || null,
      sacado_documento: formData.sacado_documento || null,
      valor_nominal: parseFloat(formData.valor_nominal),
      vencimento: normalizeDateForDB(formData.vencimento),
      data_emissao: formData.data_emissao ? normalizeDateForDB(formData.data_emissao) : null,
      status_atual: formData.status_atual,
      tags: formData.tags,
      cliente_codigo: formData.cliente_codigo || null,
      registrado_banco: formData.registrado_banco,
      carteira_id: formData.carteira_id || null,
      operacao_id: formData.operacao_id || null,
    };

    if (titulo) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData({
        ...formData,
        tags: [...formData.tags, tagInput.trim()],
      });
      setTagInput("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    setFormData({
      ...formData,
      tags: formData.tags.filter((t) => t !== tag),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="identificador_interno">Identificador Interno</Label>
          <Input
            id="identificador_interno"
            value={formData.identificador_interno}
            onChange={(e) =>
              setFormData({ ...formData, identificador_interno: e.target.value })
            }
            placeholder="Ex: 1532/002"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="nosso_numero">Nosso Número</Label>
          <Input
            id="nosso_numero"
            value={formData.nosso_numero}
            onChange={(e) => setFormData({ ...formData, nosso_numero: e.target.value })}
            placeholder="Número do banco"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="seu_numero">Seu Número</Label>
          <Input
            id="seu_numero"
            value={formData.seu_numero}
            onChange={(e) => setFormData({ ...formData, seu_numero: e.target.value })}
            placeholder="Número do cliente"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cliente_codigo">Código do Cliente</Label>
          <Input
            id="cliente_codigo"
            value={formData.cliente_codigo}
            onChange={(e) => setFormData({ ...formData, cliente_codigo: e.target.value })}
            placeholder="Ex: 975, 301"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="sacado_nome">Nome do Sacado</Label>
          <Input
            id="sacado_nome"
            value={formData.sacado_nome}
            onChange={(e) => setFormData({ ...formData, sacado_nome: e.target.value })}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="sacado_documento">Documento do Sacado</Label>
          <Input
            id="sacado_documento"
            value={formData.sacado_documento}
            onChange={(e) => setFormData({ ...formData, sacado_documento: e.target.value })}
            placeholder="CPF/CNPJ"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="valor_nominal">Valor Nominal</Label>
          <Input
            id="valor_nominal"
            type="number"
            step="0.01"
            value={formData.valor_nominal}
            onChange={(e) => setFormData({ ...formData, valor_nominal: e.target.value })}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="vencimento">Data de Vencimento</Label>
          <Input
            id="vencimento"
            type="date"
            value={formData.vencimento}
            onChange={(e) => setFormData({ ...formData, vencimento: e.target.value })}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="data_emissao">Data de Emissão</Label>
          <Input
            id="data_emissao"
            type="date"
            value={formData.data_emissao}
            onChange={(e) => setFormData({ ...formData, data_emissao: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="status_atual">Status</Label>
          <Select
            value={formData.status_atual}
            onValueChange={(value) =>
              setFormData({ ...formData, status_atual: value as StatusTitulo })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 flex items-end">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="registrado_banco"
              checked={formData.registrado_banco}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, registrado_banco: checked === true })
              }
            />
            <Label htmlFor="registrado_banco" className="cursor-pointer">
              Registrado no Banco
            </Label>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Tags</Label>
        <div className="flex gap-2">
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddTag();
              }
            }}
            placeholder="Digite uma tag e pressione Enter"
          />
          <Button type="button" onClick={handleAddTag} variant="outline">
            Adicionar
          </Button>
        </div>
        {formData.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {formData.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-sm"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="hover:text-destructive"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={handleCancel}>
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={createMutation.isPending || updateMutation.isPending}
        >
          {createMutation.isPending || updateMutation.isPending
            ? "Salvando..."
            : titulo
              ? "Atualizar"
              : "Criar"}
        </Button>
      </div>
    </form>
  );
}

