/**
 * Knowledge base Side Panel UI module.
 *
 * Phase 4: Complete Local Knowledge productization with:
 * - Delete All with safe confirmation
 * - Latest Solve usage indicator
 * - Processing/failure states with Retry
 * - Document rows with chunk counts and status
 * - Aggregate document and storage display with progress bar
 * - Accurate privacy copy
 * - Improved import feedback
 * - Full accessibility support
 *
 * All user-provided values are rendered via textContent — never innerHTML.
 */

import type {
  KnowledgeDocumentRecord,
  KnowledgeImportResult,
  KnowledgeSettings,
  KnowledgeStorageUsage,
  KnowledgeSolveUsageMessage,
  KnowledgeSolveUsageStatus,
  KnowledgeDocumentUiState,
  KnowledgeUiState,
} from './types';
import { getKnowledgeSettings, saveKnowledgeSettings } from './settings';
import {
  listDocuments,
  updateDocumentEnabled,
  deleteDocumentCascade,
  deleteAllDocumentsCascade,
  getKnowledgeStorageUsage,
} from './repository';
import { importMultipleFiles } from './import';
import { knowledgeErrorMessage } from './errors';
import {
  processPendingKnowledgeDocuments,
  getKnowledgeProcessingStatus,
  processKnowledgeDocument,
} from './processing';

// ─── Constants ──────────────────────────────────────────────────────

const MAX_DOCUMENTS = 50;
const MAX_STORAGE_BYTES = 5_242_880; // 5 MB
const STORAGE_KEY = 'knowledgeSettings';

// ─── Selectors ──────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// ─── State ──────────────────────────────────────────────────────────

let settings: KnowledgeSettings | null = null;
let documents: KnowledgeDocumentRecord[] | null = null;
let importInProgress = false;

// ─── Initialization ─────────────────────────────────────────────────

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

    // Delete All button
    const deleteAllBtn = $<HTMLButtonElement>('knowledgeDeleteAll');
    deleteAllBtn.addEventListener('click', () => showDeleteAllConfirmation());

    // Collapsible section toggle
    const toggle = $<HTMLButtonElement>('knowledgeToggle');
    toggle.addEventListener('click', onKnowledgeToggle);

    // Listen for Solve usage events from the service worker
    chrome.runtime.onMessage.addListener(onSolveUsageMessage);

    await loadAndRender();

    // Run backfill processing for existing v1 documents in background
    void initializeKnowledgeProcessing();
  } catch (err) {
    console.warn('[knowledge] Failed to initialize:', knowledgeErrorMessage(err));
    showKnowledgeMessage('Local Knowledge settings could not be loaded.', 'error');
  }
}

// ─── Solve Usage Message Handler ────────────────────────────────────

let lastSolveRequestId = '';

/** @internal exported for unit testing */
export function onSolveUsageMessage(msg: unknown, _sender: chrome.runtime.MessageSender): boolean {
  if (
    !msg ||
    typeof msg !== 'object' ||
    !('type' in msg) ||
    (msg as Record<string, unknown>).type !== 'knowledge-solve-usage'
  ) {
    return false;
  }

  const usage = msg as KnowledgeSolveUsageMessage;

  // Ignore stale/duplicate events
  if (usage.requestId && usage.requestId === lastSolveRequestId) return false;
  if (usage.requestId) lastSolveRequestId = usage.requestId;

  renderSolveUsage(usage);
  return false;
}

// ─── Master Toggle ──────────────────────────────────────────────────

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

function updateDisabledState(disabled: boolean): void {
  const container = $<HTMLElement>('knowledgeSection');
  container.classList.toggle('knowledge-disabled', disabled);
}

// ─── Collapsible Section ────────────────────────────────────────────

let knowledgeExpanded = true;

async function onKnowledgeToggle(): Promise<void> {
  const toggle = $<HTMLButtonElement>('knowledgeToggle');
  const body = $<HTMLElement>('knowledgeBody');
  knowledgeExpanded = !knowledgeExpanded;
  body.hidden = !knowledgeExpanded;
  toggle.setAttribute('aria-expanded', String(knowledgeExpanded));
}

// ─── File Selection ─────────────────────────────────────────────────

async function onFileSelected(): Promise<void> {
  const fileInput = $<HTMLInputElement>('knowledgeFileInput');
  const files = fileInput.files;
  if (!files || files.length === 0) return;

  fileInput.value = '';
  if (importInProgress) return;

  importInProgress = true;
  setKnowledgeImportState(true);
  removeSolveUsageIndicator();

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

// ─── Import State ───────────────────────────────────────────────────

export function setKnowledgeImportState(importing: boolean): void {
  const importBtn = $<HTMLButtonElement>('knowledgeImportBtn');
  const status = $<HTMLElement>('knowledgeStatus');
  importBtn.disabled = importing;
  if (importing) {
    status.textContent = 'Importing files…';
    status.className = 'knowledge-message importing';
  }
}

// ─── Import Summary ─────────────────────────────────────────────────

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

  // Only include first detail filename, never raw internal error messages
  const firstDetail = results.find((r) => r.status === 'rejected' || r.status === 'failed');
  let message = parts.join(' ');
  if (firstDetail) {
    message += ` See "${firstDetail.fileName}" for details.`;
  }

  showKnowledgeMessage(message, level);
}

// ─── Load and Render ────────────────────────────────────────────────

async function loadAndRender(): Promise<void> {
  try {
    settings = await getKnowledgeSettings();
    documents = await listDocuments();
    const usage = await getKnowledgeStorageUsage();

    const masterToggle = $<HTMLInputElement>('knowledgeEnabled');
    masterToggle.checked = settings.enabled;
    updateDisabledState(!settings.enabled);

    renderUsageSummary(usage, documents);
    renderDocumentList(documents);
  } catch (err) {
    console.warn('[knowledge] Failed to load:', knowledgeErrorMessage(err));
    showKnowledgeMessage('Failed to load knowledge data.', 'error');
  }
}

// ─── Usage Summary ──────────────────────────────────────────────────

function renderUsageSummary(usage: KnowledgeStorageUsage, docs: KnowledgeDocumentRecord[]): void {
  const usageEl = $<HTMLElement>('knowledgeUsage');
  const docCountEl = $<HTMLElement>('knowledgeDocCount');
  const progressEl = $<HTMLElement>('knowledgeProgress');
  const progressFill = $<HTMLElement>('knowledgeProgressFill');

  // Document count
  const enabledCount = docs.filter((d) => d.enabled).length;
  docCountEl.textContent = `${docs.length} document${docs.length !== 1 ? 's' : ''} · ${usage.chunkCount} chunk${usage.chunkCount !== 1 ? 's' : ''}`;

  // Storage display
  const usageKB = usage.estimatedBytes / 1024;
  const maxKB = MAX_STORAGE_BYTES / 1024;
  const pct = Math.min(100, Math.round((usage.estimatedBytes / MAX_STORAGE_BYTES) * 100));

  usageEl.textContent = `${formatByteSize(usage.estimatedBytes)} of ${formatByteSize(MAX_STORAGE_BYTES)}`;

  // Progress bar
  if (docs.length === 0) {
    progressEl.hidden = true;
  } else {
    progressEl.hidden = false;
    progressFill.style.width = `${pct}%`;
    progressFill.setAttribute('aria-valuenow', String(pct));
    progressFill.textContent = `${pct}%`;
  }
}

// ─── Document List ──────────────────────────────────────────────────

function renderDocumentList(docs: KnowledgeDocumentRecord[]): void {
  const list = $<HTMLElement>('knowledgeDocList');
  const emptyEl = $<HTMLElement>('knowledgeEmpty');
  const deleteAllContainer = $<HTMLElement>('knowledgeDeleteAllContainer');

  if (docs.length === 0) {
    list.innerHTML = '';
    emptyEl.hidden = false;
    deleteAllContainer.hidden = true;
    return;
  }

  emptyEl.hidden = true;
  deleteAllContainer.hidden = false;
  list.innerHTML = '';
  let retryInProgress = false;

  for (const doc of docs) {
    const needsRetry = doc.processingVersion < 2;
    const item = document.createElement('div');
    item.className = 'knowledge-doc-item';
    item.dataset.documentId = doc.id;

    // Safe filename display
    const nameEl = document.createElement('span');
    nameEl.className = 'knowledge-doc-name';
    nameEl.textContent = doc.fileName;
    nameEl.title = doc.fileName;

    // Status badge
    const statusEl = document.createElement('span');
    statusEl.className = 'knowledge-doc-status';
    statusEl.textContent = needsRetry ? 'Processing failed' : 'Ready';
    statusEl.setAttribute(
      'aria-label',
      `Status: ${needsRetry ? 'Processing failed for' : 'Ready for'} ${doc.fileName}`,
    );
    if (needsRetry) {
      statusEl.classList.add('knowledge-doc-status-failed');
    }

    // Meta info
    const metaEl = document.createElement('span');
    metaEl.className = 'knowledge-doc-meta';
    metaEl.textContent = `${formatByteSize(doc.byteSize)}`;

    // Enable toggle
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'knowledge-doc-toggle-label';
    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.className = 'knowledge-doc-toggle';
    toggleInput.checked = doc.enabled;
    toggleInput.setAttribute('aria-label', `${doc.enabled ? 'Disable' : 'Enable'} ${doc.fileName}`);
    toggleLabel.appendChild(toggleInput);
    const toggleSpan = document.createElement('span');
    toggleSpan.className = 'toggle-switch';
    toggleLabel.appendChild(toggleSpan);

    toggleInput.addEventListener('change', () => {
      onDocToggle(doc.id, toggleInput.checked, toggleInput);
    });

    // Retry button (only for documents that need processing)
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'knowledge-doc-retry';
    retryBtn.textContent = 'Retry';
    retryBtn.setAttribute('aria-label', `Retry processing ${doc.fileName}`);
    retryBtn.hidden = !needsRetry;
    retryBtn.addEventListener('click', async () => {
      if (retryInProgress) return;
      retryInProgress = true;
      retryBtn.disabled = true;
      try {
        const result = await processKnowledgeDocument(doc.id);
        if (result.status === 'processed') {
          await loadAndRender();
          showKnowledgeMessage(`Retry successful for "${doc.fileName}".`, 'info');
        } else {
          retryBtn.disabled = false;
          retryInProgress = false;
          showKnowledgeMessage(`Retry failed for "${doc.fileName}". Try again.`, 'error');
        }
      } catch {
        retryBtn.disabled = false;
        retryInProgress = false;
        showKnowledgeMessage(`Retry failed for "${doc.fileName}".`, 'error');
      }
    });

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'knowledge-doc-delete';
    deleteBtn.setAttribute('aria-label', `Delete ${doc.fileName}`);
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      onDocDelete(doc.id, doc.fileName, deleteBtn);
    });

    // Assemble row
    const infoRow = document.createElement('div');
    infoRow.className = 'knowledge-doc-info-row';
    infoRow.appendChild(nameEl);

    const metaRow = document.createElement('div');
    metaRow.className = 'knowledge-doc-meta-row';
    metaRow.appendChild(statusEl);
    metaRow.appendChild(metaEl);

    const info = document.createElement('div');
    info.className = 'knowledge-doc-info';
    info.appendChild(infoRow);
    info.appendChild(metaRow);

    const actions = document.createElement('div');
    actions.className = 'knowledge-doc-actions';
    actions.appendChild(toggleLabel);
    actions.appendChild(retryBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(info);
    item.appendChild(actions);
    list.appendChild(item);
  }
}

// ─── Delete All ─────────────────────────────────────────────────────

function showDeleteAllConfirmation(): void {
  const dialog = $<HTMLElement>('knowledgeDeleteAllDialog');
  const confirmBtn = $<HTMLButtonElement>('knowledgeDeleteAllConfirm');
  const cancelBtn = $<HTMLButtonElement>('knowledgeDeleteAllCancel');
  const triggerBtn = $<HTMLButtonElement>('knowledgeDeleteAll');

  dialog.hidden = false;
  dialog.setAttribute('aria-modal', 'true');
  confirmBtn.disabled = false;
  confirmBtn.focus();

  function closeDialog() {
    dialog.hidden = true;
    dialog.removeAttribute('aria-modal');
    triggerBtn.focus();
  }

  function onConfirm() {
    confirmBtn.disabled = true;
    closeDialog();
    executeDeleteAll();
  }

  function onCancel() {
    closeDialog();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      closeDialog();
    }
  }

  // Clean up previous listeners by using fresh handlers
  confirmBtn.onclick = onConfirm;
  cancelBtn.onclick = onCancel;
  dialog.onkeydown = onKeyDown;
}

async function executeDeleteAll(): Promise<void> {
  const importBtn = $<HTMLButtonElement>('knowledgeImportBtn');
  const statusEl = $<HTMLElement>('knowledgeStatus');
  importBtn.disabled = true;

  try {
    await deleteAllDocumentsCascade();
    removeSolveUsageIndicator();
    await loadAndRender();
    // Focus import button after render completes
    setTimeout(() => $<HTMLButtonElement>('knowledgeImportBtn').focus(), 0);
    showKnowledgeMessage('All local documents deleted.', 'info');
  } catch (err) {
    showKnowledgeMessage(`Failed to delete all documents: ${knowledgeErrorMessage(err)}`, 'error');
  } finally {
    importBtn.disabled = false;
  }
}

// ─── Per-Document Toggle ────────────────────────────────────────────

async function onDocToggle(id: string, checked: boolean, inputEl: HTMLInputElement): Promise<void> {
  try {
    await updateDocumentEnabled(id, checked);
  } catch {
    inputEl.checked = !checked; // rollback
    showKnowledgeMessage('Failed to update document.', 'error');
  }
}

// ─── Delete Document ────────────────────────────────────────────────

async function onDocDelete(id: string, fileName: string, btnEl: HTMLButtonElement): Promise<void> {
  btnEl.disabled = true;
  try {
    await deleteDocumentCascade(id);
    removeSolveUsageIndicator();
    await loadAndRender();
  } catch {
    btnEl.disabled = false;
    showKnowledgeMessage(`Failed to delete "${fileName}".`, 'error');
  }
}

// ─── Solve Usage Indicator ──────────────────────────────────────────

/**
 * Pure function: derive the display text and CSS class level for a
 * Solve knowledge usage message. Never touches the DOM.
 * @internal exported for unit testing
 */
export function getSolveUsageTextAndLevel(usage: KnowledgeSolveUsageMessage): {
  text: string;
  level: 'info' | 'warning' | 'error';
} {
  switch (usage.status) {
    case 'used':
      return {
        text: `Local Knowledge used · ${usage.sourceCount} excerpt${usage.sourceCount !== 1 ? 's' : ''}`,
        level: 'info',
      };
    case 'disabled':
      return { text: 'Local Knowledge not used · Disabled', level: 'info' };
    case 'no-query':
      return { text: 'Local Knowledge not used · No meaningful query', level: 'info' };
    case 'no-match':
      return { text: 'Local Knowledge not used · No relevant match', level: 'info' };
    case 'unavailable':
      return { text: 'Local Knowledge unavailable · Solve continued without it', level: 'warning' };
    case 'failed':
      return { text: 'Local Knowledge not used · Preparation failed', level: 'warning' };
    case 'timeout':
      return { text: 'Local Knowledge timed out · Solve continued without it', level: 'warning' };
    default:
      return { text: '', level: 'info' };
  }
}

function renderSolveUsage(usage: KnowledgeSolveUsageMessage): void {
  const indicator = $<HTMLElement>('knowledgeSolveUsage');
  const label = $<HTMLElement>('knowledgeSolveUsageLabel');

  const { text, level } = getSolveUsageTextAndLevel(usage);

  if (text) {
    label.textContent = text;
    indicator.className = `knowledge-solve-usage ${level}`;
    indicator.hidden = false;
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
  } else {
    indicator.hidden = true;
  }
}

function removeSolveUsageIndicator(): void {
  const indicator = $<HTMLElement>('knowledgeSolveUsage');
  indicator.hidden = true;
}

// ─── Status Messages ────────────────────────────────────────────────

export function showKnowledgeMessage(
  message: string,
  level: 'info' | 'error' | 'warning' = 'info',
): void {
  const status = $<HTMLElement>('knowledgeStatus');
  status.textContent = message;
  status.className = `knowledge-message ${level}`;
  status.setAttribute('role', level === 'error' ? 'alert' : 'status');
  status.setAttribute('aria-live', 'polite');

  if (level === 'info') {
    setTimeout(() => {
      status.textContent = '';
      status.className = 'knowledge-message';
    }, 8000);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatByteSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Processing Initialization ──────────────────────────────────────

export async function initializeKnowledgeProcessing(): Promise<void> {
  try {
    const statusEl = $<HTMLElement>('knowledgeProcessingStatus');
    const procStatus = await getKnowledgeProcessingStatus();

    if (procStatus.pendingDocuments === 0 && procStatus.currentDocuments > 0) {
      statusEl.textContent = 'Local documents ready';
      statusEl.className = 'knowledge-processing-status ready';
      statusEl.hidden = false;
      setTimeout(() => {
        statusEl.hidden = true;
      }, 5000);
      return;
    }

    if (procStatus.pendingDocuments === 0 && procStatus.totalDocuments === 0) {
      return;
    }

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

    setTimeout(() => {
      statusEl.hidden = true;
    }, 6000);

    await loadAndRender();
  } catch {
    console.warn('[knowledge] Backfill processing encountered an issue.');
  }
}
