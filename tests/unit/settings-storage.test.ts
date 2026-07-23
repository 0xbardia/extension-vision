import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSettings, saveSettings } from '../../src/storage/settings.storage';
describe('settings persistence', () => {
  const data: Record<string, unknown> = {};
  beforeEach(() => {
    for (const key of Object.keys(data)) delete data[key];
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (defaults) => ({ ...defaults, ...data })),
          set: vi.fn(async (value) => Object.assign(data, value)),
        },
      },
    });
  });
  it('persists the real provider key and preserves the other key', async () => {
    await saveSettings({
      provider: 'openrouter',
      openRouterApiKey: 'or-real',
      openAiApiKey: 'ai-real',
    });
    const result = await getSettings();
    expect(result.openRouterApiKey).toBe('or-real');
    expect(result.openAiApiKey).toBe('ai-real');
  });
  it('migrates fake masked bullets to empty', async () => {
    data.openRouterApiKey = '••••••••';
    expect((await getSettings()).openRouterApiKey).toBe('');
  });
});
