/**
 * Sanitiza nome do arquivo para ser URL-safe.
 */
export function sanitizarNomeArquivo(nome: string): string {
  // Remover espacos e caracteres especiais, manter apenas alfanumericos, hifen, underscore e ponto
  return nome
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .toLowerCase();
}
