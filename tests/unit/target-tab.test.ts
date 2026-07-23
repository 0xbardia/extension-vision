import { describe, expect, it, vi } from 'vitest';
import { isKnownProtectedUrl, resolveTargetTab } from '../../src/background/target-tab';
describe('target tabs', () => {
  it.each(['https://example.com', 'http://example.com'])('allows %s', (url) =>
    expect(isKnownProtectedUrl(url)).toBe(false),
  );
  it.each([
    'chrome://extensions',
    'chrome://newtab',
    'edge://settings',
    'about:blank',
    'devtools://devtools',
    'https://chrome.google.com/webstore/detail/x',
    'https://chromewebstore.google.com/',
  ])('blocks %s', (url) => expect(isKnownProtectedUrl(url)).toBe(true));
  it('allows missing URL and PDF-like extension URLs', () => {
    expect(isKnownProtectedUrl()).toBe(false);
    expect(isKnownProtectedUrl('chrome-extension://pdf-viewer/internal.html', 'other-id')).toBe(
      false,
    );
  });
  it('prefers the command tab', async () => {
    const preferred = { id: 7, windowId: 3 } as chrome.tabs.Tab;
    vi.stubGlobal('chrome', { tabs: { query: vi.fn() } });
    await expect(resolveTargetTab(preferred)).resolves.toBe(preferred);
  });
  it('falls back to the active tab', async () => {
    const active = { id: 8, windowId: 4 } as chrome.tabs.Tab;
    vi.stubGlobal('chrome', { tabs: { query: vi.fn().mockResolvedValue([active]) } });
    await expect(resolveTargetTab()).resolves.toBe(active);
  });
});
