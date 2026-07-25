import { describe, expect, it } from 'vitest';
import {
  validateDocumentRecord,
  validateChunkRecord,
  validateChunkOffsets,
} from '../../src/knowledge/validation';
import { KnowledgeError } from '../../src/knowledge/errors';
import type { KnowledgeDocumentRecord, KnowledgeChunkRecord } from '../../src/knowledge/types';

function validDoc(overrides: Partial<KnowledgeDocumentRecord> = {}): KnowledgeDocumentRecord {
  return {
    id: 'doc-1',
    fileName: 'test.txt',
    mimeType: 'text/plain',
    byteSize: 100,
    characterCount: 95,
    importedAt: 1000,
    updatedAt: 1000,
    enabled: true,
    contentHash: 'abc123def456',
    processingVersion: 1,
    content: 'Hello, world!',
    ...overrides,
  };
}

function validChunk(overrides: Partial<KnowledgeChunkRecord> = {}): KnowledgeChunkRecord {
  return {
    id: 'doc-1_chunk_0',
    documentId: 'doc-1',
    index: 0,
    text: 'Chunk content.',
    startOffset: 0,
    endOffset: 15,
    processingVersion: 1,
    ...overrides,
  };
}

describe('validateDocumentRecord', () => {
  it('accepts a valid document', () => {
    expect(() => validateDocumentRecord(validDoc())).not.toThrow();
  });

  it('rejects null', () => {
    expect(() => validateDocumentRecord(null)).toThrow(KnowledgeError);
  });

  it('rejects undefined', () => {
    expect(() => validateDocumentRecord(undefined)).toThrow(KnowledgeError);
  });

  it('rejects empty id', () => {
    expect(() => validateDocumentRecord(validDoc({ id: '' }))).toThrow(KnowledgeError);
  });

  it('rejects non-string fileName', () => {
    expect(() => validateDocumentRecord(validDoc({ fileName: 123 as unknown as string }))).toThrow(
      KnowledgeError,
    );
  });

  it('rejects unsupported mimeType', () => {
    expect(() =>
      validateDocumentRecord(validDoc({ mimeType: 'application/json' as 'text/plain' })),
    ).toThrow(KnowledgeError);
  });

  it('rejects non-text/plain mime', () => {
    expect(() =>
      validateDocumentRecord(validDoc({ mimeType: 'application/pdf' as 'text/plain' })),
    ).toThrow(KnowledgeError);
  });

  it('rejects negative byteSize', () => {
    expect(() => validateDocumentRecord(validDoc({ byteSize: -1 }))).toThrow(KnowledgeError);
  });

  it('rejects NaN byteSize', () => {
    expect(() => validateDocumentRecord(validDoc({ byteSize: NaN }))).toThrow(KnowledgeError);
  });

  it('rejects negative characterCount', () => {
    expect(() => validateDocumentRecord(validDoc({ characterCount: -5 }))).toThrow(KnowledgeError);
  });

  it('rejects zero importedAt', () => {
    expect(() => validateDocumentRecord(validDoc({ importedAt: 0 }))).toThrow(KnowledgeError);
  });

  it('rejects NaN importedAt', () => {
    expect(() => validateDocumentRecord(validDoc({ importedAt: NaN }))).toThrow(KnowledgeError);
  });

  it('rejects negative updatedAt', () => {
    expect(() => validateDocumentRecord(validDoc({ updatedAt: -1 }))).toThrow(KnowledgeError);
  });

  it('rejects non-boolean enabled', () => {
    expect(() =>
      validateDocumentRecord(validDoc({ enabled: 'yes' as unknown as boolean })),
    ).toThrow(KnowledgeError);
  });

  it('rejects empty contentHash', () => {
    expect(() => validateDocumentRecord(validDoc({ contentHash: '' }))).toThrow(KnowledgeError);
  });

  it('rejects processingVersion of 0', () => {
    expect(() => validateDocumentRecord(validDoc({ processingVersion: 0 }))).toThrow(
      KnowledgeError,
    );
  });

  it('rejects non-integer processingVersion', () => {
    expect(() => validateDocumentRecord(validDoc({ processingVersion: 1.5 }))).toThrow(
      KnowledgeError,
    );
  });

  it('rejects missing content field', () => {
    expect(() => validateDocumentRecord(validDoc({ content: '' as string }))).not.toThrow();
    expect(() =>
      validateDocumentRecord(validDoc({ content: undefined as unknown as string })),
    ).toThrow(KnowledgeError);
  });
});

describe('validateChunkRecord', () => {
  it('accepts a valid chunk', () => {
    expect(() => validateChunkRecord(validChunk())).not.toThrow();
  });

  it('rejects null', () => {
    expect(() => validateChunkRecord(null)).toThrow(KnowledgeError);
  });

  it('rejects undefined', () => {
    expect(() => validateChunkRecord(undefined)).toThrow(KnowledgeError);
  });

  it('rejects empty chunk id', () => {
    expect(() => validateChunkRecord(validChunk({ id: '' }))).toThrow(KnowledgeError);
  });

  it('rejects empty documentId', () => {
    expect(() => validateChunkRecord(validChunk({ documentId: '' }))).toThrow(KnowledgeError);
  });

  it('rejects negative index', () => {
    expect(() => validateChunkRecord(validChunk({ index: -1 }))).toThrow(KnowledgeError);
  });

  it('rejects non-integer index', () => {
    expect(() => validateChunkRecord(validChunk({ index: 1.5 }))).toThrow(KnowledgeError);
  });

  it('rejects non-string text', () => {
    expect(() => validateChunkRecord(validChunk({ text: undefined as unknown as string }))).toThrow(
      KnowledgeError,
    );
  });

  it('rejects negative startOffset', () => {
    expect(() => validateChunkRecord(validChunk({ startOffset: -1 }))).toThrow(KnowledgeError);
  });

  it('rejects negative endOffset', () => {
    expect(() => validateChunkRecord(validChunk({ endOffset: -1 }))).toThrow(KnowledgeError);
  });

  it('rejects endOffset before startOffset', () => {
    expect(() => validateChunkRecord(validChunk({ startOffset: 10, endOffset: 5 }))).toThrow(
      KnowledgeError,
    );
  });

  it('rejects processingVersion of 0', () => {
    expect(() => validateChunkRecord(validChunk({ processingVersion: 0 }))).toThrow(KnowledgeError);
  });
});

describe('validateChunkOffsets', () => {
  it('accepts non-overlapping sorted chunks', () => {
    const chunks = [
      validChunk({ startOffset: 0, endOffset: 10, index: 0 }),
      validChunk({ startOffset: 10, endOffset: 20, index: 1 }),
    ];
    expect(() => validateChunkOffsets(chunks)).not.toThrow();
  });

  it('rejects overlapping chunks', () => {
    const chunks = [
      validChunk({ startOffset: 0, endOffset: 15, index: 0 }),
      validChunk({ startOffset: 10, endOffset: 20, index: 1 }),
    ];
    expect(() => validateChunkOffsets(chunks)).toThrow(KnowledgeError);
  });

  it('accepts empty array', () => {
    expect(() => validateChunkOffsets([])).not.toThrow();
  });

  it('handles unsorted input', () => {
    const chunks = [
      validChunk({ startOffset: 10, endOffset: 20, index: 1 }),
      validChunk({ startOffset: 0, endOffset: 10, index: 0 }),
    ];
    expect(() => validateChunkOffsets(chunks)).not.toThrow();
  });
});
