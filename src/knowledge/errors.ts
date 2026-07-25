import type { KnowledgeErrorCode } from './types';

export class KnowledgeError extends Error {
  constructor(
    public code: KnowledgeErrorCode,
    message: string,
    public detail: string = message,
  ) {
    super(message);
    this.name = 'KnowledgeError';
  }
}

export function knowledgeErrorMessage(e: unknown): string {
  if (e instanceof KnowledgeError) return e.message;
  if (e instanceof DOMException) return mapDomExceptionMessage(e);
  if (e instanceof Error) return e.message;
  return 'An unexpected knowledge base error occurred.';
}

function mapDomExceptionMessage(e: DOMException): string {
  switch (e.name) {
    case 'QuotaExceededError':
    case 'QuotaExceededErr':
      return 'Knowledge base storage is full.';
    case 'ConstraintError':
      return 'A record with the same identifier already exists.';
    case 'AbortError':
      return 'The database operation was aborted.';
    case 'InvalidStateError':
      return 'The database is not available.';
    case 'VersionError':
    case 'VersionChangeError':
      return 'Database schema version conflict.';
    default:
      return e.message || 'A storage error occurred.';
  }
}

export function mapTransactionError(error: DOMException | null): KnowledgeError {
  if (!error) {
    return new KnowledgeError('KNOWLEDGE_STORAGE_FAILURE', 'A storage operation failed.');
  }

  switch (error.name) {
    case 'QuotaExceededError':
    case 'QuotaExceededErr':
      return new KnowledgeError(
        'KNOWLEDGE_QUOTA_EXCEEDED',
        'Knowledge base storage quota exceeded.',
      );
    case 'ConstraintError':
      return new KnowledgeError(
        'KNOWLEDGE_DUPLICATE_DOCUMENT',
        'A record with the same identifier already exists.',
      );
    default:
      return new KnowledgeError(
        'KNOWLEDGE_STORAGE_FAILURE',
        'A storage operation failed.',
        error.message,
      );
  }
}
