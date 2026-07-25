import type { KnowledgeDocumentRecord, KnowledgeChunkRecord } from './types';
import { KnowledgeError } from './errors';

export function validateDocumentRecord(
  doc: Partial<KnowledgeDocumentRecord> | undefined | null,
  context?: string,
): asserts doc is KnowledgeDocumentRecord {
  if (!doc || typeof doc !== 'object')
    throw validationError('Document record is not an object', context);

  if (typeof doc.id !== 'string' || !doc.id)
    throw validationError('Missing or invalid document id', context);

  if (typeof doc.fileName !== 'string')
    throw validationError('Missing or invalid fileName', context);

  if (doc.mimeType !== 'text/plain')
    throw validationError(`Unsupported mimeType: ${doc.mimeType}`, context);

  if (typeof doc.byteSize !== 'number' || doc.byteSize < 0 || !Number.isFinite(doc.byteSize))
    throw validationError('Invalid byteSize', context);

  if (
    typeof doc.characterCount !== 'number' ||
    doc.characterCount < 0 ||
    !Number.isFinite(doc.characterCount)
  )
    throw validationError('Invalid characterCount', context);

  if (typeof doc.importedAt !== 'number' || doc.importedAt <= 0 || !Number.isFinite(doc.importedAt))
    throw validationError('Invalid importedAt', context);

  if (typeof doc.updatedAt !== 'number' || doc.updatedAt <= 0 || !Number.isFinite(doc.updatedAt))
    throw validationError('Invalid updatedAt', context);

  if (typeof doc.enabled !== 'boolean') throw validationError('Invalid enabled flag', context);

  if (typeof doc.contentHash !== 'string' || !doc.contentHash)
    throw validationError('Missing or invalid contentHash', context);

  if (
    typeof doc.processingVersion !== 'number' ||
    doc.processingVersion < 1 ||
    !Number.isInteger(doc.processingVersion)
  )
    throw validationError('Invalid processingVersion', context);

  if (typeof doc.content !== 'string') throw validationError('Missing or invalid content', context);
}

export function validateChunkRecord(
  chunk: Partial<KnowledgeChunkRecord> | undefined | null,
  context?: string,
): asserts chunk is KnowledgeChunkRecord {
  if (!chunk || typeof chunk !== 'object')
    throw validationError('Chunk record is not an object', context);

  if (typeof chunk.id !== 'string' || !chunk.id)
    throw validationError('Missing or invalid chunk id', context);

  if (typeof chunk.documentId !== 'string' || !chunk.documentId)
    throw validationError('Missing or invalid chunk documentId', context);

  if (typeof chunk.index !== 'number' || chunk.index < 0 || !Number.isInteger(chunk.index))
    throw validationError('Invalid chunk index', context);

  if (typeof chunk.text !== 'string')
    throw validationError('Missing or invalid chunk text', context);

  if (
    typeof chunk.startOffset !== 'number' ||
    chunk.startOffset < 0 ||
    !Number.isInteger(chunk.startOffset)
  )
    throw validationError('Invalid chunk startOffset', context);

  if (
    typeof chunk.endOffset !== 'number' ||
    chunk.endOffset < 0 ||
    !Number.isInteger(chunk.endOffset)
  )
    throw validationError('Invalid chunk endOffset', context);

  if (chunk.endOffset < chunk.startOffset)
    throw validationError('Chunk endOffset is before startOffset', context);

  if (
    typeof chunk.processingVersion !== 'number' ||
    chunk.processingVersion < 1 ||
    !Number.isInteger(chunk.processingVersion)
  )
    throw validationError('Invalid chunk processingVersion', context);
}

export function validateChunkOffsets(chunks: KnowledgeChunkRecord[], context?: string): void {
  if (chunks.length === 0) return;

  const sorted = [...chunks].sort((a, b) => a.index - b.index);

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].endOffset > sorted[i].startOffset) {
      throw validationError(
        `Overlapping chunks at index ${sorted[i - 1].index} and ${sorted[i].index}`,
        context,
      );
    }
  }
}

function validationError(message: string, context?: string): KnowledgeError {
  return new KnowledgeError(
    'KNOWLEDGE_VALIDATION_FAILED',
    context ? `${context}: ${message}` : message,
    message,
  );
}
