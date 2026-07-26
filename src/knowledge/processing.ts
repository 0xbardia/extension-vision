/**
 * Knowledge document processing module.
 *
 * Handles backfill processing of existing v1 documents (zero chunks)
 * and provides processing status APIs.
 */

import type {
  KnowledgeDocumentRecord,
  KnowledgeProcessingResult,
  KnowledgeProcessingStatus,
} from './types';
import { KNOWLEDGE_PROCESSING_VERSION } from './types';
import { KnowledgeError } from './errors';
import { listDocuments, getChunksForDocument, replaceDocumentChunks } from './repository';
import { chunkDocument, documentNeedsProcessing } from './chunking';

let processingInProgress = false;

/**
 * Process a single document: chunk it and persist chunks atomically.
 *
 * Returns a typed result. Never throws to the caller.
 * Repeated invocation on a healthy v2 document is idempotent.
 */
export async function processKnowledgeDocument(
  documentId: string,
): Promise<KnowledgeProcessingResult> {
  try {
    const { getDocument } = await import('./repository');
    const doc = await getDocument(documentId);
    if (!doc) {
      return {
        status: 'failed',
        documentId,
        errorCode: 'KNOWLEDGE_DOCUMENT_NOT_FOUND',
        message: 'Document not found.',
      };
    }

    const chunks = await getChunksForDocument(documentId);
    const hasChunks = chunks.length > 0;

    // Check if document needs processing
    if (!documentNeedsProcessing(doc.processingVersion, hasChunks, doc.content)) {
      return {
        status: 'skipped',
        documentId,
        reason: 'already-current',
      };
    }

    // Chunk the document
    const newChunks = chunkDocument(documentId, doc.content);

    // Store atomically
    await replaceDocumentChunks(documentId, newChunks, KNOWLEDGE_PROCESSING_VERSION);

    return {
      status: 'processed',
      documentId,
      chunkCount: newChunks.length,
    };
  } catch (err) {
    return {
      status: 'failed',
      documentId,
      errorCode: err instanceof KnowledgeError ? err.code : 'KNOWLEDGE_PROCESSING_FAILED',
      message: err instanceof Error ? err.message : 'Processing failed.',
    };
  }
}

/**
 * Process all pending documents that need chunking.
 *
 * Runs sequentially in deterministic document order.
 * One failure does not prevent other documents from being processed.
 * Returns results for every processed document.
 */
export async function processPendingKnowledgeDocuments(): Promise<KnowledgeProcessingResult[]> {
  if (processingInProgress) {
    return [
      {
        status: 'failed' as const,
        documentId: '',
        errorCode: 'KNOWLEDGE_PROCESSING_FAILED',
        message: 'Processing already in progress.',
      },
    ];
  }

  processingInProgress = true;

  try {
    const documents = await listDocuments();
    const results: KnowledgeProcessingResult[] = [];

    for (const doc of documents) {
      const chunks = await getChunksForDocument(doc.id);
      const hasChunks = chunks.length > 0;

      if (documentNeedsProcessing(doc.processingVersion, hasChunks, doc.content)) {
        const result = await processKnowledgeDocument(doc.id);
        results.push(result);
      } else {
        results.push({
          status: 'skipped',
          documentId: doc.id,
          reason: 'already-current',
        });
      }
    }

    return results;
  } finally {
    processingInProgress = false;
  }
}

/**
 * Get processing status for all documents.
 *
 * Scans in-memory (no persistence required). Returns a snapshot.
 */
export async function getKnowledgeProcessingStatus(): Promise<KnowledgeProcessingStatus> {
  const documents = await listDocuments();

  let totalDocuments = 0;
  let currentDocuments = 0;
  let pendingDocuments = 0;
  let failedDocuments = 0;
  let totalChunks = 0;

  for (const doc of documents) {
    totalDocuments++;
    const chunks = await getChunksForDocument(doc.id);
    const hasChunks = chunks.length > 0;
    totalChunks += chunks.length;

    if (doc.processingVersion >= KNOWLEDGE_PROCESSING_VERSION && hasChunks) {
      currentDocuments++;
    } else if (doc.processingVersion < KNOWLEDGE_PROCESSING_VERSION || !hasChunks) {
      pendingDocuments++;
    }
  }

  return {
    totalDocuments,
    currentDocuments,
    pendingDocuments,
    failedDocuments,
    totalChunks,
  };
}

/**
 * Check if processing is currently running.
 */
export function isProcessingInProgress(): boolean {
  return processingInProgress;
}
