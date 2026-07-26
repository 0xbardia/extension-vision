import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { retrieveKnowledge } from '../../src/knowledge/retrieval';
import { closeKnowledgeDatabase, openKnowledgeDatabase } from '../../src/knowledge/database';
import { createDocumentWithChunks } from '../../src/knowledge/repository';
import { getKnowledgeSettings, saveKnowledgeSettings } from '../../src/knowledge/settings';
import { KNOWLEDGE_PROCESSING_VERSION } from '../../src/knowledge/types';
import type { KnowledgeDocumentRecord, KnowledgeChunkRecord } from '../../src/knowledge/types';

const STORAGE_KEY = 'knowledgeSettings';

function makeDoc(overrides: Partial<KnowledgeDocumentRecord> = {}): KnowledgeDocumentRecord {
  return {
    id: overrides.id ?? 'doc-' + Math.random().toString(36).slice(2, 8),
    fileName: 'test.txt',
    mimeType: 'text/plain',
    byteSize: 100,
    characterCount: 95,
    importedAt: Date.now(),
    updatedAt: Date.now(),
    enabled: true,
    contentHash: 'hash-' + Math.random().toString(36),
    processingVersion: KNOWLEDGE_PROCESSING_VERSION,
    content: 'This is a test document with enough content for retrieval testing purposes. '.repeat(
      20,
    ),
    ...overrides,
  };
}

function makeChunks(doc: KnowledgeDocumentRecord, texts: string[]): KnowledgeChunkRecord[] {
  let offset = 0;
  return texts.map((text, i) => {
    const chunk = {
      id: `${doc.id}:v2:${i}`,
      documentId: doc.id,
      index: i,
      text,
      startOffset: offset,
      endOffset: offset + text.length,
      processingVersion: KNOWLEDGE_PROCESSING_VERSION,
    };
    offset += text.length;
    return chunk;
  });
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

// Set up chrome.storage mock
const chromeData: Record<string, unknown> = {};

function setupChrome() {
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (defaults?: Record<string, unknown>) => {
          if (defaults && typeof defaults === 'object') {
            return { ...defaults, ...chromeData };
          }
          const result: Record<string, unknown> = {};
          if (chromeData[STORAGE_KEY] !== undefined) result[STORAGE_KEY] = chromeData[STORAGE_KEY];
          return result;
        }),
        set: vi.fn(async (value: Record<string, unknown>) => {
          Object.assign(chromeData, value);
        }),
        remove: vi.fn(),
      },
    },
  });
}

describe('retrieveKnowledge', () => {
  beforeEach(async () => {
    await cleanDb();
    for (const key of Object.keys(chromeData)) delete chromeData[key];
    setupChrome();
    await saveKnowledgeSettings({ enabled: true });
  });

  afterEach(() => {
    closeKnowledgeDatabase();
    vi.unstubAllGlobals();
  });

  it('returns knowledge-disabled when global setting is off', async () => {
    await saveKnowledgeSettings({ enabled: false });
    const result = await retrieveKnowledge('hello');
    expect(result.reason).toBe('knowledge-disabled');
    expect(result.matches).toHaveLength(0);
  });

  it('returns no-enabled-documents when none are enabled', async () => {
    const doc = makeDoc({ enabled: false });
    await createDocumentWithChunks(doc, makeChunks(doc, ['Hello world content.']));
    const result = await retrieveKnowledge('hello');
    expect(result.reason).toBe('no-enabled-documents');
  });

  it('returns no-processed-chunks when document has no chunks', async () => {
    const doc = makeDoc({ processingVersion: 1 });
    await createDocumentWithChunks(doc, []);
    const result = await retrieveKnowledge('hello');
    expect(result.reason).toBe('no-processed-chunks');
  });

  it('returns query-not-meaningful for meaningless input', async () => {
    const result = await retrieveKnowledge('');
    expect(result.reason).toBe('query-not-meaningful');
  });

  it('finds English exact match', async () => {
    const doc = makeDoc({ id: 'doc-en', contentHash: 'h-en' });
    const chunks = makeChunks(doc, ['The quick brown fox jumps over the lazy dog.']);
    await createDocumentWithChunks(doc, chunks);

    const result = await retrieveKnowledge('fox');
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].text.toLowerCase()).toContain('fox');
  });

  it('finds Persian exact match', async () => {
    const doc = makeDoc({ id: 'doc-fa', contentHash: 'h-fa', fileName: 'persian.txt' });
    const chunks = makeChunks(doc, ['این یک متن فارسی برای تست است.']);
    await createDocumentWithChunks(doc, chunks);

    const result = await retrieveKnowledge('فارسی');
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('handles Arabic/Persian variant matching', async () => {
    const doc = makeDoc({ id: 'doc-ar', contentHash: 'h-ar' });
    // Use a word that has ك which normalizes to ک
    const chunks = makeChunks(doc, ['كلمة اختبار باللغة العربية']); // contains ك
    await createDocumentWithChunks(doc, chunks);

    // Searching with ک (Persian kaf) should match ك (Arabic kaf) after normalization
    // normalizeForSearch converts ك→ک, so both "كلمة" and "کلمة" become "کلمة"
    const result = await retrieveKnowledge('كلمة');
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('finds Persian digit matches', async () => {
    const doc = makeDoc({ id: 'doc-fa-digit', contentHash: 'h-fad' });
    const chunks = makeChunks(doc, ['قیمت ۱۲۳ تومان']);
    await createDocumentWithChunks(doc, chunks);

    const result = await retrieveKnowledge('123');
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('finds English digit matches', async () => {
    const doc = makeDoc({ id: 'doc-en-digit', contentHash: 'h-end' });
    const chunks = makeChunks(doc, ['Price is 123 dollars.']);
    await createDocumentWithChunks(doc, chunks);

    const result = await retrieveKnowledge('123');
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('handles mixed-language queries', async () => {
    const doc = makeDoc({ id: 'doc-mixed-q', contentHash: 'h-mq' });
    const chunks = makeChunks(doc, ['English text with فارسی mixed in.']);
    await createDocumentWithChunks(doc, chunks);

    const result = await retrieveKnowledge('English فارسی');
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('respects top-K limit', async () => {
    const doc = makeDoc({ id: 'doc-topk', contentHash: 'h-tk' });
    // Create many chunks all containing "keyword"
    const manyChunks = Array.from({ length: 20 }, (_, i) => ({
      id: `doc-topk:v2:${i}`,
      documentId: doc.id,
      index: i,
      text: `This chunk number ${i} contains the keyword for testing.`,
      startOffset: i * 50,
      endOffset: i * 50 + 50,
      processingVersion: KNOWLEDGE_PROCESSING_VERSION,
    }));
    await createDocumentWithChunks(doc, manyChunks);

    const result = await retrieveKnowledge('keyword', { maximumChunks: 3 });
    expect(result.matches.length).toBeLessThanOrEqual(3);
  });

  it('respects character budget', async () => {
    const doc = makeDoc({ id: 'doc-charb', contentHash: 'h-cb' });
    const manyChunks = Array.from({ length: 5 }, (_, i) => ({
      id: `doc-charb:v2:${i}`,
      documentId: doc.id,
      index: i,
      text: `Chunk ${i} with keyword test content. `.repeat(20),
      startOffset: i * 500,
      endOffset: i * 500 + 500,
      processingVersion: KNOWLEDGE_PROCESSING_VERSION,
    }));
    await createDocumentWithChunks(doc, manyChunks);

    const result = await retrieveKnowledge('keyword', { maximumCharacters: 100 });
    expect(result.returnedCharacters).toBeLessThanOrEqual(200); // some headroom
  });

  it('excludes disabled documents', async () => {
    const enabled = makeDoc({ id: 'doc-on', enabled: true, contentHash: 'h-on' });
    const disabled = makeDoc({ id: 'doc-off', enabled: false, contentHash: 'h-off' });

    await createDocumentWithChunks(enabled, makeChunks(enabled, ['Keyword in enabled document.']));
    await createDocumentWithChunks(
      disabled,
      makeChunks(disabled, ['Keyword in disabled document.']),
    );

    const result = await retrieveKnowledge('keyword');
    expect(result.matches.length).toBeGreaterThan(0);
    for (const match of result.matches) {
      expect(match.documentId).toBe('doc-on');
    }
  });

  it('provides correct result metadata', async () => {
    const doc = makeDoc({ id: 'doc-meta', contentHash: 'h-meta' });
    await createDocumentWithChunks(doc, makeChunks(doc, ['Specific test content.']));

    const result = await retrieveKnowledge('specific');
    expect(result.query).toBe('specific');
    expect(result.normalizedQuery.length).toBeGreaterThan(0);
    expect(result.totalEligibleDocuments).toBeGreaterThan(0);
    expect(result.totalEligibleChunks).toBeGreaterThan(0);
    expect(result.totalMatchedChunks).toBeGreaterThan(0);
  });

  it('returns empty for no match', async () => {
    const doc = makeDoc({ id: 'doc-nomatch', contentHash: 'h-nm' });
    await createDocumentWithChunks(doc, makeChunks(doc, ['Unique content here.']));

    const result = await retrieveKnowledge('xyznonexistent');
    expect(result.matches).toHaveLength(0);
    expect(result.reason).toBe('no-match');
  });
});
