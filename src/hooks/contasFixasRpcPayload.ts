import { normalizeDateForDB } from '@/lib/utils';
import { ensureUUID } from '@/lib/uuid';
import type { CreateContaFixa, UpdateContaFixa } from '@/types/contas-fixas';

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DATE_PREFIX_REGEX = /^\d{4}-\d{2}-\d{2}/;

type SupabaseErrorLike = {
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  message?: string | null;
};

type ContaFixaUpdateInput = Omit<UpdateContaFixa, 'id'>;

type CreateContaFixaRpcPayload = {
  p_descricao: string;
  p_natureza: string;
  p_grupo_contas_id: string;
  p_conta_bancaria_id: string;
  p_periodicidade: string;
  p_dia_ref: number;
  p_valor: number;
  p_proximo_evento: string;
  p_weekday_ref: number | null;
  p_ativo: boolean;
  p_tolerancia_dias: number;
  p_observacoes: string | null;
};

type UpdateContaFixaRpcPayload = {
  p_id: number;
  p_descricao: string | null;
  p_natureza: string | null;
  p_grupo_contas_id: string | null;
  p_conta_bancaria_id: string | null;
  p_periodicidade: string | null;
  p_dia_ref: number | null;
  p_weekday_ref: number | null;
  p_valor: number | null;
  p_ativo: boolean | null;
  p_proximo_evento: string | null;
  p_tolerancia_dias: number | null;
  p_observacoes: string | null;
};

export type ContaFixaRpcErrorDetails = {
  code: string | null;
  details: string | null;
  hint: string | null;
  message: string;
};

function hasOwnProperty<T extends object>(value: T, key: keyof T) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeOptionalText(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return value ?? null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeContaFixaDate(value: string | Date | null | undefined) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    // Prefer the literal date prefix when it is already present to avoid timezone drift.
    if (DATE_PREFIX_REGEX.test(trimmed)) {
      const datePart = trimmed.slice(0, 10);
      if (DATE_ONLY_REGEX.test(datePart)) {
        return datePart;
      }
    }

    const normalized = normalizeDateForDB(trimmed);
    const normalizedTrimmed = normalizeOptionalText(normalized);

    if (!normalizedTrimmed) {
      return null;
    }

    if (DATE_ONLY_REGEX.test(normalizedTrimmed)) {
      return normalizedTrimmed;
    }

    throw new Error('Formato de data inválido. Use YYYY-MM-DD');
  }

  const normalized = normalizeDateForDB(value);
  const normalizedTrimmed = normalizeOptionalText(normalized);

  if (!normalizedTrimmed) {
    return null;
  }

  if (DATE_ONLY_REGEX.test(normalizedTrimmed)) {
    return normalizedTrimmed;
  }

  throw new Error('Formato de data inválido. Use YYYY-MM-DD');
}

function requireUuid(value: unknown, errorMessage: string) {
  const uuid = ensureUUID(value);

  if (!uuid) {
    throw new Error(errorMessage);
  }

  return uuid;
}

function getOptionalUuidForUpdate(
  data: ContaFixaUpdateInput,
  field: 'grupo_contas_id' | 'conta_bancaria_id',
  errorMessage: string,
) {
  if (!hasOwnProperty(data, field)) {
    return null;
  }

  return requireUuid(data[field], errorMessage);
}

export function buildCreateContaFixaRpcPayload(data: CreateContaFixa): CreateContaFixaRpcPayload {
  const normalizedDate = normalizeContaFixaDate(data.proximo_evento);

  if (!normalizedDate) {
    throw new Error('Próximo evento é obrigatório.');
  }

  return {
    p_descricao: data.descricao,
    p_natureza: data.natureza,
    p_grupo_contas_id: requireUuid(data.grupo_contas_id, 'Grupo de contas inválido.'),
    p_conta_bancaria_id: requireUuid(data.conta_bancaria_id, 'Conta bancária inválida.'),
    p_periodicidade: data.periodicidade,
    p_dia_ref: data.dia_ref,
    p_valor: data.valor,
    p_proximo_evento: normalizedDate,
    p_weekday_ref: data.weekday_ref ?? null,
    p_ativo: data.ativo ?? true,
    p_tolerancia_dias: data.tolerancia_dias ?? 0,
    p_observacoes: data.observacoes ?? null,
  };
}

export function buildUpdateContaFixaRpcPayload({ id, ...data }: UpdateContaFixa): UpdateContaFixaRpcPayload {
  return {
    p_id: id,
    p_descricao: data.descricao ?? null,
    p_natureza: data.natureza ?? null,
    p_grupo_contas_id: getOptionalUuidForUpdate(data, 'grupo_contas_id', 'Grupo de contas inválido.'),
    p_conta_bancaria_id: getOptionalUuidForUpdate(data, 'conta_bancaria_id', 'Conta bancária inválida.'),
    p_periodicidade: data.periodicidade ?? null,
    p_dia_ref: data.dia_ref ?? null,
    p_weekday_ref: data.weekday_ref ?? null,
    p_valor: data.valor ?? null,
    p_ativo: data.ativo ?? null,
    p_proximo_evento: normalizeContaFixaDate(data.proximo_evento),
    p_tolerancia_dias: data.tolerancia_dias ?? null,
    p_observacoes: hasOwnProperty(data, 'observacoes') ? data.observacoes ?? null : null,
  };
}

export function extractContaFixaRpcErrorDetails(error: unknown): ContaFixaRpcErrorDetails {
  const maybeError = (error && typeof error === 'object' ? error : {}) as SupabaseErrorLike;
  const fallbackMessage = error instanceof Error ? error.message : 'Erro desconhecido ao salvar conta fixa.';

  return {
    code: typeof maybeError.code === 'string' && maybeError.code.trim() ? maybeError.code.trim() : null,
    details: typeof maybeError.details === 'string' && maybeError.details.trim() ? maybeError.details.trim() : null,
    hint: typeof maybeError.hint === 'string' && maybeError.hint.trim() ? maybeError.hint.trim() : null,
    message:
      typeof maybeError.message === 'string' && maybeError.message.trim()
        ? maybeError.message.trim()
        : fallbackMessage,
  };
}

export function formatContaFixaRpcError(error: unknown) {
  const { code, details, hint, message } = extractContaFixaRpcErrorDetails(error);
  const parts = [message];

  if (details) {
    parts.push(`Detalhes: ${details}`);
  }

  if (hint) {
    parts.push(`Dica: ${hint}`);
  }

  if (code) {
    parts.push(`Código: ${code}`);
  }

  return parts.join(' ');
}
