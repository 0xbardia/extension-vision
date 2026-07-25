import type { KnowledgeSettings } from './types';
import { DEFAULT_KNOWLEDGE_SETTINGS } from './types';
import { KnowledgeError } from './errors';

const STORAGE_KEY = 'knowledgeSettings';

/**
 * Read knowledge settings from chrome.storage.local.
 * Returns defaults when the key is missing, corrupted, or from a future schema version.
 */
export async function getKnowledgeSettings(): Promise<KnowledgeSettings> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  const stored = raw[STORAGE_KEY];

  // Missing → defaults
  if (stored === undefined || stored === null) {
    return { ...DEFAULT_KNOWLEDGE_SETTINGS };
  }

  // Not a plain object → safe defaults
  if (typeof stored !== 'object' || Array.isArray(stored)) {
    console.warn('[knowledge] Settings are not a valid object, using defaults.');
    return { ...DEFAULT_KNOWLEDGE_SETTINGS };
  }

  // Future schema version → fail safely
  const schemaVersion = (stored as Record<string, unknown>).schemaVersion;
  if (
    typeof schemaVersion === 'number' &&
    schemaVersion > DEFAULT_KNOWLEDGE_SETTINGS.schemaVersion
  ) {
    throw new KnowledgeError(
      'KNOWLEDGE_SETTINGS_CORRUPTED',
      'Knowledge settings were created by a newer version of the extension.',
      'Schema version mismatch',
    );
  }

  return {
    ...DEFAULT_KNOWLEDGE_SETTINGS,
    ...(stored as Partial<KnowledgeSettings>),
    schemaVersion: DEFAULT_KNOWLEDGE_SETTINGS.schemaVersion,
  };
}

/**
 * Save partial knowledge settings. Unspecified fields are preserved from
 * the current stored state.
 */
export async function saveKnowledgeSettings(partial: Partial<KnowledgeSettings>): Promise<void> {
  const current = await getKnowledgeSettings();
  const merged = { ...current, ...partial };

  // Always pin to the current schema version
  merged.schemaVersion = DEFAULT_KNOWLEDGE_SETTINGS.schemaVersion;

  await chrome.storage.local.set({ [STORAGE_KEY]: merged });
}

/**
 * Reset knowledge settings to defaults.
 */
export async function resetKnowledgeSettings(): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY]: { ...DEFAULT_KNOWLEDGE_SETTINGS },
  });
}
