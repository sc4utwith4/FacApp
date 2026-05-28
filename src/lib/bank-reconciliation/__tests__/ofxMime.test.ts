import { describe, expect, it } from 'vitest';
import {
  buildOfxUploadContentTypeRetrySequence,
  isRetryableStorageUploadStatus,
  parseStorageUploadErrorDetails,
  resolveOfxUploadContentType,
} from '@/lib/bank-reconciliation/ofxMime';

describe('resolveOfxUploadContentType', () => {
  it('força application/x-ofx para extensão .ofx mesmo com file.type vazio', () => {
    expect(resolveOfxUploadContentType('extrato.ofx', '')).toBe('application/x-ofx');
  });

  it('força application/x-ofx para extensão .OFX maiúscula', () => {
    expect(resolveOfxUploadContentType('Extrato_Bradesco.OFX', null)).toBe('application/x-ofx');
  });

  it('mantém tipos OFX/XML válidos quando não há extensão .ofx', () => {
    expect(resolveOfxUploadContentType('arquivo.txt', 'application/ofx')).toBe('application/ofx');
    expect(resolveOfxUploadContentType('arquivo.txt', 'application/xml')).toBe('application/xml');
    expect(resolveOfxUploadContentType('arquivo.txt', 'text/xml')).toBe('text/xml');
  });

  it('monta sequência de retry com fallback estável para OFX', () => {
    expect(buildOfxUploadContentTypeRetrySequence('arquivo.ofx', '')).toEqual([
      'application/x-ofx',
      'application/ofx',
      'text/plain',
    ]);
  });

  it('extrai status/mensagem de erro do storage para diagnóstico', () => {
    expect(
      parseStorageUploadErrorDetails({
        statusCode: '400',
        error: 'InvalidMimeType',
        message: 'mime type not allowed',
      })
    ).toEqual({
      status: 400,
      error: 'InvalidMimeType',
      message: 'mime type not allowed',
    });
  });

  it('marca retry apenas para status 400', () => {
    expect(isRetryableStorageUploadStatus(400)).toBe(true);
    expect(isRetryableStorageUploadStatus(409)).toBe(false);
    expect(isRetryableStorageUploadStatus(null)).toBe(false);
  });
});
