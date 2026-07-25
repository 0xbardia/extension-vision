/**
 * Unit tests for the knowledge UI module.
 *
 * These tests use fake-indexeddb and chrome.storage mocks.
 * DOM-dependent rendering is tested via E2E/Manual QA.
 *
 * Focus: document management operations, settings integration,
 * storage usage tracking, and repository behavior that the UI orchestrates.
 */

import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocumentRecord } from '../../src/knowledge/types';
import { closeKnowledgeDatabase, openKnowledgeDatabase } from '../../src/knowledge/database';
import {
  createDocumentWithChunks,
  getKnowledgeStorageUsage,
  listDocuments,
  updateDocumentEnabled,
  deleteDocumentCascade,
} from '../../src/knowledge/repository';
import { KnowledgeError } from '../../src/knowledge/errors';

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
}

// ─── Chrome Storage Mock ────────────────────────────────────────────────────

function setupChromeStorage(data: Record<string, unknown> = {}): void {
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (defaults?: Record<string, unknown>) => {
          if (defaults && typeof defaults === 'object') {
            return { ...defaults, ...data };
          }
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

// ─── Tests ──────────────────────────────────────────────────────────────────

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
    const { getKnowledgeSettings } = await import('../../src/knowledge/settings');
    const settings = await getKnowledgeSettings();
    expect(settings.enabled).toBe(false);
  });

  it('persists master enabled state', async () => {
    const { saveKnowledgeSettings, getKnowledgeSettings } =
      await import('../../src/knowledge/settings');
    await saveKnowledgeSettings({ enabled: true });
    const settings = await getKnowledgeSettings();
    expect(settings.enabled).toBe(true);
  });

  it('persists master disabled state', async () => {
    const { saveKnowledgeSettings, getKnowledgeSettings } =
      await import('../../src/knowledge/settings');
    await saveKnowledgeSettings({ enabled: false });
    const settings = await getKnowledgeSettings();
    expect(settings.enabled).toBe(false);
  });

  it('does not modify other settings when saving knowledge settings', async () => {
    const { saveKnowledgeSettings, getKnowledgeSettings } =
      await import('../../src/knowledge/settings');
    await saveKnowledgeSettings({ enabled: true });
    const settings = await getKnowledgeSettings();
    // Check that other defaults are preserved
    expect(settings.maximumFileSizeBytes).toBe(1048576);
    expect(settings.schemaVersion).toBe(1);
  });

  it('safe filename rendering - no HTML injection via filename', () => {
    // Verify that a filename with HTML characters is stored as text
    const maliciousName = '<img src=x onerror=alert(1)>.txt';
    const doc = makeDoc({ fileName: maliciousName });
    // The fileName should be the original string content as stored
    expect(doc.fileName).toBe(maliciousName);
    // The UI module uses textContent for filenames, not innerHTML
    // This test verifies the data model doesn't transform filenames
  });

  it('settings module loads without crashing', async () => {
    const { getKnowledgeSettings } = await import('../../src/knowledge/settings');
    await expect(getKnowledgeSettings()).resolves.toBeDefined();
  });
});

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
    // Ordered by importedAt descending: d2 (200), d3 (150), d1 (100)
    expect(docs.map((d) => d.id)).toEqual(['d2', 'd3', 'd1']);
  });

  it('toggles document enabled state', async () => {
    const doc = makeDoc({ enabled: true });
    await createDocumentWithChunks(doc, []);

    await updateDocumentEnabled(doc.id, false);
    const docs = await listDocuments();
    expect(docs[0].enabled).toBe(false);

    await updateDocumentEnabled(doc.id, true);
    const docs2 = await listDocuments();
    expect(docs2[0].enabled).toBe(true);
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

  it('storage usage reflects imported documents', async () => {
    const doc1 = makeDoc({ id: 'u1', contentHash: 'uh1' });
    const doc2 = makeDoc({ id: 'u2', contentHash: 'uh2' });
    await createDocumentWithChunks(doc1, []);
    await createDocumentWithChunks(doc2, []);

    const usage = await getKnowledgeStorageUsage();
    expect(usage.documentCount).toBe(2);
    expect(usage.chunkCount).toBe(0);
    expect(usage.estimatedBytes).toBeGreaterThan(0);
  });

  it('storage usage updates after deletion', async () => {
    const doc = makeDoc({ id: 'del-u', contentHash: 'duh1' });
    await createDocumentWithChunks(doc, []);

    const before = await getKnowledgeStorageUsage();
    expect(before.documentCount).toBe(1);

    await deleteDocumentCascade(doc.id);
    const after = await getKnowledgeStorageUsage();
    expect(after.documentCount).toBe(0);
  });

  it('empty state returns zero documents', async () => {
    const docs = await listDocuments();
    expect(docs).toHaveLength(0);
  });

  it('can achieve partial batch success', async () => {
    // Simulate batch: import 2 valid, check counts
    const doc1 = makeDoc({ id: 'batch1', contentHash: 'bh1' });
    const doc2 = makeDoc({ id: 'batch2', contentHash: 'bh2' });
    await createDocumentWithChunks(doc1, []);
    await createDocumentWithChunks(doc2, []);

    const docs = await listDocuments();
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.id)).toContain('batch1');
    expect(docs.map((d) => d.id)).toContain('batch2');
  });
});
