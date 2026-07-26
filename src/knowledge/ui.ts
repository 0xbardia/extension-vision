/**
 * Knowledge base Side Panel UI module.
 *
 * Renders and manages the Local Knowledge section in the Side Panel.
 * Orchestrates file selection, import flow, document list rendering,
 * per-document toggles, deletion, and storage usage display.
 *
 * All user-provided values are rendered via textContent — never innerHTML.
 */

import type {
  KnowledgeDocumentRecord,
  KnowledgeImportResult,
  KnowledgeSettings,
  KnowledgeStorageUsage,
} from './types';
import { getKnowledgeSettings, saveKnowledgeSettings } from './settings';
import {
  listDocuments,
  updateDocumentEnabled,
  deleteDocumentCascade,
  getKnowledgeStorageUsage,
} from './repository';
import { importMultipleFiles } from './import';
import { knowledgeErrorMessage } from './errors';
import { processPendingKnowledgeDocuments, getKnowledgeProcessingStatus } from './processing';

// ─── Selectors ──────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// ─── Initialization ─────────────────────────────────────────────────────────

let settings: KnowledgeSettings | null = null;
let documents: KnowledgeDocumentRecord[] | null = null;
let importInProgress = false;

/**
 * Initialize the Local Knowledge panel section.
 * Loads settings and documents, attaches event handlers.
 * Does not block the rest of the side panel on failure.
 */
export async function initializeKnowledgePanel(): Promise<void> {
  try {
    settings = await getKnowledgeSettings();

    // Master toggle
    const masterToggle = $<HTMLInputElement>('knowledgeEnabled');
    masterToggle.checked = settings.enabled;
    masterToggle.addEventListener('change', onMasterToggleChange);

    // Import button
    const importBtn = $<HTMLButtonElement>('knowledgeImportBtn');
    const fileInput = $<HTMLInputElement>('knowledgeFileInput');
    importBtn.addEventListener('click', () => {
      if (importInProgress) return;
      fileInput.click();
    });
    fileInput.addEventListener('change', onFileSelected);

    // Collapsible section toggle
    const toggle = $<HTMLButtonElement>('knowledgeToggle');
    toggle.addEventListener('click', onKnowledgeToggle);
    // Default to expanded for first-time users
    const expanded = true;
    // We don't persist expansion state — always expanded for simplicity

    await loadAndRender();

    // Run backfill processing for existing v1 documents in background
    void initializeKnowledgeProcessing();
  } catch (err) {
    console.warn('[knowledge] Failed to initialize:', knowledgeErrorMessage(err));
    showKnowledgeMessage('Local Knowledge settings could not be loaded.', 'error');
  }
}

// ─── Master Toggle ──────────────────────────────────────────────────────────

async function onMasterToggleChange(): Promise<void> {
  const masterToggle = $<HTMLInputElement>('knowledgeEnabled');
  const enabled = masterToggle.checked;
  try {
    await saveKnowledgeSettings({ enabled });
    settings = await getKnowledgeSettings();
    updateDisabledState(!enabled);
  } catch {
    masterToggle.checked = !enabled; // rollback
    showKnowledgeMessage('Failed to update knowledge settings.', 'error');
  }
}

/**
 * Update the disabled visual state of knowledge controls.
 */
function updateDisabledState(disabled: boolean): void {
  const container = $<HTMLElement>('knowledgeSection');
  container.classList.toggle('knowledge-disabled', disabled);
}

// ─── Collapsible Section ────────────────────────────────────────────────────

let knowledgeExpanded = true;

async function onKnowledgeToggle(): Promise<void> {
  const toggle = $<HTMLButtonElement>('knowledgeToggle');
  const body = $<HTMLElement>('knowledgeBody');
  knowledgeExpanded = !knowledgeExpanded;
  body.hidden = !knowledgeExpanded;
  toggle.setAttribute('aria-expanded', String(knowledgeExpanded));
}

// ─── File Selection ─────────────────────────────────────────────────────────

async function onFileSelected(): Promise<void> {
  const fileInput = $<HTMLInputElement>('knowledgeFileInput');
  const files = fileInput.files;
  if (!files || files.length === 0) return;

  // Clear input so selecting the same file again triggers change
  fileInput.value = '';

  if (importInProgress) return;

  importInProgress = true;
  setKnowledgeImportState(true);

  try {
    settings = await getKnowledgeSettings();
    const usage = await getKnowledgeStorageUsage();
    const currentUsage = {
      documentCount: usage.documentCount,
      estimatedBytes: usage.estimatedBytes,
    };

    const fileArray = Array.from(files);
    const results = await importMultipleFiles(fileArray, settings, currentUsage);

    renderImportSummary(results);
    await loadAndRender();
  } catch (err) {
    showKnowledgeMessage(`Import failed: ${knowledgeErrorMessage(err)}`, 'error');
  } finally {
    importInProgress = false;
    setKnowledgeImportState(false);
  }
}

// ─── Import State ───────────────────────────────────────────────────────────

/**
 * Show or hide the importing state in the UI.
 */
export function setKnowledgeImportState(importing: boolean): void {
  const importBtn = $<HTMLButtonElement>('knowledgeImportBtn');
  const status = $<HTMLElement>('knowledgeStatus');
  importBtn.disabled = importing;
  if (importing) {
    status.textContent = 'Importing files…';
    status.className = 'knowledge-message importing';
  }
}

// ─── Import Summary ─────────────────────────────────────────────────────────

function renderImportSummary(results: KnowledgeImportResult[]): void {
  const imported = results.filter((r) => r.status === 'imported').length;
  const duplicates = results.filter((r) => r.status === 'duplicate').length;
  const rejected = results.filter((r) => r.status === 'rejected').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  const parts: string[] = [];
  if (imported > 0) parts.push(`Imported ${imported} file(s).`);
  if (duplicates > 0) parts.push(`${duplicates} duplicate(s) skipped.`);
  if (rejected > 0) parts.push(`${rejected} rejected.`);
  if (failed > 0) parts.push(`${failed} failed.`);

  let level: 'info' | 'error' = 'info';
  if (failed > 0 || rejected > 0) level = 'error';
  if (imported === 0 && duplicates === 0) level = 'error';

  // Show first rejection/failure detail inline
  const firstDetail = results.find((r) => r.status === 'rejected' || r.status === 'failed');
  let message = parts.join(' ');
  if (firstDetail) {
    message += ` ${firstDetail.fileName}: ${(firstDetail as { reason: string }).reason}`;
  }

  showKnowledgeMessage(message, level);
}

// ─── Load and Render ────────────────────────────────────────────────────────

async function loadAndRender(): Promise<void> {
  try {
    settings = await getKnowledgeSettings();
    documents = await listDocuments();
    const usage = await getKnowledgeStorageUsage();

    // Master toggle
    const masterToggle = $<HTMLInputElement>('knowledgeEnabled');
    masterToggle.checked = settings.enabled;
    updateDisabledState(!settings.enabled);

    renderKnowledgeUsage(usage);
    renderKnowledgeDocuments(documents);
  } catch (err) {
    console.warn('[knowledge] Failed to load:', knowledgeErrorMessage(err));
    showKnowledgeMessage('Failed to load knowledge data.', 'error');
  }
}

// ─── Storage Usage ──────────────────────────────────────────────────────────

/**
 * Render estimated storage usage.
 */
export function renderKnowledgeUsage(usage: KnowledgeStorageUsage): void {
  const usageEl = $<HTMLElement>('knowledgeUsage');
  const docCount = $<HTMLElement>('knowledgeDocCount');

  const usageKB = (usage.estimatedBytes / 1024).toFixed(0);
  const maxKB = '5120'; // 5 MB in KB
  docCount.textContent = `Documents: ${usage.documentCount} / 50`;

  if (usage.estimatedBytes === 0 && usage.documentCount === 0) {
    usageEl.textContent = 'Estimated local usage: 0 KB / 5 MB';
  } else {
    usageEl.textContent = `Estimated local usage: ${usageKB} KB / 5 MB`;
  }
}

// ─── Document List ──────────────────────────────────────────────────────────

/**
 * Render the document list from stored documents.
 */
export function renderKnowledgeDocuments(docs: KnowledgeDocumentRecord[]): void {
  const list = $<HTMLElement>('knowledgeDocList');
  const emptyEl = $<HTMLElement>('knowledgeEmpty');

  if (docs.length === 0) {
    list.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;
  list.innerHTML = '';

  for (const doc of docs) {
    const item = document.createElement('div');
    item.className = 'knowledge-doc-item';
    item.dataset.documentId = doc.id;

    // Document info
    const info = document.createElement('div');
    info.className = 'knowledge-doc-info';

    const nameEl = document.createElement('span');
    nameEl.className = 'knowledge-doc-name';
    nameEl.textContent = doc.fileName;

    const meta = document.createElement('span');
    meta.className = 'knowledge-doc-meta';
    meta.textContent = formatByteSize(doc.byteSize);
    const date = new Date(doc.importedAt);
    meta.textContent += ` · ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

    info.appendChild(nameEl);
    info.appendChild(meta);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'knowledge-doc-actions';

    // Enable toggle
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'knowledge-doc-toggle-label';
    toggleLabel.setAttribute('aria-label', `Toggle ${doc.fileName}`);
    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.className = 'knowledge-doc-toggle';
    toggleInput.checked = doc.enabled;
    toggleInput.setAttribute('aria-label', `Enable "${doc.fileName}"`);
    toggleLabel.appendChild(toggleInput);
    const toggleSpan = document.createElement('span');
    toggleSpan.className = 'toggle-switch';
    toggleLabel.appendChild(toggleSpan);

    toggleInput.addEventListener('change', () => {
      onDocToggle(doc.id, toggleInput.checked, toggleInput);
    });

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'knowledge-doc-delete';
    deleteBtn.setAttribute('aria-label', `Delete "${doc.fileName}"`);
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      onDocDelete(doc.id, doc.fileName, deleteBtn);
    });

    actions.appendChild(toggleLabel);
    actions.appendChild(deleteBtn);

    item.appendChild(info);
    item.appendChild(actions);
    list.appendChild(item);
  }
}

// ─── Per-Document Toggle ────────────────────────────────────────────────────

async function onDocToggle(id: string, checked: boolean, inputEl: HTMLInputElement): Promise<void> {
  try {
    await updateDocumentEnabled(id, checked);
  } catch {
    // Rollback UI on failure
    inputEl.checked = !checked;
    showKnowledgeMessage('Failed to update document.', 'error');
  }
}

// ─── Delete Document ────────────────────────────────────────────────────────

async function onDocDelete(id: string, fileName: string, btnEl: HTMLButtonElement): Promise<void> {
  if (!confirm(`Delete "${fileName}"? This cannot be undone.`)) return;

  btnEl.disabled = true;
  try {
    await deleteDocumentCascade(id);
    await loadAndRender();
  } catch {
    btnEl.disabled = false;
    showKnowledgeMessage(`Failed to delete "${fileName}".`, 'error');
  }
}

// ─── Status Messages ────────────────────────────────────────────────────────

/**
 * Show a status message in the knowledge section.
 * Clears after a timeout.
 */
export function showKnowledgeMessage(
  message: string,
  level: 'info' | 'error' | 'warning' = 'info',
): void {
  const status = $<HTMLElement>('knowledgeStatus');
  status.textContent = message;
  status.className = `knowledge-message ${level}`;
  status.setAttribute('role', level === 'error' ? 'alert' : 'status');
  status.setAttribute('aria-live', 'polite');

  // Auto-clear after 8 seconds for info, keep errors visible
  if (level === 'info') {
    setTimeout(() => {
      status.textContent = '';
      status.className = 'knowledge-message';
    }, 8000);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ─── Processing Initialization ──────────────────────────────────────────────

/**
 * Initialize knowledge document processing.
 * Runs backfill for existing v1 documents and shows status.
 * Does not block the Side Panel.
 */
export async function initializeKnowledgeProcessing(): Promise<void> {
  try {
    const statusEl = $<HTMLElement>('knowledgeProcessingStatus');
    const procStatus = await getKnowledgeProcessingStatus();

    if (procStatus.pendingDocuments === 0 && procStatus.currentDocuments > 0) {
      // All documents already processed
      statusEl.textContent = 'Local documents ready';
      statusEl.className = 'knowledge-processing-status ready';
      statusEl.hidden = false;
      setTimeout(() => {
        statusEl.hidden = true;
      }, 5000);
      return;
    }

    if (procStatus.pendingDocuments === 0 && procStatus.totalDocuments === 0) {
      return; // No documents at all
    }

    // Show processing state
    statusEl.textContent = 'Processing local documents…';
    statusEl.className = 'knowledge-processing-status processing';
    statusEl.hidden = false;

    const results = await processPendingKnowledgeDocuments();
    const processed = results.filter((r) => r.status === 'processed').length;
    const failed = results.filter((r) => r.status === 'failed').length;

    if (failed > 0) {
      statusEl.textContent = `${processed} document(s) processed, ${failed} failed.`;
      statusEl.className = 'knowledge-processing-status error';
    } else if (processed > 0) {
      statusEl.textContent = `${processed} document(s) processed. Local documents ready.`;
      statusEl.className = 'knowledge-processing-status ready';
    } else {
      statusEl.textContent = 'Local documents ready';
      statusEl.className = 'knowledge-processing-status ready';
    }

    // Auto-hide ready state after a delay
    setTimeout(() => {
      statusEl.hidden = true;
    }, 6000);

    // Refresh document list and usage after processing
    await loadAndRender();
  } catch {
    // Processing failure should not break the panel
    console.warn('[knowledge] Backfill processing encountered an issue.');
  }
}
