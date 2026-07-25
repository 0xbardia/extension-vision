import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  getKnowledgeSettings,
  saveKnowledgeSettings,
  resetKnowledgeSettings,
} from '../../src/knowledge/settings';
import { DEFAULT_KNOWLEDGE_SETTINGS } from '../../src/knowledge/types';
import { KnowledgeError } from '../../src/knowledge/errors';

const STORAGE_KEY = 'knowledgeSettings';

describe('knowledge settings', () => {
  const data: Record<string, unknown> = {};

  beforeEach(() => {
    for (const key of Object.keys(data)) delete data[key];
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (defaults?: Record<string, unknown>) => {
            if (defaults && typeof defaults === 'object') {
              // Simulate chrome.storage.local.get with defaults
              const result = { ...defaults };
              // But override with whatever is in our fake store
              return { ...result, ...data };
            }
            // If specific keys are requested
            const result: Record<string, unknown> = {};
            if (data[STORAGE_KEY] !== undefined) {
              result[STORAGE_KEY] = data[STORAGE_KEY];
            }
            return result;
          }),
          set: vi.fn(async (value: Record<string, unknown>) => {
            Object.assign(data, value);
          }),
          remove: vi.fn(),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns defaults when settings key is missing', async () => {
    const settings = await getKnowledgeSettings();
    expect(settings).toEqual(DEFAULT_KNOWLEDGE_SETTINGS);
  });

  it('returns defaults when settings object is null', async () => {
    data[STORAGE_KEY] = null;
    const settings = await getKnowledgeSettings();
    expect(settings).toEqual(DEFAULT_KNOWLEDGE_SETTINGS);
  });

  it('returns defaults when settings is an array', async () => {
    data[STORAGE_KEY] = [];
    const settings = await getKnowledgeSettings();
    expect(settings).toEqual(DEFAULT_KNOWLEDGE_SETTINGS);
  });

  it('merges partial stored settings with defaults', async () => {
    data[STORAGE_KEY] = { enabled: true, maximumDocumentCount: 10 };
    const settings = await getKnowledgeSettings();
    expect(settings.enabled).toBe(true);
    expect(settings.maximumDocumentCount).toBe(10);
    // Other fields should remain at defaults
    expect(settings.maximumFileSizeBytes).toBe(DEFAULT_KNOWLEDGE_SETTINGS.maximumFileSizeBytes);
    expect(settings.maximumRetrievedChunks).toBe(DEFAULT_KNOWLEDGE_SETTINGS.maximumRetrievedChunks);
    expect(settings.schemaVersion).toBe(1);
  });

  it('throws when stored schema version is newer than current', async () => {
    data[STORAGE_KEY] = { schemaVersion: 99 };
    await expect(getKnowledgeSettings()).rejects.toThrow(KnowledgeError);
  });

  it('saves partial settings without losing existing values', async () => {
    data[STORAGE_KEY] = { enabled: true, maximumDocumentCount: 25 };

    await saveKnowledgeSettings({ maximumRetrievedChunks: 3 });

    const settings = await getKnowledgeSettings();
    expect(settings.enabled).toBe(true); // preserved
    expect(settings.maximumDocumentCount).toBe(25); // preserved
    expect(settings.maximumRetrievedChunks).toBe(3); // updated
    expect(settings.schemaVersion).toBe(1);
  });

  it('resets settings to defaults', async () => {
    data[STORAGE_KEY] = { enabled: true, maximumDocumentCount: 100 };

    await resetKnowledgeSettings();

    const settings = await getKnowledgeSettings();
    expect(settings).toEqual(DEFAULT_KNOWLEDGE_SETTINGS);
  });

  it('defaults to disabled', async () => {
    const settings = await getKnowledgeSettings();
    expect(settings.enabled).toBe(false);
  });

  it('always pins schemaVersion to current', async () => {
    data[STORAGE_KEY] = { schemaVersion: 1, enabled: true };

    await saveKnowledgeSettings({ schemaVersion: 99 });
    const settings = await getKnowledgeSettings();
    expect(settings.schemaVersion).toBe(1);
  });

  it('does not affect existing chrome.storage.local keys', async () => {
    data['someOtherKey'] = 'original-value';

    await saveKnowledgeSettings({ enabled: true });

    // chrome.storage.local.set was called with the knowledgeSettings key
    const setCall = vi.mocked(chrome.storage.local.set);
    const setArg = setCall.mock.calls[setCall.mock.calls.length - 1][0];
    expect(setArg).toHaveProperty(STORAGE_KEY);
  });
});
