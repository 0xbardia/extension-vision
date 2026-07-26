/** Runtime error codes for knowledge base operations */
export type KnowledgeErrorCode =
  | 'KNOWLEDGE_DB_OPEN_FAILED'
  | 'KNOWLEDGE_DB_BLOCKED'
  | 'KNOWLEDGE_DB_VERSION_MISMATCH'
  | 'KNOWLEDGE_TRANSACTION_ABORTED'
  | 'KNOWLEDGE_QUOTA_EXCEEDED'
  | 'KNOWLEDGE_DUPLICATE_DOCUMENT'
  | 'KNOWLEDGE_DUPLICATE_CHUNK'
  | 'KNOWLEDGE_DUPLICATE_CHUNK_POSITION'
  | 'KNOWLEDGE_DOCUMENT_NOT_FOUND'
  | 'KNOWLEDGE_CORRUPTED_RECORD'
  | 'KNOWLEDGE_STORAGE_FAILURE'
  | 'KNOWLEDGE_SETTINGS_CORRUPTED'
  | 'KNOWLEDGE_VALIDATION_FAILED'
  /* Import-specific error codes */
  | 'KNOWLEDGE_UNSUPPORTED_EXTENSION'
  | 'KNOWLEDGE_UNSUPPORTED_MIME'
  | 'KNOWLEDGE_FILE_TOO_LARGE'
  | 'KNOWLEDGE_INVALID_UTF8'
  | 'KNOWLEDGE_EMPTY_DOCUMENT'
  | 'KNOWLEDGE_SUSPICIOUS_CONTROLS'
  | 'KNOWLEDGE_FILENAME_TOO_LONG'
  | 'KNOWLEDGE_DOCUMENT_COUNT_LIMIT'
  | 'KNOWLEDGE_STORAGE_SIZE_LIMIT'
  | 'KNOWLEDGE_BIDI_OVERRIDE'
  | 'KNOWLEDGE_IMPORT_ERROR'
  /* Processing-specific error codes */
  | 'KNOWLEDGE_CHUNKING_OVERFLOW'
  | 'KNOWLEDGE_PROCESSING_FAILED'
  | 'KNOWLEDGE_RETRIEVAL_UNAVAILABLE';

/** A document imported into the local knowledge base */
export interface KnowledgeDocumentRecord {
  id: string;
  fileName: string;
  mimeType: 'text/plain';
  byteSize: number;
  characterCount: number;
  importedAt: number;
  updatedAt: number;
  enabled: boolean;
  contentHash: string;
  processingVersion: number;
  content: string;
}

/** A text chunk extracted from a knowledge document */
export interface KnowledgeChunkRecord {
  id: string;
  documentId: string;
  index: number;
  text: string;
  startOffset: number;
  endOffset: number;
  processingVersion: number;
}

/** A metadata entry stored in the meta object store */
export interface KnowledgeMetaRecord {
  key: string;
  value: unknown;
}

/** Knowledge base settings stored in chrome.storage.local */
export interface KnowledgeSettings {
  schemaVersion: number;
  enabled: boolean;
  maximumFileSizeBytes: number;
  maximumDocumentCount: number;
  maximumTotalStoredBytes: number;
  maximumRetrievedChunks: number;
  maximumContextCharacters: number;
}

/** Default knowledge settings */
export const DEFAULT_KNOWLEDGE_SETTINGS: KnowledgeSettings = {
  schemaVersion: 1,
  enabled: false,
  maximumFileSizeBytes: 1_048_576,
  maximumDocumentCount: 50,
  maximumTotalStoredBytes: 5_242_880,
  maximumRetrievedChunks: 5,
  maximumContextCharacters: 8_000,
};

/** Storage usage estimate */
export interface KnowledgeStorageUsage {
  documentCount: number;
  chunkCount: number;
  estimatedBytes: number;
}

/** Result of importing a single file */
export type KnowledgeImportResult =
  | { status: 'imported'; fileName: string; documentId: string }
  | { status: 'duplicate'; fileName: string; existingFileName?: string }
  | { status: 'rejected'; fileName: string; reason: string }
  | { status: 'failed'; fileName: string; reason: string };

/** Database name */
export const KNOWLEDGE_DB_NAME = 'extension-vision-knowledge';

/** Current database schema version */
export const KNOWLEDGE_DB_VERSION = 1;

/**
 * Current processing version for documents and chunks.
 * Version 1 = initial import (Phase 1.2, zero chunks)
 * Version 2 = chunked and processed (Phase 2+)
 */
export const KNOWLEDGE_PROCESSING_VERSION = 2;

// ─── Chunking Constants ────────────────────────────────────────────

/** Target characters per chunk */
export const CHUNK_TARGET_CHARS = 1200;

/** Maximum characters per chunk */
export const CHUNK_MAX_CHARS = 1600;

/** Minimum useful characters in a chunk */
export const CHUNK_MIN_CHARS = 200;

/** Overlap characters between adjacent chunks */
export const CHUNK_OVERLAP_CHARS = 200;

/** Safety maximum chunks per document */
export const CHUNK_MAX_PER_DOCUMENT = 500;

// ─── Processing Types ──────────────────────────────────────────────

export type KnowledgeProcessingResult =
  | { status: 'processed'; documentId: string; chunkCount: number }
  | { status: 'skipped'; documentId: string; reason: 'already-current' }
  | { status: 'failed'; documentId: string; errorCode: string; message?: string };

export interface KnowledgeProcessingStatus {
  totalDocuments: number;
  currentDocuments: number;
  pendingDocuments: number;
  failedDocuments: number;
  totalChunks: number;
}

// ─── Retrieval Types ───────────────────────────────────────────────

export interface KnowledgeRetrievalOptions {
  maximumChunks?: number;
  maximumCharacters?: number;
}

export interface KnowledgeRetrievalMatch {
  chunkId: string;
  documentId: string;
  fileName: string;
  chunkIndex: number;
  text: string;
  score: number;
  startOffset: number;
  endOffset: number;
}

export interface KnowledgeRetrievalResult {
  query: string;
  normalizedQuery: string;
  matches: KnowledgeRetrievalMatch[];
  totalEligibleDocuments: number;
  totalEligibleChunks: number;
  totalMatchedChunks: number;
  returnedCharacters: number;
  reason?:
    | 'knowledge-disabled'
    | 'query-not-meaningful'
    | 'no-enabled-documents'
    | 'no-processed-chunks'
    | 'no-match';
}
