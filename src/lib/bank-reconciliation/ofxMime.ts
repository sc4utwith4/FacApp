const OFX_EXT_REGEX = /\.ofx$/i;

export const resolveOfxUploadContentType = (
  fileName: string,
  fileType?: string | null
): string => {
  if (OFX_EXT_REGEX.test(String(fileName || '').trim())) {
    return 'application/x-ofx';
  }

  const normalizedType = String(fileType || '').trim().toLowerCase();
  if (
    normalizedType === 'application/x-ofx' ||
    normalizedType === 'application/ofx' ||
    normalizedType === 'application/xml' ||
    normalizedType === 'text/xml'
  ) {
    return normalizedType;
  }

  return 'application/x-ofx';
};

export const buildOfxUploadContentTypeRetrySequence = (
  fileName: string,
  fileType?: string | null
): string[] => {
  const primary = resolveOfxUploadContentType(fileName, fileType);
  const candidates = [primary, 'application/ofx', 'text/plain'];
  return Array.from(new Set(candidates.filter(Boolean)));
};

export interface StorageUploadErrorDetails {
  status: number | null;
  error: string | null;
  message: string;
}

export const parseStorageUploadErrorDetails = (error: unknown): StorageUploadErrorDetails => {
  if (!error || typeof error !== 'object') {
    return {
      status: null,
      error: null,
      message: 'Erro desconhecido no upload para storage.',
    };
  }

  const raw = error as Record<string, unknown>;
  const rawStatus = raw.statusCode ?? raw.status;
  const parsedStatus = Number(rawStatus);
  const status = Number.isFinite(parsedStatus) ? parsedStatus : null;

  const errorCode =
    typeof raw.error === 'string'
      ? raw.error
      : typeof raw.code === 'string'
        ? raw.code
        : null;
  const message =
    typeof raw.message === 'string' && raw.message.trim()
      ? raw.message.trim()
      : 'Erro no upload para storage.';

  return {
    status,
    error: errorCode,
    message,
  };
};

export const isRetryableStorageUploadStatus = (status: number | null | undefined): boolean =>
  Number(status) === 400;
