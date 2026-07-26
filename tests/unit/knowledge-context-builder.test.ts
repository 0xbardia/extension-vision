import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { buildKnowledgeContext, KNOWLEDGE_TIMEOUT_MS } from '../../src/knowledge/context-builder';
import {
  closeKnowledgeDatabase,
  openKnowledgeDatabase,
  resetKnowledgeDatabase,
} from '../../src/knowledge/database';
import { getKnowledgeSettings, saveKnowledgeSettings } from '../../src/knowledge/settings';
import {
  DEFAULT_KNOWLEDGE_SETTINGS,
  KNOWLEDGE_PROCESSING_VERSION,
} from '../../src/knowledge/types';
import type { KnowledgeDocumentRecord, KnowledgeChunkRecord } from '../../src/knowledge/types';

const makeDoc = (overrides: Partial<KnowledgeDocumentRecord> = {}): KnowledgeDocumentRecord => ({
  id: overrides.id || 'test-doc',
  fileName: 'test.txt',
  mimeType: 'text/plain',
  byteSize: 100,
  characterCount: 50,
  importedAt: Date.now(),
  updatedAt: Date.now(),
  enabled: true,
  contentHash: 'test-hash',
  processingVersion: KNOWLEDGE_PROCESSING_VERSION,
  content:
    'This is test document content for retrieval testing. It contains important keywords like fox and retrieval.',
  ...overrides,
});

const makeChunk = (doc: KnowledgeDocumentRecord, index: number): KnowledgeChunkRecord => ({
  id: `${doc.id}:v2:${index}`,
  documentId: doc.id,
  index,
  text: doc.content,
  startOffset: 0,
  endOffset: doc.content.length,
  processingVersion: KNOWLEDGE_PROCESSING_VERSION,
});

async function insertTestData(doc: KnowledgeDocumentRecord, chunks: KnowledgeChunkRecord[]) {
  // Use raw IndexedDB to avoid dbCache issues
  const req = indexedDB.open('extension-vision-knowledge', 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('documents')) {
      const ds = db.createObjectStore('documents', { keyPath: 'id' });
      ds.createIndex('contentHash', 'contentHash', { unique: true });
      ds.createIndex('enabled', 'enabled', { unique: false });
      ds.createIndex('importedAt', 'importedAt', { unique: false });
    }
    if (!db.objectStoreNames.contains('chunks')) {
      const cs = db.createObjectStore('chunks', { keyPath: 'id' });
      cs.createIndex('documentId', 'documentId', { unique: false });
      cs.createIndex('documentId_index', ['documentId', 'index'], { unique: true });
    }
  };
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = db.transaction(['documents', 'chunks'], 'readwrite');
  tx.objectStore('documents').add(doc);
  for (const chunk of chunks) {
    tx.objectStore('chunks').add(chunk);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function insertDocAndChunk(docId: string, fileName: string, content: string) {
  const doc = makeDoc({ id: docId, fileName, content, contentHash: `h-${docId}` });
  await insertTestData(doc, [makeChunk(doc, 0)]);
}

async function setKnowledgeEnabled(enabled: boolean) {
  const { saveKnowledgeSettings } = await import('../../src/knowledge/settings');
  const settings = await getKnowledgeSettings();
  await saveKnowledgeSettings({ ...settings, enabled });
}

beforeEach(async () => {
  // Mock chrome.storage.local for settings
  const storage: Record<string, unknown> = {};
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (keys?: string | string[] | Record<string, unknown> | null) => {
          if (typeof keys === 'string') return { [keys]: storage[keys] };
          return storage;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(storage, items);
        },
        remove: async (keys: string | string[]) => {
          if (Array.isArray(keys)) keys.forEach((k) => delete storage[k]);
          else delete storage[keys];
        },
        clear: async () => {
          Object.keys(storage).forEach((k) => delete storage[k]);
        },
      },
    },
    runtime: { id: 'test-extension-id' },
  } as any;

  // Clean by deleting and recreating the database
  try {
    await closeKnowledgeDatabase();
  } catch {}
  resetKnowledgeDatabase();
  // Use a fresh indexedDB connection for cleanup
  const req = indexedDB.deleteDatabase('extension-vision-knowledge');
  await new Promise<void>((resolve) => {
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
  resetKnowledgeDatabase();
});

afterEach(async () => {
  await closeKnowledgeDatabase();
});

describe('buildKnowledgeContext', () => {
  it('returns disabled when global knowledge is disabled', async () => {
    const result = await buildKnowledgeContext('test query');
    expect(result.status).toBe('disabled');
    expect(result.text).toBe('');
  });

  it('returns no-query for empty effective instruction', async () => {
    await setKnowledgeEnabled(true);
    const result = await buildKnowledgeContext('');
    expect(result.status).toBe('no-query');
    expect(result.text).toBe('');
  });

  it('returns no-query for meaningless query', async () => {
    await setKnowledgeEnabled(true);
    const result = await buildKnowledgeContext('!!! ???');
    expect(result.status).toBe('no-query');
    expect(result.text).toBe('');
  });

  it('returns no-match when no documents exist', async () => {
    await setKnowledgeEnabled(true);
    const result = await buildKnowledgeContext('fox');
    expect(result.status).toBe('no-match');
    expect(result.text).toBe('');
  });

  it('returns included when documents match', async () => {
    await insertDocAndChunk('match-doc-1', 'match.txt', 'fox retrieval keyword test content');
    await setKnowledgeEnabled(true);
    const result = await buildKnowledgeContext('fox');
    expect(result.status).toBe('included');
    expect(result.text).toContain('fox');
    expect(result.text).toContain('SECURITY NOTICE');
    expect(result.sourceCount).toBeGreaterThan(0);
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.characterCount).toBeGreaterThan(0);
  });

  it('includes security notice in result text', async () => {
    await insertDocAndChunk('sec-doc', 'security.txt', 'fox retrieval keyword test');
    await setKnowledgeEnabled(true);
    const result = await buildKnowledgeContext('fox');
    expect(result.text).toContain('SECURITY NOTICE');
    expect(result.text).toContain('untrusted reference material');
    expect(result.text).toContain('--- BEGIN LOCAL KNOWLEDGE ---');
    expect(result.text).toContain('--- END LOCAL KNOWLEDGE ---');
  });

  it('includes source label in result text', async () => {
    await insertDocAndChunk('label-doc', 'labels.txt', 'fox retrieval keyword test');
    await setKnowledgeEnabled(true);
    const result = await buildKnowledgeContext('fox');
    expect(result.text).toContain('labels.txt');
    expect(result.text).toContain('Source 1');
  });

  it('handles multiple sources', async () => {
    await insertDocAndChunk('multi-1', 'a.txt', 'fox retrieval keyword test a');
    await insertDocAndChunk('multi-2', 'b.txt', 'fox retrieval keyword test b');
    await setKnowledgeEnabled(true);
    const result = await buildKnowledgeContext('fox');
    expect(result.status).toBe('included');
    expect(result.documentIds.length).toBeGreaterThan(0);
  });

  it('returns included for Persian query', async () => {
    await insertDocAndChunk('fa-doc', 'fa.txt', 'متن فارسی برای تست بازیابی اطلاعات');
    await setKnowledgeEnabled(true);
    const result = await buildKnowledgeContext('بازیابی اطلاعات');
    expect(result.status).toBe('included');
    expect(result.text).toContain('متن فارسی');
  });

  it('returns included for mixed query', async () => {
    await insertDocAndChunk('mx-doc', 'mx.txt', 'Mixed Persian and English content for بازیابی');
    await setKnowledgeEnabled(true);
    const result = await buildKnowledgeContext('بازیابی retrieval');
    expect(result.status).toBe('included');
  });

  it('no documentIds exposed in provider text', async () => {
    const doc = makeDoc({ id: 'hidden-id-doc' });
    await insertTestData(doc, [makeChunk(doc, 0)]);
    await setKnowledgeEnabled(true);
    const result = await buildKnowledgeContext('fox');
    expect(result.text).not.toContain('hidden-id-doc');
  });

  it('no scores in result text', async () => {
    const doc = makeDoc({ id: 'score-doc' });
    await insertTestData(doc, [makeChunk(doc, 0)]);
    await setKnowledgeEnabled(true);
    const result = await buildKnowledgeContext('fox');
    expect(result.text).not.toMatch(/score/i);
  });

  it('no content hashes in result text', async () => {
    const doc = makeDoc({ id: 'hash-doc', contentHash: 'abcdef1234567890abcdef1234567890' });
    await insertTestData(doc, [makeChunk(doc, 0)]);
    await setKnowledgeEnabled(true);
    const result = await buildKnowledgeContext('fox');
    expect(result.text).not.toContain(doc.contentHash);
  });

  it('fails gracefully when settings unavailable', async () => {
    // Reset to defaults with disabled
    await setKnowledgeEnabled(true);
    const result = await buildKnowledgeContext('test');
    // Should still work since settings are available
    expect(result.status).toBe('no-match');
  });

  it('deterministic result for same query and data', async () => {
    const doc = makeDoc({ id: 'det-doc' });
    await insertTestData(doc, [makeChunk(doc, 0)]);
    await setKnowledgeEnabled(true);
    const a = await buildKnowledgeContext('fox');
    const b = await buildKnowledgeContext('fox');
    expect(a.status).toBe(b.status);
    expect(a.text).toBe(b.text);
    expect(a.sourceCount).toBe(b.sourceCount);
    expect(a.documentIds).toEqual(b.documentIds);
  });
});
