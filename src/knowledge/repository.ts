import type { KnowledgeDocumentRecord, KnowledgeChunkRecord, KnowledgeStorageUsage } from './types';
import { KnowledgeError } from './errors';
import { mapTransactionError } from './errors';
import { openKnowledgeDatabase } from './database';
import { validateDocumentRecord, validateChunkRecord } from './validation';

/**
 * Create a document together with its chunks in a single atomic transaction.
 * If any chunk write fails, the entire operation is rolled back.
 */
export async function createDocumentWithChunks(
  document: KnowledgeDocumentRecord,
  chunks: KnowledgeChunkRecord[],
): Promise<void> {
  // Validate before touching storage
  validateDocumentRecord(document, 'createDocumentWithChunks');
  for (const chunk of chunks) {
    validateChunkRecord(chunk, 'createDocumentWithChunks');
    if (chunk.documentId !== document.id) {
      throw new KnowledgeError(
        'KNOWLEDGE_VALIDATION_FAILED',
        `Chunk ${chunk.id} documentId does not match document id ${document.id}`,
      );
    }
  }

  const db = await openKnowledgeDatabase();

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['documents', 'chunks'], 'readwrite');
    const docStore = tx.objectStore('documents');
    const chunkStore = tx.objectStore('chunks');

    const docReq = docStore.add(document);
    docReq.onerror = () => {
      reject(
        new KnowledgeError(
          docReq.error?.name === 'ConstraintError'
            ? 'KNOWLEDGE_DUPLICATE_DOCUMENT'
            : 'KNOWLEDGE_STORAGE_FAILURE',
          'Failed to store document.',
          docReq.error?.message,
        ),
      );
    };

    for (const chunk of chunks) {
      const chunkReq = chunkStore.add(chunk);
      chunkReq.onerror = () => {
        tx.abort();
        const isCompoundViolation =
          chunkReq.error?.name === 'ConstraintError' &&
          chunkReq.error?.message?.includes('documentId_index');
        reject(
          new KnowledgeError(
            isCompoundViolation
              ? 'KNOWLEDGE_DUPLICATE_CHUNK_POSITION'
              : chunkReq.error?.name === 'ConstraintError'
                ? 'KNOWLEDGE_DUPLICATE_CHUNK'
                : 'KNOWLEDGE_STORAGE_FAILURE',
            `Failed to store chunk ${chunk.id}.`,
            chunkReq.error?.message,
          ),
        );
      };
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(mapTransactionError(tx.error));
    tx.onabort = () => {
      reject(
        new KnowledgeError(
          'KNOWLEDGE_TRANSACTION_ABORTED',
          'Document creation was aborted.',
          tx.error?.message,
        ),
      );
    };
  });
}

/**
 * Atomically replace all chunks for a document and update its processing version.
 *
 * Within a single readwrite transaction:
 * 1. Load and validate the document.
 * 2. Delete all existing chunks for the document.
 * 3. Insert all new chunks.
 * 4. Update the document's processingVersion.
 *
 * If any step fails, the entire transaction rolls back:
 * - Old document record remains unchanged
 * - Old chunks remain intact
 * - No partial new chunk set remains
 */
export async function replaceDocumentChunks(
  documentId: string,
  newChunks: KnowledgeChunkRecord[],
  newProcessingVersion: number,
): Promise<void> {
  // Validate new chunks before touching storage
  for (const chunk of newChunks) {
    validateChunkRecord(chunk, 'replaceDocumentChunks');
    if (chunk.documentId !== documentId) {
      throw new KnowledgeError(
        'KNOWLEDGE_VALIDATION_FAILED',
        `Chunk ${chunk.id} documentId does not match target document id ${documentId}`,
      );
    }
  }

  const db = await openKnowledgeDatabase();

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['documents', 'chunks'], 'readwrite');
    const docStore = tx.objectStore('documents');
    const chunkStore = tx.objectStore('chunks');
    const chunkIndex = chunkStore.index('documentId');

    // Step 1: Load the document
    const getReq = docStore.get(documentId);
    getReq.onerror = () => {
      reject(
        new KnowledgeError(
          'KNOWLEDGE_STORAGE_FAILURE',
          'Failed to read document for replacement.',
          getReq.error?.message,
        ),
      );
    };

    getReq.onsuccess = () => {
      const doc = getReq.result as KnowledgeDocumentRecord | undefined;
      if (!doc) {
        reject(
          new KnowledgeError(
            'KNOWLEDGE_DOCUMENT_NOT_FOUND',
            `Document ${documentId} not found for replacement.`,
          ),
        );
        return;
      }

      // Step 2: Delete existing chunks via cursor
      const deleteCursorReq = chunkIndex.openCursor(documentId);
      deleteCursorReq.onsuccess = () => {
        const cursor = deleteCursorReq.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      deleteCursorReq.onerror = () => {
        reject(
          new KnowledgeError(
            'KNOWLEDGE_STORAGE_FAILURE',
            'Failed to delete existing chunks.',
            deleteCursorReq.error?.message,
          ),
        );
      };

      // Step 3: Insert all new chunks
      for (const chunk of newChunks) {
        const addReq = chunkStore.add(chunk);
        addReq.onerror = () => {
          tx.abort();
          reject(
            new KnowledgeError(
              addReq.error?.name === 'ConstraintError'
                ? 'KNOWLEDGE_DUPLICATE_CHUNK_POSITION'
                : 'KNOWLEDGE_STORAGE_FAILURE',
              `Failed to insert chunk ${chunk.id}.`,
              addReq.error?.message,
            ),
          );
        };
      }

      // Step 4: Update document processingVersion
      doc.processingVersion = newProcessingVersion;
      doc.updatedAt = Date.now();
      const updateReq = docStore.put(doc);
      updateReq.onerror = () => {
        reject(
          new KnowledgeError(
            'KNOWLEDGE_STORAGE_FAILURE',
            'Failed to update document processing version.',
            updateReq.error?.message,
          ),
        );
      };
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(mapTransactionError(tx.error));
    tx.onabort = () => {
      reject(
        new KnowledgeError(
          'KNOWLEDGE_TRANSACTION_ABORTED',
          'Document chunk replacement was aborted.',
          tx.error?.message,
        ),
      );
    };
  });
}

/**
 * Retrieve a single document by its id.
 * Throws KNOWLEDGE_CORRUPTED_RECORD if the stored record fails validation.
 */
export async function getDocument(id: string): Promise<KnowledgeDocumentRecord | undefined> {
  const db = await openKnowledgeDatabase();

  return new Promise<KnowledgeDocumentRecord | undefined>((resolve, reject) => {
    const tx = db.transaction('documents', 'readonly');
    const store = tx.objectStore('documents');
    const req = store.get(id);

    req.onsuccess = () => {
      const record = req.result;
      if (record === undefined) {
        resolve(undefined);
        return;
      }
      try {
        validateDocumentRecord(record, 'getDocument');
        resolve(record);
      } catch {
        reject(
          new KnowledgeError('KNOWLEDGE_CORRUPTED_RECORD', `Document record ${id} is corrupted.`),
        );
      }
    };

    req.onerror = () => {
      reject(
        new KnowledgeError(
          'KNOWLEDGE_STORAGE_FAILURE',
          'Failed to read document.',
          req.error?.message,
        ),
      );
    };
  });
}

/**
 * Find a document by its content hash.
 * Returns undefined when no match is found.
 */
export async function findDocumentByContentHash(
  contentHash: string,
): Promise<KnowledgeDocumentRecord | undefined> {
  const db = await openKnowledgeDatabase();

  return new Promise<KnowledgeDocumentRecord | undefined>((resolve, reject) => {
    const tx = db.transaction('documents', 'readonly');
    const store = tx.objectStore('documents');
    const index = store.index('contentHash');

    const req = index.get(contentHash);

    req.onsuccess = () => {
      const record = req.result;
      if (record === undefined) {
        resolve(undefined);
        return;
      }
      try {
        validateDocumentRecord(record, 'findDocumentByContentHash');
        resolve(record);
      } catch {
        reject(
          new KnowledgeError(
            'KNOWLEDGE_CORRUPTED_RECORD',
            `Document matching contentHash ${contentHash.slice(0, 12)}… is corrupted.`,
          ),
        );
      }
    };

    req.onerror = () => {
      reject(
        new KnowledgeError(
          'KNOWLEDGE_STORAGE_FAILURE',
          'Failed to find document by contentHash.',
          req.error?.message,
        ),
      );
    };
  });
}

/**
 * List all documents ordered by importedAt descending, then id ascending.
 * Corrupted records are silently skipped so a single bad record does not
 * prevent the list from loading.
 */
export async function listDocuments(): Promise<KnowledgeDocumentRecord[]> {
  const db = await openKnowledgeDatabase();

  return new Promise<KnowledgeDocumentRecord[]>((resolve, reject) => {
    const tx = db.transaction('documents', 'readonly');
    const store = tx.objectStore('documents');
    const index = store.index('importedAt');
    const req = index.openCursor(null, 'prev');

    const documents: KnowledgeDocumentRecord[] = [];

    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        try {
          validateDocumentRecord(cursor.value, 'listDocuments');
          documents.push(cursor.value);
        } catch {
          // Skip corrupted records in list operations
        }
        cursor.continue();
      } else {
        // Secondary sort: id ascending for documents with the same importedAt
        documents.sort((a, b) => {
          if (b.importedAt !== a.importedAt) return b.importedAt - a.importedAt;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        resolve(documents);
      }
    };

    req.onerror = () => {
      reject(
        new KnowledgeError(
          'KNOWLEDGE_STORAGE_FAILURE',
          'Failed to list documents.',
          req.error?.message,
        ),
      );
    };
  });
}

/**
 * Update the enabled state of a document.
 */
export async function updateDocumentEnabled(id: string, enabled: boolean): Promise<void> {
  const db = await openKnowledgeDatabase();

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('documents', 'readwrite');
    const store = tx.objectStore('documents');
    const req = store.get(id);

    req.onsuccess = () => {
      const doc = req.result as KnowledgeDocumentRecord | undefined;
      if (!doc) {
        reject(new KnowledgeError('KNOWLEDGE_DOCUMENT_NOT_FOUND', `Document ${id} not found.`));
        return;
      }
      doc.enabled = enabled;
      const updateReq = store.put(doc);
      updateReq.onerror = () => {
        reject(
          new KnowledgeError(
            'KNOWLEDGE_STORAGE_FAILURE',
            'Failed to update document enabled state.',
            updateReq.error?.message,
          ),
        );
      };
    };

    req.onerror = () => {
      reject(
        new KnowledgeError(
          'KNOWLEDGE_STORAGE_FAILURE',
          'Failed to read document for update.',
          req.error?.message,
        ),
      );
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(mapTransactionError(tx.error));
  });
}

/**
 * Delete a document and all chunks belonging to it in a single atomic transaction.
 * If the document does not exist, the operation completes without error
 * (idempotent delete).
 */
export async function deleteDocumentCascade(id: string): Promise<void> {
  const db = await openKnowledgeDatabase();

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['documents', 'chunks'], 'readwrite');
    const docStore = tx.objectStore('documents');
    const chunkStore = tx.objectStore('chunks');
    const chunkIndex = chunkStore.index('documentId');

    const docReq = docStore.delete(id);
    docReq.onerror = () => {
      reject(
        new KnowledgeError(
          'KNOWLEDGE_STORAGE_FAILURE',
          'Failed to delete document.',
          docReq.error?.message,
        ),
      );
    };

    // Delete all chunks for this document via cursor
    const chunkCursorReq = chunkIndex.openCursor(id);
    chunkCursorReq.onsuccess = () => {
      const cursor = chunkCursorReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    chunkCursorReq.onerror = () => {
      reject(
        new KnowledgeError(
          'KNOWLEDGE_STORAGE_FAILURE',
          'Failed to iterate chunks for deletion.',
          chunkCursorReq.error?.message,
        ),
      );
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(mapTransactionError(tx.error));
    tx.onabort = () => {
      reject(
        new KnowledgeError(
          'KNOWLEDGE_TRANSACTION_ABORTED',
          'Document deletion was aborted.',
          tx.error?.message,
        ),
      );
    };
  });
}

/**
 * Delete all documents and their chunks in a single atomic transaction.
 * Also clears the meta store. Settings are preserved.
 * Returns the number of documents deleted.
 */
export async function deleteAllDocumentsCascade(): Promise<number> {
  const db = await openKnowledgeDatabase();

  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(['documents', 'chunks', 'meta'], 'readwrite');
    const docStore = tx.objectStore('documents');
    const chunkStore = tx.objectStore('chunks');
    const metaStore = tx.objectStore('meta');

    let docCount = 0;
    const countReq = docStore.count();
    countReq.onsuccess = () => {
      docCount = countReq.result;
    };

    docStore.clear();

    chunkStore.clear();

    metaStore.clear();

    tx.oncomplete = () => resolve(docCount);
    tx.onerror = () => reject(mapTransactionError(tx.error));
    tx.onabort = () => {
      reject(
        new KnowledgeError(
          'KNOWLEDGE_TRANSACTION_ABORTED',
          'Bulk deletion was aborted.',
          tx.error?.message,
        ),
      );
    };
  });
}

/**
 * Get all chunks for a document, ordered by index ascending then id ascending.
 * Corrupted chunk records are silently skipped.
 */
export async function getChunksForDocument(documentId: string): Promise<KnowledgeChunkRecord[]> {
  const db = await openKnowledgeDatabase();

  return new Promise<KnowledgeChunkRecord[]>((resolve, reject) => {
    const tx = db.transaction('chunks', 'readonly');
    const store = tx.objectStore('chunks');
    const index = store.index('documentId');
    const req = index.openCursor(documentId);

    const chunks: KnowledgeChunkRecord[] = [];

    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        try {
          validateChunkRecord(cursor.value, 'getChunksForDocument');
          chunks.push(cursor.value);
        } catch {
          // Skip corrupted chunks
        }
        cursor.continue();
      } else {
        // Sort by index ascending, then id ascending for ties
        chunks.sort((a, b) => {
          if (a.index !== b.index) return a.index - b.index;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        resolve(chunks);
      }
    };

    req.onerror = () => {
      reject(
        new KnowledgeError(
          'KNOWLEDGE_STORAGE_FAILURE',
          'Failed to read chunks.',
          req.error?.message,
        ),
      );
    };
  });
}

/**
 * Get chunks for multiple documents in a single IndexedDB transaction.
 * More efficient than calling getChunksForDocument per document.
 */
export async function getChunksForDocuments(
  documentIds: string[],
): Promise<KnowledgeChunkRecord[]> {
  if (documentIds.length === 0) return [];
  const idSet = new Set(documentIds);
  const db = await openKnowledgeDatabase();

  return new Promise<KnowledgeChunkRecord[]>((resolve, reject) => {
    const tx = db.transaction('chunks', 'readonly');
    const store = tx.objectStore('chunks');
    const req = store.openCursor();

    const chunks: KnowledgeChunkRecord[] = [];

    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        if (idSet.has(cursor.value.documentId)) {
          try {
            validateChunkRecord(cursor.value, 'getChunksForDocuments');
            chunks.push(cursor.value);
          } catch {
            // Skip corrupted chunks
          }
        }
        cursor.continue();
      } else {
        resolve(chunks);
      }
    };

    req.onerror = () => {
      reject(
        new KnowledgeError(
          'KNOWLEDGE_STORAGE_FAILURE',
          'Failed to read chunks for documents.',
          req.error?.message,
        ),
      );
    };
  });
}

/**
 * Get all documents that have enabled === true.
 * Uses listDocuments() for consistency and sorts by importedAt descending.
 */
export async function getAllEnabledDocuments(): Promise<KnowledgeDocumentRecord[]> {
  const all = await listDocuments();
  return all.filter((d) => d.enabled);
}

/**
 * Get estimated storage usage for the knowledge base.
 * Uses IndexedDB count operations.
 */
export async function getKnowledgeStorageUsage(): Promise<KnowledgeStorageUsage> {
  const db = await openKnowledgeDatabase();

  return new Promise<KnowledgeStorageUsage>((resolve, reject) => {
    const tx = db.transaction(['documents', 'chunks'], 'readonly');
    const docStore = tx.objectStore('documents');
    const chunkStore = tx.objectStore('chunks');

    const docCountReq = docStore.count();
    const chunkCountReq = chunkStore.count();

    let documentCount = 0;
    let chunkCount = 0;

    docCountReq.onsuccess = () => {
      documentCount = docCountReq.result;
    };

    chunkCountReq.onsuccess = () => {
      chunkCount = chunkCountReq.result;
    };

    tx.oncomplete = () => {
      // Conservative estimate based on typical record sizes
      const estimatedBytes = documentCount * 5_120 + chunkCount * 1_024;
      resolve({ documentCount, chunkCount, estimatedBytes });
    };

    tx.onerror = () => {
      reject(
        new KnowledgeError(
          'KNOWLEDGE_STORAGE_FAILURE',
          'Failed to compute storage usage.',
          tx.error?.message,
        ),
      );
    };
  });
}

/**
 * Clear all data from the knowledge database by clearing each object store.
 * Does not delete the database itself or its schema.
 */
export async function clearKnowledgeDatabase(): Promise<void> {
  const db = await openKnowledgeDatabase();

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['documents', 'chunks', 'meta'], 'readwrite');
    tx.objectStore('documents').clear();
    tx.objectStore('chunks').clear();
    tx.objectStore('meta').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      reject(
        new KnowledgeError(
          'KNOWLEDGE_STORAGE_FAILURE',
          'Failed to clear knowledge database.',
          tx.error?.message,
        ),
      );
    };
  });
}
