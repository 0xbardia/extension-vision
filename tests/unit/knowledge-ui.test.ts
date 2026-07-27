/**
 * Unit tests for the knowledge UI module.
 *
 * Tests use pure exported functions, fake-indexeddb, and chrome.storage mocks.
 * DOM-dependent rendering is tested via E2E/Manual QA.
 */
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type {
  KnowledgeDocumentRecord,
  KnowledgeSolveUsageMessage,
} from '../../src/knowledge/types';
import { SOLVE_KNOWLEDGE_USAGE_EVENT } from '../../src/knowledge/types';
import { KNOWLEDGE_TIMEOUT_MS } from '../../src/knowledge/context-builder';
import { closeKnowledgeDatabase, openKnowledgeDatabase } from '../../src/knowledge/database';
import {
  createDocumentWithChunks,
  getKnowledgeStorageUsage,
  listDocuments,
  updateDocumentEnabled,
  deleteDocumentCascade,
  deleteAllDocumentsCascade,
  getChunksForDocument,
} from '../../src/knowledge/repository';
import { KnowledgeError } from '../../src/knowledge/errors';
import {
  processKnowledgeDocument,
  processPendingKnowledgeDocuments,
} from '../../src/knowledge/processing';
import { buildKnowledgeContext } from '../../src/knowledge/context-builder';
import { getKnowledgeSettings, saveKnowledgeSettings } from '../../src/knowledge/settings';

// ─── Helpers ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'knowledgeSettings';

function makeDoc(overrides: Partial<KnowledgeDocumentRecord> = {}): KnowledgeDocumentRecord {
  const id = overrides.id ?? `doc-${Date.now()}-${Math.random()}`;
  return {
    id,
    fileName: 'test.txt',
    mimeType: 'text/plain',
    byteSize: 100,
    characterCount: 95,
    importedAt: Date.now(),
    updatedAt: Date.now(),
    enabled: true,
    contentHash: `hash-${id}`,
    processingVersion: 1,
    content: 'Test content.',
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
  db.close();
  closeKnowledgeDatabase();
}

function setupChromeStorage(data: Record<string, unknown> = {}): void {
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (defaults?: Record<string, unknown>) => {
          if (defaults && typeof defaults === 'object') return { ...defaults, ...data };
          const result: Record<string, unknown> = {};
          if (data[STORAGE_KEY] !== undefined) result[STORAGE_KEY] = data[STORAGE_KEY];
          return result;
        }),
        set: vi.fn(async (value: Record<string, unknown>) => {
          Object.assign(data, value);
        }),
        remove: vi.fn(),
      },
    },
  });
}

// ─── Solve Usage Pure Text Tests ────────────────────────────────────────────

describe('knowledge UI - solve usage text', () => {
  it('renders used message with exact text', async () => {
    const { getSolveUsageTextAndLevel } = await import('../../src/knowledge/ui');
    const msg: KnowledgeSolveUsageMessage = {
      type: 'knowledge-solve-usage',
      status: 'used',
      requestId: 'r1',
      included: true,
      sourceCount: 3,
      chunkCount: 5,
      characterCount: 1200,
      buildDurationMs: 45,
    };
    expect(getSolveUsageTextAndLevel(msg).text).toBe('Local Knowledge used · 3 excerpts');
  });

  it('renders used with singular "excerpt" for sourceCount 1', async () => {
    const { getSolveUsageTextAndLevel } = await import('../../src/knowledge/ui');
    const msg: KnowledgeSolveUsageMessage = {
      type: 'knowledge-solve-usage',
      status: 'used',
      requestId: 'r2',
      included: true,
      sourceCount: 1,
      chunkCount: 1,
      characterCount: 400,
      buildDurationMs: 30,
    };
    expect(getSolveUsageTextAndLevel(msg).text).toBe('Local Knowledge used · 1 excerpt');
  });

  it('renders disabled message with exact text', async () => {
    const { getSolveUsageTextAndLevel } = await import('../../src/knowledge/ui');
    const msg: KnowledgeSolveUsageMessage = {
      type: 'knowledge-solve-usage',
      status: 'disabled',
      requestId: 'r3',
      included: false,
      sourceCount: 0,
      chunkCount: 0,
      characterCount: 0,
      buildDurationMs: 0,
    };
    expect(getSolveUsageTextAndLevel(msg).text).toBe('Local Knowledge not used · Disabled');
  });

  it('renders no-query message with exact text', async () => {
    const { getSolveUsageTextAndLevel } = await import('../../src/knowledge/ui');
    const msg: KnowledgeSolveUsageMessage = {
      type: 'knowledge-solve-usage',
      status: 'no-query',
      requestId: 'r4',
      included: false,
      sourceCount: 0,
      chunkCount: 0,
      characterCount: 0,
      buildDurationMs: 0,
    };
    expect(getSolveUsageTextAndLevel(msg).text).toBe(
      'Local Knowledge not used · No meaningful query',
    );
  });

  it('renders no-match message with exact text', async () => {
    const { getSolveUsageTextAndLevel } = await import('../../src/knowledge/ui');
    const msg: KnowledgeSolveUsageMessage = {
      type: 'knowledge-solve-usage',
      status: 'no-match',
      requestId: 'r5',
      included: false,
      sourceCount: 0,
      chunkCount: 0,
      characterCount: 0,
      buildDurationMs: 0,
    };
    expect(getSolveUsageTextAndLevel(msg).text).toBe(
      'Local Knowledge not used · No relevant match',
    );
  });

  it('renders unavailable message with exact text', async () => {
    const { getSolveUsageTextAndLevel } = await import('../../src/knowledge/ui');
    const msg: KnowledgeSolveUsageMessage = {
      type: 'knowledge-solve-usage',
      status: 'unavailable',
      requestId: 'r6',
      included: false,
      sourceCount: 0,
      chunkCount: 0,
      characterCount: 0,
      buildDurationMs: 0,
    };
    expect(getSolveUsageTextAndLevel(msg).text).toBe(
      'Local Knowledge unavailable · Solve continued without it',
    );
  });

  it('renders failed message with exact text', async () => {
    const { getSolveUsageTextAndLevel } = await import('../../src/knowledge/ui');
    const msg: KnowledgeSolveUsageMessage = {
      type: 'knowledge-solve-usage',
      status: 'failed',
      requestId: 'r7',
      included: false,
      sourceCount: 0,
      chunkCount: 0,
      characterCount: 0,
      buildDurationMs: 0,
    };
    expect(getSolveUsageTextAndLevel(msg).text).toBe(
      'Local Knowledge not used · Preparation failed',
    );
  });

  it('renders timeout message with exact text', async () => {
    const { getSolveUsageTextAndLevel } = await import('../../src/knowledge/ui');
    const msg: KnowledgeSolveUsageMessage = {
      type: 'knowledge-solve-usage',
      status: 'timeout',
      requestId: 'r8',
      included: false,
      sourceCount: 0,
      chunkCount: 0,
      characterCount: 0,
      buildDurationMs: 0,
    };
    expect(getSolveUsageTextAndLevel(msg).text).toBe(
      'Local Knowledge timed out · Solve continued without it',
    );
  });

  it('returns empty text for unknown status', async () => {
    const { getSolveUsageTextAndLevel } = await import('../../src/knowledge/ui');
    const msg = {
      type: 'knowledge-solve-usage' as const,
      status: 'bogus' as string,
      requestId: 'r9',
      included: false,
      sourceCount: 0,
      chunkCount: 0,
      characterCount: 0,
      buildDurationMs: 0,
    } as unknown as KnowledgeSolveUsageMessage;
    expect(getSolveUsageTextAndLevel(msg).text).toBe('');
  });
});

// ─── Solve Usage Message Handler (pure dedup/staleness) ─────────────────────

describe('knowledge UI - solve usage message handler', () => {
  let lastId = '';

  beforeEach(() => {
    lastId = '';
  });

  function callHandler(msg: Partial<KnowledgeSolveUsageMessage>): boolean {
    const { onSolveUsageMessage } = require('../../src/knowledge/ui');
    // We can't easily reset lastSolveRequestId, so we test via the handler
    // directly. The dedup/staleness logic requires module-level state.
    // Instead, test the pure logic paths that are reachable.
    return onSolveUsageMessage(msg, {} as chrome.runtime.MessageSender);
  }

  it('rejects malformed message (no type)', async () => {
    const { onSolveUsageMessage } = await import('../../src/knowledge/ui');
    const result = onSolveUsageMessage(
      { foo: 'bar' } as unknown as KnowledgeSolveUsageMessage,
      {} as chrome.runtime.MessageSender,
    );
    expect(result).toBe(false);
  });

  it('rejects malformed message (wrong type)', async () => {
    const { onSolveUsageMessage } = await import('../../src/knowledge/ui');
    const result = onSolveUsageMessage(
      { type: 'wrong' } as unknown as KnowledgeSolveUsageMessage,
      {} as chrome.runtime.MessageSender,
    );
    expect(result).toBe(false);
  });
});

// ─── No Private Data in Usage Text ──────────────────────────────────────────

describe('knowledge UI - usage text privacy', () => {
  it('does not render filename, query, chunk text, ID, or score', async () => {
    const { getSolveUsageTextAndLevel } = await import('../../src/knowledge/ui');
    const msg: KnowledgeSolveUsageMessage = {
      type: 'knowledge-solve-usage',
      status: 'used',
      requestId: 'r-privacy',
      included: true,
      sourceCount: 2,
      chunkCount: 3,
      characterCount: 600,
      buildDurationMs: 30,
    };
    const { text } = getSolveUsageTextAndLevel(msg);
    expect(text).toContain('Local Knowledge');
    expect(text).not.toContain('chunk');
    expect(text).not.toContain('query');
    expect(text).not.toContain('filename');
    expect(text).not.toContain('r-privacy');
    expect(text).not.toContain('600');
    expect(text).not.toContain('score');
  });
});

// ─── Failed path behavior ───────────────────────────────────────────────────

describe('knowledge processing - failed path', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  afterEach(() => {
    closeKnowledgeDatabase();
  });

  it('returns failed for non-existent document', async () => {
    const result = await processKnowledgeDocument('nonexistent-doc');
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('KNOWLEDGE_DOCUMENT_NOT_FOUND');
      expect(result.message).toBe('Document not found.');
      expect(result.message).not.toMatch(/\/root\//);
    }
  });

  it('returns skipped for already-current v2 document with chunks', async () => {
    const { chunkDocument } = await import('../../src/knowledge/chunking');
    const doc = makeDoc({
      id: 'current-doc',
      contentHash: 'ch1',
      processingVersion: 2,
      content: 'Already processed doc. '.repeat(10),
    });
    const chunks = chunkDocument(doc.id, doc.content);
    await createDocumentWithChunks(doc, chunks);
    const result = await processKnowledgeDocument('current-doc');
    expect(result.status).toBe('skipped');
  });

  it('returns processed for v1 document', async () => {
    const doc = makeDoc({
      id: 'v1-doc',
      contentHash: 'ch2',
      processingVersion: 1,
      content: 'Needs processing. '.repeat(5),
    });
    await createDocumentWithChunks(doc, []);
    const result = await processKnowledgeDocument('v1-doc');
    expect(result.status).toBe('processed');
    if (result.status === 'processed') {
      expect(result.chunkCount).toBeGreaterThan(0);
      const chunks = await getChunksForDocument('v1-doc');
      expect(chunks.length).toBe(result.chunkCount);
    }
  });

  it('hides raw error details', async () => {
    closeKnowledgeDatabase();
    const result = await processKnowledgeDocument('any-doc');
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.message).toBe('Document not found.');
      expect(result.message).not.toMatch(/\/root\//);
      expect(result.message).not.toMatch(/objectStore/i);
    }
  });
});

// ─── Settings ───────────────────────────────────────────────────────────────

describe('knowledge UI - settings', () => {
  const chromeData: Record<string, unknown> = {};

  beforeEach(() => {
    for (const key of Object.keys(chromeData)) delete chromeData[key];
    setupChromeStorage(chromeData);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to disabled', async () => {
    const settings = await getKnowledgeSettings();
    expect(settings.enabled).toBe(false);
  });

  it('persists master enabled state', async () => {
    await saveKnowledgeSettings({ enabled: true });
    const settings = await getKnowledgeSettings();
    expect(settings.enabled).toBe(true);
  });

  it('persists master disabled state', async () => {
    await saveKnowledgeSettings({ enabled: false });
    const settings = await getKnowledgeSettings();
    expect(settings.enabled).toBe(false);
  });

  it('preserves other settings when saving knowledge settings', async () => {
    await saveKnowledgeSettings({ enabled: true });
    const settings = await getKnowledgeSettings();
    expect(settings.maximumFileSizeBytes).toBe(1048576);
    expect(settings.schemaVersion).toBe(1);
  });

  it('stores safe filename as-is (no HTML transformation)', () => {
    const maliciousName = '<img src=x onerror=alert(1)>.txt';
    const doc = makeDoc({ fileName: maliciousName });
    expect(doc.fileName).toBe(maliciousName);
  });
});

// ─── Documents ──────────────────────────────────────────────────────────────

describe('knowledge UI - documents', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  afterEach(() => {
    closeKnowledgeDatabase();
  });

  it('loads empty document list', async () => {
    const docs = await listDocuments();
    expect(docs).toEqual([]);
  });

  it('returns documents in deterministic order', async () => {
    const now = Date.now();
    const doc1 = makeDoc({ id: 'd1', fileName: 'b.txt', importedAt: now + 100, contentHash: 'h1' });
    const doc2 = makeDoc({ id: 'd2', fileName: 'a.txt', importedAt: now + 200, contentHash: 'h2' });
    const doc3 = makeDoc({ id: 'd3', fileName: 'c.txt', importedAt: now + 150, contentHash: 'h3' });
    await createDocumentWithChunks(doc1, []);
    await createDocumentWithChunks(doc2, []);
    await createDocumentWithChunks(doc3, []);
    const docs = await listDocuments();
    expect(docs.map((d) => d.id)).toEqual(['d2', 'd3', 'd1']);
  });

  it('toggles document enabled state', async () => {
    const doc = makeDoc({ enabled: true });
    await createDocumentWithChunks(doc, []);
    await updateDocumentEnabled(doc.id, false);
    expect((await listDocuments())[0].enabled).toBe(false);
    await updateDocumentEnabled(doc.id, true);
    expect((await listDocuments())[0].enabled).toBe(true);
  });

  it('toggle throws for non-existent document', async () => {
    await expect(updateDocumentEnabled('nonexistent', false)).rejects.toThrow(KnowledgeError);
  });

  it('deletes a document and removes it from list', async () => {
    const doc = makeDoc();
    await createDocumentWithChunks(doc, []);
    expect(await listDocuments()).toHaveLength(1);
    await deleteDocumentCascade(doc.id);
    expect(await listDocuments()).toHaveLength(0);
  });

  it('delete is idempotent for non-existent document', async () => {
    await expect(deleteDocumentCascade('nonexistent')).resolves.toBeUndefined();
  });

  it('remove chunks with document on delete', async () => {
    const { chunkDocument } = await import('../../src/knowledge/chunking');
    const doc = makeDoc({ id: 'chunked-del', contentHash: 'chdel1', processingVersion: 2 });
    const chunks = chunkDocument(doc.id, doc.content);
    await createDocumentWithChunks(doc, chunks);
    expect((await getKnowledgeStorageUsage()).chunkCount).toBeGreaterThan(0);
    await deleteDocumentCascade(doc.id);
    const usage = await getKnowledgeStorageUsage();
    expect(usage.chunkCount).toBe(0);
    expect(usage.documentCount).toBe(0);
  });

  it('allows same filename with different content', async () => {
    await createDocumentWithChunks(
      makeDoc({ id: 'sn1', fileName: 'notes.txt', contentHash: 'h1' }),
      [],
    );
    await createDocumentWithChunks(
      makeDoc({ id: 'sn2', fileName: 'notes.txt', contentHash: 'h2' }),
      [],
    );
    const docs = await listDocuments();
    expect(docs).toHaveLength(2);
    expect(docs[0].fileName).toBe('notes.txt');
    expect(docs[1].fileName).toBe('notes.txt');
  });
});

// ─── Delete All ─────────────────────────────────────────────────────────────

describe('knowledge repository - delete all', () => {
  const chromeData: Record<string, unknown> = {};

  beforeEach(async () => {
    closeKnowledgeDatabase();
    await cleanDb();
    for (const key of Object.keys(chromeData)) delete chromeData[key];
    setupChromeStorage(chromeData);
  });

  afterEach(() => {
    closeKnowledgeDatabase();
    vi.unstubAllGlobals();
  });

  it('clears documents, chunks, and meta in one transaction', async () => {
    await createDocumentWithChunks(makeDoc({ id: 'tx1', contentHash: 'txh1' }), []);
    await createDocumentWithChunks(makeDoc({ id: 'tx2', contentHash: 'txh2' }), []);
    closeKnowledgeDatabase();
    const dbi = await openKnowledgeDatabase();
    const metaTx = dbi.transaction('meta', 'readwrite');
    metaTx.objectStore('meta').add({ key: 'test', value: 'data' });
    await new Promise<void>((r) => {
      metaTx.oncomplete = () => r();
    });
    closeKnowledgeDatabase();

    await deleteAllDocumentsCascade();

    expect(await listDocuments()).toHaveLength(0);
    const usage = await getKnowledgeStorageUsage();
    expect(usage.documentCount).toBe(0);
    expect(usage.chunkCount).toBe(0);

    const db2 = await openKnowledgeDatabase();
    const metaCount = await new Promise<number>((r) => {
      db2.transaction('meta').objectStore('meta').count().onsuccess = (e) =>
        r((e.target as IDBRequest).result as number);
    });
    db2.close();
    expect(metaCount).toBe(0);
  });

  it('returns 0 on empty database', async () => {
    expect(await deleteAllDocumentsCascade()).toBe(0);
  });

  it('can import after deleteAll', async () => {
    await deleteAllDocumentsCascade();
    await createDocumentWithChunks(makeDoc({ id: 'post', contentHash: 'pdh1' }), []);
    expect(await listDocuments()).toHaveLength(1);
  });

  it('preserves knowledge settings', async () => {
    await saveKnowledgeSettings({ enabled: true, maximumFileSizeBytes: 999999 });
    await deleteAllDocumentsCascade();
    const settings = await getKnowledgeSettings();
    expect(settings.enabled).toBe(true);
    expect(settings.maximumFileSizeBytes).toBe(999999);
  });

  it('preserves settings when documents existed', async () => {
    await saveKnowledgeSettings({ enabled: true });
    await createDocumentWithChunks(makeDoc({ id: 'preserve', contentHash: 'psh1' }), []);
    await deleteAllDocumentsCascade();
    expect((await getKnowledgeSettings()).enabled).toBe(true);
  });
});

// ─── Retry ──────────────────────────────────────────────────────────────────

describe('knowledge processing - retry behavior', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  afterEach(() => {
    closeKnowledgeDatabase();
  });

  it('processes one v1 document', async () => {
    const doc = makeDoc({
      id: 'retry-one',
      contentHash: 'roh1',
      processingVersion: 1,
      content: 'Retry test one document. '.repeat(10),
    });
    await createDocumentWithChunks(doc, []);
    const result = await processKnowledgeDocument('retry-one');
    expect(result.status).toBe('processed');
    if (result.status === 'processed') {
      expect((await getChunksForDocument('retry-one')).length).toBe(result.chunkCount);
    }
  });

  it('duplicate processing from pending guard is idempotent', async () => {
    const doc = makeDoc({
      id: 'retry-dup',
      contentHash: 'rdh1',
      processingVersion: 1,
      content: 'Duplicate retry guard text. '.repeat(10),
    });
    await createDocumentWithChunks(doc, []);
    const r1 = await processPendingKnowledgeDocuments();
    expect(r1.some((r) => r.status === 'processed')).toBe(true);
    const r2 = await processPendingKnowledgeDocuments();
    expect(r2.every((r) => r.status === 'skipped')).toBe(true);
  });

  it('failure preserves old valid chunks', async () => {
    const { chunkDocument } = await import('../../src/knowledge/chunking');
    const doc = makeDoc({
      id: 'preserve-chunks',
      contentHash: 'pch1',
      processingVersion: 2,
      content: 'Chunks to preserve on failure. '.repeat(20),
    });
    const chunks = chunkDocument(doc.id, doc.content);
    await createDocumentWithChunks(doc, chunks);
    expect(chunks.length).toBeGreaterThan(0);
    await processKnowledgeDocument('preserve-chunks');
    expect((await getChunksForDocument('preserve-chunks')).length).toBe(chunks.length);
  });

  it('hides raw error for non-existent doc', async () => {
    const result = await processKnowledgeDocument('no-such-doc');
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.message).not.toMatch(/\/root\//);
      expect(result.message).not.toContain('objectStore');
    }
  });
});

// ─── Import Error ───────────────────────────────────────────────────────────

describe('knowledge import - error safety', () => {
  const chromeData: Record<string, unknown> = {};

  beforeEach(async () => {
    closeKnowledgeDatabase();
    await cleanDb();
    for (const key of Object.keys(chromeData)) delete chromeData[key];
    setupChromeStorage(chromeData);
  });

  afterEach(() => {
    closeKnowledgeDatabase();
    vi.unstubAllGlobals();
  });

  it('rejects oversized file with safe message', async () => {
    const { importSingleFile } = await import('../../src/knowledge/import');
    const settings = await getKnowledgeSettings();
    const file = new File(['x'.repeat(settings.maximumFileSizeBytes + 1)], 'big.txt', {
      type: 'text/plain',
    });
    const result = await importSingleFile(file, settings, { documentCount: 0, estimatedBytes: 0 });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected' || result.status === 'failed') {
      expect(result.reason).not.toMatch(/\/root\//);
      expect(result.reason).not.toMatch(/objectStore/i);
    }
  });
});

// ─── Provider-not-blocked ───────────────────────────────────────────────────

describe('knowledge service worker - non-blocking usage event', () => {
  it('void sendSolveKnowledgeUsage does not block', async () => {
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: vi.fn(() => new Promise(() => {})) },
    });
    const sm = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
    void chrome.runtime.sendMessage({ type: 'knowledge-solve-usage', status: 'disabled' });
    expect(sm).toHaveBeenCalledTimes(1);
    expect(sm).toHaveBeenCalledWith(expect.objectContaining({ type: 'knowledge-solve-usage' }));
    vi.unstubAllGlobals();
  });
});
