export function isKnownProtectedUrl(url?: string, extensionId?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol === 'chrome:' ||
      parsed.protocol === 'edge:' ||
      parsed.protocol === 'about:' ||
      parsed.protocol === 'devtools:'
    )
      return true;
    if (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'chrome.google.com' &&
      parsed.pathname.startsWith('/webstore')
    )
      return true;
    if (parsed.protocol === 'https:' && parsed.hostname === 'chromewebstore.google.com')
      return true;
    return parsed.protocol === 'chrome-extension:' && parsed.hostname === extensionId;
  } catch {
    return false;
  }
}

export async function resolveTargetTab(preferredTab?: chrome.tabs.Tab): Promise<chrome.tabs.Tab> {
  if (preferredTab?.id != null && preferredTab.windowId != null) return preferredTab;
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs[0];
  if (tab?.id == null || tab.windowId == null)
    throw new Error('No active tab with a usable window');
  return tab;
}

export function tabProtocol(url?: string): string {
  try {
    return url ? new URL(url).protocol : 'unknown';
  } catch {
    return 'unknown';
  }
}
