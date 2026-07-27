/**
 * Tests for buildKnowledgeContext timeout behavior with controlled mock.
 */
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { KNOWLEDGE_TIMEOUT_MS } from '../../src/knowledge/context-builder';
import { closeKnowledgeDatabase, openKnowledgeDatabase } from '../../src/knowledge/database';

// Mock retrieval to hang forever — must be at module level
vi.mock('../../src/knowledge/retrieval', () => ({
  retrieveKnowledge: () => new Promise(() => {}),
  retrieveKnowledgeForQuery: () => new Promise(() => {}),
  getRetrievalStats: () => ({ totalDocuments: 0, totalChunks: 0 }),
}));

describe('knowledge context - timeout', () => {
  beforeEach(async () => {
    closeKnowledgeDatabase();
    const db = await openKnowledgeDatabase();
    const tx = db.transaction(['documents', 'chunks', 'meta'], 'readwrite');
    tx.objectStore('documents').clear();
    tx.objectStore('chunks').clear();
    tx.objectStore('meta').clear();
    await new Promise<void>((r) => {
      tx.oncomplete = () => r();
    });
    db.close();
    closeKnowledgeDatabase();
  });

  afterEach(() => {
    closeKnowledgeDatabase();
    vi.unstubAllGlobals();
  });

  it('returns timeout when retrieval never resolves', async () => {
    // Set up chrome mock with knowledge already enabled
    const chromeData: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key?: string | Record<string, unknown>) => {
            if (typeof key === 'object' && key !== null) {
              // getKnowledgeSettings passes a string, not defaults object
              // So this branch handles defaults calls from saveKnowledgeSettings
              return { ...key, ...chromeData };
            }
            // String key — return stored knowledgeSettings
            const result: Record<string, unknown> = {};
            if (chromeData['knowledgeSettings'] !== undefined) {
              result['knowledgeSettings'] = chromeData['knowledgeSettings'];
            }
            return result;
          }),
          set: vi.fn(async (value: Record<string, unknown>) => {
            Object.assign(chromeData, value);
          }),
          remove: vi.fn(),
        },
      },
    });

    // Seed enabled settings into storage BEFORE importing modules
    const DEFAULT_KNOWLEDGE_SETTINGS = (await import('../../src/knowledge/types'))
      .DEFAULT_KNOWLEDGE_SETTINGS;
    chromeData['knowledgeSettings'] = { ...DEFAULT_KNOWLEDGE_SETTINGS, enabled: true };

    // Import after chrome is ready
    const { buildKnowledgeContext } = await import('../../src/knowledge/context-builder');

    // Use real timers with a short timeout
    const start = Date.now();
    const context = await buildKnowledgeContext('test query about cats');
    const elapsed = Date.now() - start;

    expect(context.status).toBe('timeout');
    expect(context.text).toBe('');
    expect(context.sourceCount).toBe(0);
    expect(context.chunkCount).toBe(0);
    // Should have taken at least KNOWLEDGE_TIMEOUT_MS
    expect(elapsed).toBeGreaterThanOrEqual(KNOWLEDGE_TIMEOUT_MS - 100);
  });
});
