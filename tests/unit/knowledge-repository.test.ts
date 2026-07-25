import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  createDocumentWithChunks,
  getDocument,
  findDocumentByContentHash,
  listDocuments,
  updateDocumentEnabled,
  deleteDocumentCascade,
  getChunksForDocument,
  getAllEnabledDocuments,
  getKnowledgeStorageUsage,
  clearKnowledgeDatabase,
} from '../../src/knowledge/repository';
import { closeKnowledgeDatabase, openKnowledgeDatabase } from '../../src/knowledge/database';
import { KnowledgeError } from '../../src/knowledge/errors';
import type { KnowledgeDocumentRecord, KnowledgeChunkRecord } from '../../src/knowledge/types';

function makeDoc(overrides: Partial<KnowledgeDocumentRecord> = {}): KnowledgeDocumentRecord {
  return {
    id: 'doc-1',
    fileName: 'test.txt',
    mimeType: 'text/plain',
    byteSize: 100,
    characterCount: 95,
    importedAt: 1000,
    updatedAt: 1000,
    enabled: true,
    contentHash: 'abc123',
    processingVersion: 1,
    content: 'Hello, world!',
    ...overrides,
  };
}

function makeChunk(
  documentId: string,
  index: number,
  overrides: Partial<KnowledgeChunkRecord> = {},
): KnowledgeChunkRecord {
  return {
    id: `${documentId}_chunk_${index}`,
    documentId,
    index,
    text: `Chunk ${index} content.`,
    startOffset: index * 10,
    endOffset: (index + 1) * 10,
    processingVersion: 1,
    ...overrides,
  };
}

async function cleanDb(): Promise<void> {
  closeKnowledgeDatabase();
  const db = await openKnowledgeDatabase();
  const tx = db.transaction(['documents', 'chunks', 'meta'], 'readwrite');
  tx.objectStore('documents').clear();
  tx.objectStore('chunks').clear();
  tx.objectStore('meta').clear();
  await new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve();
  });
}

describe('knowledge repository', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  afterEach(() => {
    closeKnowledgeDatabase();
  });

  describe('createDocumentWithChunks', () => {
    it('creates a document with zero chunks', async () => {
      const doc = makeDoc();
      await createDocumentWithChunks(doc, []);
      const retrieved = await getDocument(doc.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(doc.id);
    });

    it('creates a document with multiple chunks', async () => {
      const doc = makeDoc();
      const chunks = [makeChunk(doc.id, 0), makeChunk(doc.id, 1), makeChunk(doc.id, 2)];
      await createDocumentWithChunks(doc, chunks);

      const retrieved = await getDocument(doc.id);
      expect(retrieved).toBeDefined();

      const storedChunks = await getChunksForDocument(doc.id);
      expect(storedChunks).toHaveLength(3);
    });

    it('rejects duplicate contentHash', async () => {
      const doc = makeDoc();
      await createDocumentWithChunks(doc, []);

      // Same contentHash but different id should fail
      await expect(
        createDocumentWithChunks(makeDoc({ id: 'doc-2', contentHash: 'abc123' }), []),
      ).rejects.toThrow(KnowledgeError);
    });

    it('rejects duplicate chunk id', async () => {
      const doc = makeDoc();
      const chunk = makeChunk(doc.id, 0);
      await createDocumentWithChunks(doc, [chunk]);

      // Another document with a chunk that has the same id
      const doc2 = makeDoc({ id: 'doc-2', contentHash: 'def456' });
      await expect(createDocumentWithChunks(doc2, [chunk])).rejects.toThrow(KnowledgeError);
    });

    it('rejects chunk with mismatched documentId', async () => {
      const doc = makeDoc();
      const chunk = makeChunk('other-doc', 0);
      await expect(createDocumentWithChunks(doc, [chunk])).rejects.toThrow(KnowledgeError);
    });

    it('rolls back document if a chunk write fails', async () => {
      const doc = makeDoc();
      const chunk = makeChunk(doc.id, 0);
      // Same chunk id again → add will fail with ConstraintError
      const duplicate = { ...chunk };

      await expect(createDocumentWithChunks(doc, [chunk, duplicate])).rejects.toThrow(
        KnowledgeError,
      );

      // Document should not exist (transaction rolled back)
      const retrieved = await getDocument(doc.id);
      expect(retrieved).toBeUndefined();
    });

    it('rejects duplicate chunk positions in same batch', async () => {
      const doc = makeDoc({ id: 'doc-pos', contentHash: 'pos-h1' });
      // Two chunks with different IDs but same documentId + index
      const chunk1 = makeChunk(doc.id, 0);
      const chunk2 = makeChunk(doc.id, 0, { id: `${doc.id}_chunk_0_alt` });

      await expect(createDocumentWithChunks(doc, [chunk1, chunk2])).rejects.toThrow(KnowledgeError);

      // Transaction should have rolled back completely
      const retrieved = await getDocument(doc.id);
      expect(retrieved).toBeUndefined();
    });

    it('rejects duplicate chunk positions across calls', async () => {
      const doc = makeDoc({ id: 'doc-cross', contentHash: 'cross-h1' });
      const chunk = makeChunk(doc.id, 0);
      await createDocumentWithChunks(doc, [chunk]);

      // Same documentId+index but different chunk ID
      const doc2 = makeDoc({ id: 'doc-cross-2', contentHash: 'cross-h2' });
      const samePosition = makeChunk(doc.id, 0, {
        id: 'different-id',
        documentId: doc.id,
      });

      await expect(createDocumentWithChunks(doc2, [samePosition])).rejects.toThrow(KnowledgeError);
    });

    it('allows same index for different documents', async () => {
      const doc1 = makeDoc({ id: 'doc-diff-1', contentHash: 'dh1' });
      const doc2 = makeDoc({ id: 'doc-diff-2', contentHash: 'dh2' });

      await createDocumentWithChunks(doc1, [makeChunk(doc1.id, 0)]);
      await createDocumentWithChunks(doc2, [makeChunk(doc2.id, 0)]);

      const chunks1 = await getChunksForDocument(doc1.id);
      const chunks2 = await getChunksForDocument(doc2.id);
      expect(chunks1).toHaveLength(1);
      expect(chunks2).toHaveLength(1);
    });

    it('allows different indexes for same document', async () => {
      const doc = makeDoc({ contentHash: 'diff-idx' });
      await createDocumentWithChunks(doc, [
        makeChunk(doc.id, 0),
        makeChunk(doc.id, 1),
        makeChunk(doc.id, 2),
      ]);

      const chunks = await getChunksForDocument(doc.id);
      expect(chunks).toHaveLength(3);
    });

    it('rejects invalid document records', async () => {
      await expect(createDocumentWithChunks(makeDoc({ id: '' }), [])).rejects.toThrow(
        KnowledgeError,
      );
    });

    it('rejects invalid chunk records', async () => {
      const doc = makeDoc();
      const invalidChunk = makeChunk(doc.id, 0, { endOffset: -1 });
      await expect(createDocumentWithChunks(doc, [invalidChunk])).rejects.toThrow(KnowledgeError);
    });
  });

  describe('getDocument', () => {
    it('returns a document by id', async () => {
      const doc = makeDoc();
      await createDocumentWithChunks(doc, []);
      const retrieved = await getDocument(doc.id);
      expect(retrieved?.fileName).toBe('test.txt');
    });

    it('returns undefined for missing document', async () => {
      const retrieved = await getDocument('nonexistent');
      expect(retrieved).toBeUndefined();
    });

    it('throws on corrupted record', async () => {
      // We need to insert a corrupted record directly via IndexedDB
      const db = await openKnowledgeDatabase();
      const tx = db.transaction('documents', 'readwrite');
      const store = tx.objectStore('documents');
      store.put({ id: 'corrupt-doc', fileName: 123 }); // invalid fileName type
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });

      // The repository should detect the corruption
      await expect(getDocument('corrupt-doc')).rejects.toThrow(KnowledgeError);
    });
  });

  describe('findDocumentByContentHash', () => {
    it('finds a document by content hash', async () => {
      const doc = makeDoc({ contentHash: 'unique-hash' });
      await createDocumentWithChunks(doc, []);
      const retrieved = await findDocumentByContentHash('unique-hash');
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(doc.id);
    });

    it('returns undefined when hash does not match', async () => {
      const result = await findDocumentByContentHash('nonexistent-hash');
      expect(result).toBeUndefined();
    });
  });

  describe('listDocuments', () => {
    it('returns documents ordered by importedAt descending', async () => {
      const doc1 = makeDoc({ id: 'a', fileName: 'a.txt', importedAt: 100, contentHash: 'h1' });
      const doc2 = makeDoc({ id: 'b', fileName: 'b.txt', importedAt: 200, contentHash: 'h2' });
      const doc3 = makeDoc({ id: 'c', fileName: 'c.txt', importedAt: 150, contentHash: 'h3' });

      await createDocumentWithChunks(doc1, []);
      await createDocumentWithChunks(doc2, []);
      await createDocumentWithChunks(doc3, []);

      const docs = await listDocuments();
      expect(docs.map((d) => d.id)).toEqual(['b', 'c', 'a']);
    });

    it('uses id as secondary sort for same importedAt', async () => {
      const docA = makeDoc({ id: 'a-doc', fileName: 'a.txt', importedAt: 100, contentHash: 'h1' });
      const docB = makeDoc({ id: 'b-doc', fileName: 'b.txt', importedAt: 100, contentHash: 'h2' });

      await createDocumentWithChunks(docA, []);
      await createDocumentWithChunks(docB, []);

      const docs = await listDocuments();
      expect(docs.map((d) => d.id)).toEqual(['a-doc', 'b-doc']);
    });

    it('returns empty array when no documents exist', async () => {
      const docs = await listDocuments();
      expect(docs).toEqual([]);
    });

    it('skips corrupted records silently', async () => {
      const doc = makeDoc();
      await createDocumentWithChunks(doc, []);

      // Insert a corrupted record directly
      const db = await openRawDb();
      const tx = db.transaction('documents', 'readwrite');
      const store = tx.objectStore('documents');
      store.put({ id: 'corrupt', fileName: 999 }); // invalid type
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });

      const docs = await listDocuments();
      expect(docs).toHaveLength(1);
      expect(docs[0].id).toBe('doc-1');
    });
  });

  describe('updateDocumentEnabled', () => {
    it('updates the enabled flag', async () => {
      const doc = makeDoc({ enabled: true });
      await createDocumentWithChunks(doc, []);

      await updateDocumentEnabled(doc.id, false);
      const retrieved = await getDocument(doc.id);
      expect(retrieved?.enabled).toBe(false);

      await updateDocumentEnabled(doc.id, true);
      const retrieved2 = await getDocument(doc.id);
      expect(retrieved2?.enabled).toBe(true);
    });

    it('throws when document does not exist', async () => {
      await expect(updateDocumentEnabled('nonexistent', false)).rejects.toThrow(KnowledgeError);
    });
  });

  describe('deleteDocumentCascade', () => {
    it('deletes document and its chunks', async () => {
      const doc = makeDoc();
      const chunks = [makeChunk(doc.id, 0), makeChunk(doc.id, 1)];
      await createDocumentWithChunks(doc, chunks);

      await deleteDocumentCascade(doc.id);

      const retrieved = await getDocument(doc.id);
      expect(retrieved).toBeUndefined();

      const storedChunks = await getChunksForDocument(doc.id);
      expect(storedChunks).toHaveLength(0);
    });

    it('leaves other documents untouched', async () => {
      const doc1 = makeDoc({ id: 'doc-1', contentHash: 'h1' });
      const doc2 = makeDoc({ id: 'doc-2', contentHash: 'h2' });
      const chunks2 = [makeChunk(doc2.id, 0)];

      await createDocumentWithChunks(doc1, []);
      await createDocumentWithChunks(doc2, chunks2);

      await deleteDocumentCascade(doc1.id);

      const retrieved2 = await getDocument(doc2.id);
      expect(retrieved2).toBeDefined();

      const storedChunks = await getChunksForDocument(doc2.id);
      expect(storedChunks).toHaveLength(1);
    });

    it('completes without error for non-existent document', async () => {
      // Should not throw — idempotent delete
      await expect(deleteDocumentCascade('nonexistent')).resolves.toBeUndefined();
    });

    it('does not leave orphan chunks after deletion', async () => {
      const doc = makeDoc();
      const chunks = [makeChunk(doc.id, 0), makeChunk(doc.id, 1)];
      await createDocumentWithChunks(doc, chunks);

      await deleteDocumentCascade(doc.id);

      // Re-create a document with the same chunks should not throw (they're gone)
      const doc2 = makeDoc({ id: 'doc-2', contentHash: 'h2' });
      await expect(
        createDocumentWithChunks(doc2, [makeChunk(doc2.id, 0, { id: `${doc2.id}_chunk_0` })]),
      ).resolves.toBeUndefined();
    });
  });

  describe('getChunksForDocument', () => {
    it('returns chunks ordered by index ascending', async () => {
      const doc = makeDoc();
      const chunks = [makeChunk(doc.id, 2), makeChunk(doc.id, 0), makeChunk(doc.id, 1)];
      await createDocumentWithChunks(doc, chunks);

      const stored = await getChunksForDocument(doc.id);
      expect(stored.map((c) => c.index)).toEqual([0, 1, 2]);
    });

    it('returns empty array when no chunks exist', async () => {
      const doc = makeDoc();
      await createDocumentWithChunks(doc, []);
      const chunks = await getChunksForDocument(doc.id);
      expect(chunks).toEqual([]);
    });
  });

  describe('getAllEnabledDocuments', () => {
    it('returns only enabled documents', async () => {
      const doc1 = makeDoc({
        id: 'e1',
        fileName: 'e1.txt',
        enabled: true,
        contentHash: 'h1',
        importedAt: 100,
      });
      const doc2 = makeDoc({
        id: 'e2',
        fileName: 'e2.txt',
        enabled: false,
        contentHash: 'h2',
        importedAt: 200,
      });
      const doc3 = makeDoc({
        id: 'e3',
        fileName: 'e3.txt',
        enabled: true,
        contentHash: 'h3',
        importedAt: 300,
      });

      await createDocumentWithChunks(doc1, []);
      await createDocumentWithChunks(doc2, []);
      await createDocumentWithChunks(doc3, []);

      const enabled = await getAllEnabledDocuments();
      expect(enabled.map((d) => d.id)).toEqual(['e3', 'e1']); // importedAt desc, no e2
    });

    it('returns empty array when no documents are enabled', async () => {
      const doc = makeDoc({ enabled: false });
      await createDocumentWithChunks(doc, []);
      const enabled = await getAllEnabledDocuments();
      expect(enabled).toEqual([]);
    });
  });

  describe('getKnowledgeStorageUsage', () => {
    it('returns zero for empty database', async () => {
      const usage = await getKnowledgeStorageUsage();
      expect(usage.documentCount).toBe(0);
      expect(usage.chunkCount).toBe(0);
      expect(usage.estimatedBytes).toBe(0);
    });

    it('counts documents and chunks correctly', async () => {
      const doc1 = makeDoc({ id: 'd1', contentHash: 'h1' });
      const doc2 = makeDoc({ id: 'd2', contentHash: 'h2' });

      await createDocumentWithChunks(doc1, [makeChunk(doc1.id, 0), makeChunk(doc1.id, 1)]);
      await createDocumentWithChunks(doc2, [makeChunk(doc2.id, 0)]);

      const usage = await getKnowledgeStorageUsage();
      expect(usage.documentCount).toBe(2);
      expect(usage.chunkCount).toBe(3);
      expect(usage.estimatedBytes).toBeGreaterThan(0);
    });
  });

  describe('clearKnowledgeDatabase', () => {
    it('clears all data', async () => {
      const doc = makeDoc();
      await createDocumentWithChunks(doc, [makeChunk(doc.id, 0)]);

      await clearKnowledgeDatabase();

      const retrieved = await getDocument(doc.id);
      expect(retrieved).toBeUndefined();
    });

    it('allows creating documents after clear', async () => {
      const doc = makeDoc();
      await createDocumentWithChunks(doc, [makeChunk(doc.id, 0)]);
      await clearKnowledgeDatabase();

      const doc2 = makeDoc({ id: 'new-doc', contentHash: 'new-hash' });
      await expect(createDocumentWithChunks(doc2, [])).resolves.toBeUndefined();
    });
  });
});

// Helper to bypass the repository layer and access raw IndexedDB
async function openRawDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('extension-vision-knowledge', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('documents')) {
        const docStore = db.createObjectStore('documents', { keyPath: 'id' });
        docStore.createIndex('contentHash', 'contentHash', { unique: true });
        docStore.createIndex('enabled', 'enabled', { unique: false });
        docStore.createIndex('importedAt', 'importedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('chunks')) {
        const chunkStore = db.createObjectStore('chunks', { keyPath: 'id' });
        chunkStore.createIndex('documentId', 'documentId', { unique: false });
        chunkStore.createIndex('documentId_index', ['documentId', 'index'], { unique: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
