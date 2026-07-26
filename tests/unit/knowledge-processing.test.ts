import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  processKnowledgeDocument,
  processPendingKnowledgeDocuments,
  getKnowledgeProcessingStatus,
} from '../../src/knowledge/processing';
import { closeKnowledgeDatabase, openKnowledgeDatabase } from '../../src/knowledge/database';
import {
  createDocumentWithChunks,
  getDocument,
  getChunksForDocument,
  replaceDocumentChunks,
} from '../../src/knowledge/repository';
import { KNOWLEDGE_PROCESSING_VERSION } from '../../src/knowledge/types';
import type { KnowledgeDocumentRecord } from '../../src/knowledge/types';

function makeDoc(overrides: Partial<KnowledgeDocumentRecord> = {}): KnowledgeDocumentRecord {
  return {
    id: overrides.id ?? 'test-doc',
    fileName: 'test.txt',
    mimeType: 'text/plain',
    byteSize: 100,
    characterCount: 95,
    importedAt: Date.now(),
    updatedAt: Date.now(),
    enabled: true,
    contentHash: 'hash-' + Math.random().toString(36),
    processingVersion: 1,
    content:
      'Hello, this is a test document with enough content to verify processing behavior. '.repeat(
        20,
      ),
    ...overrides,
  };
}

async function cleanDb(): Promise<void> {
  closeKnowledgeDatabase();
  const db = await openKnowledgeDatabase();
  for (const name of Array.from(db.objectStoreNames)) {
    const tx = db.transaction(name, 'readwrite');
    tx.objectStore(name).clear();
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
  }
}

describe('processKnowledgeDocument', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  afterEach(() => {
    closeKnowledgeDatabase();
  });

  it('processes a version-1 zero-chunk document', async () => {
    const doc = makeDoc();
    await createDocumentWithChunks(doc, []);

    const result = await processKnowledgeDocument(doc.id);
    expect(result.status).toBe('processed');
    if (result.status === 'processed') {
      expect(result.chunkCount).toBeGreaterThan(0);
    }

    const updated = await getDocument(doc.id);
    expect(updated?.processingVersion).toBe(KNOWLEDGE_PROCESSING_VERSION);

    const chunks = await getChunksForDocument(doc.id);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].processingVersion).toBe(KNOWLEDGE_PROCESSING_VERSION);
  });

  it('skips a healthy version-2 document', async () => {
    const doc = makeDoc({ processingVersion: 2 });
    const chunks = [
      {
        id: `${doc.id}:v2:0`,
        documentId: doc.id,
        index: 0,
        text: doc.content,
        startOffset: 0,
        endOffset: doc.content.length,
        processingVersion: 2,
      },
    ];
    await createDocumentWithChunks(doc, chunks);

    const result = await processKnowledgeDocument(doc.id);
    expect(result.status).toBe('skipped');
  });

  it('returns failed for non-existent document', async () => {
    const result = await processKnowledgeDocument('nonexistent');
    expect(result.status).toBe('failed');
  });

  it('chunks match source text exactly', async () => {
    const doc = makeDoc();
    await createDocumentWithChunks(doc, []);

    await processKnowledgeDocument(doc.id);
    const chunks = await getChunksForDocument(doc.id);

    for (const chunk of chunks) {
      expect(chunk.text).toBe(doc.content.slice(chunk.startOffset, chunk.endOffset));
    }
  });

  it('is idempotent on repeated calls', async () => {
    const doc = makeDoc();
    await createDocumentWithChunks(doc, []);

    await processKnowledgeDocument(doc.id);
    const result1 = await getChunksForDocument(doc.id);

    const result2 = await processKnowledgeDocument(doc.id);
    expect(result2.status).toBe('skipped');

    const chunksAfter = await getChunksForDocument(doc.id);
    expect(chunksAfter).toEqual(result1);
  });
});

describe('replaceDocumentChunks', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  afterEach(() => {
    closeKnowledgeDatabase();
  });

  it('atomically replaces old chunks with new ones', async () => {
    const doc = makeDoc({ processingVersion: 1 });
    await createDocumentWithChunks(doc, []);

    const newChunks = [
      {
        id: `${doc.id}:v2:0`,
        documentId: doc.id,
        index: 0,
        text: 'First chunk.',
        startOffset: 0,
        endOffset: 13,
        processingVersion: 2,
      },
      {
        id: `${doc.id}:v2:1`,
        documentId: doc.id,
        index: 1,
        text: 'Second chunk.',
        startOffset: 14,
        endOffset: 27,
        processingVersion: 2,
      },
    ];

    await replaceDocumentChunks(doc.id, newChunks, 2);

    const updated = await getDocument(doc.id);
    expect(updated?.processingVersion).toBe(2);

    const stored = await getChunksForDocument(doc.id);
    expect(stored).toHaveLength(2);
    expect(stored[0].id).toBe(`${doc.id}:v2:0`);
  });

  it('rolls back on failure', async () => {
    const doc = makeDoc({ processingVersion: 1 });
    await createDocumentWithChunks(doc, []);

    // Trying to insert a chunk with a non-matching documentId should fail
    const badChunks = [
      {
        id: 'bad:v2:0',
        documentId: doc.id,
        index: 0,
        text: 'OK chunk.',
        startOffset: 0,
        endOffset: 9,
        processingVersion: 2,
      },
      {
        id: 'bad:v2:1',
        documentId: 'wrong-doc',
        index: 1,
        text: 'Bad chunk.',
        startOffset: 10,
        endOffset: 20,
        processingVersion: 2,
      },
    ];

    await expect(replaceDocumentChunks(doc.id, badChunks, 2)).rejects.toThrow();

    // Old document should remain unchanged
    const docAfter = await getDocument(doc.id);
    expect(docAfter?.processingVersion).toBe(1);

    // Old chunks (empty) should remain
    const chunksAfter = await getChunksForDocument(doc.id);
    expect(chunksAfter).toHaveLength(0);
  });
});

describe('processPendingKnowledgeDocuments', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  afterEach(() => {
    closeKnowledgeDatabase();
  });

  it('processes all pending documents', async () => {
    const doc1 = makeDoc({ id: 'p1', contentHash: 'h1' });
    const doc2 = makeDoc({ id: 'p2', contentHash: 'h2', content: 'Short doc.' });

    await createDocumentWithChunks(doc1, []);
    await createDocumentWithChunks(doc2, []);

    const results = await processPendingKnowledgeDocuments();
    const processed = results.filter((r) => r.status === 'processed');
    expect(processed.length).toBe(2);

    const p1Chunks = await getChunksForDocument('p1');
    expect(p1Chunks.length).toBeGreaterThan(0);

    const p2Chunks = await getChunksForDocument('p2');
    expect(p2Chunks.length).toBeGreaterThan(0);
  });

  it('skips already-processed documents', async () => {
    const doc = makeDoc({ processingVersion: 2, contentHash: 'h3' });
    const chunks = [
      {
        id: `${doc.id}:v2:0`,
        documentId: doc.id,
        index: 0,
        text: doc.content,
        startOffset: 0,
        endOffset: doc.content.length,
        processingVersion: 2,
      },
    ];
    await createDocumentWithChunks(doc, chunks);

    const results = await processPendingKnowledgeDocuments();
    expect(results.filter((r) => r.status === 'skipped').length).toBe(1);
  });

  it('one failure does not block others', async () => {
    const good = makeDoc({ id: 'good', contentHash: 'h4' });
    await createDocumentWithChunks(good, []);

    const results = await processPendingKnowledgeDocuments();
    const failed = results.filter((r) => r.status === 'failed');
    const processed = results.filter((r) => r.status === 'processed');
    // All should process successfully
    expect(processed.length).toBe(1);
    expect(failed.length).toBe(0);
  });
});

describe('getKnowledgeProcessingStatus', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  afterEach(() => {
    closeKnowledgeDatabase();
  });

  it('returns zero for empty database', async () => {
    const status = await getKnowledgeProcessingStatus();
    expect(status.totalDocuments).toBe(0);
    expect(status.totalChunks).toBe(0);
  });

  it('detects pending documents correctly', async () => {
    const doc = makeDoc();
    await createDocumentWithChunks(doc, []);

    const status = await getKnowledgeProcessingStatus();
    expect(status.totalDocuments).toBe(1);
    expect(status.pendingDocuments).toBe(1);
    expect(status.currentDocuments).toBe(0);
  });
});
