import type { ChatSession } from '@/types/bank-reconciliation';

const STORAGE_PREFIX = 'bank-reconciliation-chat';

function storageKey(
  empresaId: string,
  contaId?: string | null,
  dataReferencia?: string | null,
  importId?: string | null
): string {
  const parts = [empresaId, contaId ?? '', dataReferencia ?? '', importId ?? ''];
  return `${STORAGE_PREFIX}-${parts.join('-')}`;
}

function getStored(key: string): ChatSession | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as ChatSession;
  } catch {
    return null;
  }
}

function setStored(key: string, session: ChatSession): void {
  try {
    localStorage.setItem(key, JSON.stringify(session));
  } catch {
    // quota or disabled
  }
}

export function saveChatSession(session: ChatSession): void {
  const key = storageKey(
    session.empresaId,
    session.contaId,
    session.dataReferencia,
    session.importId
  );
  setStored(key, {
    ...session,
    updatedAt: new Date().toISOString(),
  });
}

export function loadChatSession(
  empresaId: string,
  contaId?: string | null,
  dataReferencia?: string | null,
  importId?: string | null
): ChatSession | null {
  const key = storageKey(empresaId, contaId, dataReferencia, importId);
  return getStored(key);
}

export function clearChatSession(
  empresaId: string,
  contaId?: string | null,
  dataReferencia?: string | null,
  importId?: string | null
): void {
  try {
    localStorage.removeItem(storageKey(empresaId, contaId, dataReferencia, importId));
  } catch {
    // ignore
  }
}

export function listChatSessions(empresaId: string): ChatSession[] {
  const out: ChatSession[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      const session = getStored(key);
      if (session && session.empresaId === empresaId) {
        out.push(session);
      }
    }
    out.sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
  } catch {
    // ignore
  }
  return out;
}
