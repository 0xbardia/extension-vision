/**
 * Knowledge base file import module.
 *
 * Responsibilities:
 * - Validate selected files (extension, MIME, size, name, content)
 * - Strict UTF-8 decode via TextDecoder('utf-8', { fatal: true })
 * - Normalize decoded text (BOM removal, line endings, NFC)
 * - Detect suspicious Unicode (bidi overrides, null bytes, controls)
 * - Compute SHA-256 content hash via Web Crypto
 * - Detect duplicate content via repository
 * - Enforce document count and storage limits
 * - Build valid KnowledgeDocumentRecord for persistence
 *
 * The side panel orchestrates UI events; this module owns
 * validation, decoding, normalization, hashing, and record construction.
 */

import type { KnowledgeDocumentRecord, KnowledgeImportResult, KnowledgeSettings } from './types';
import { KNOWLEDGE_PROCESSING_VERSION } from './types';
import { KnowledgeError } from './errors';
import { findDocumentByContentHash, createDocumentWithChunks } from './repository';
import { chunkDocument } from './chunking';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Maximum allowed filename length in Unicode code points */
const MAX_FILENAME_LENGTH = 200;

/** Threshold for suspicious bidi override characters before rejection */
const MAX_BIDI_OVERRIDE_COUNT = 5;

// ─── Extension validation ───────────────────────────────────────────────────

/**
 * Validate that a filename ends with `.txt` (case-insensitive).
 */
export function isTxtExtension(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.txt');
}

/**
 * Validate that the MIME type is compatible.
 * We accept text/plain and empty/unset MIME type when the extension is .txt.
 * Reject clearly incompatible non-empty MIME types.
 */
export function isAllowedMimeType(mime: string): boolean {
  if (!mime) return true; // empty/unset — rely on extension
  if (mime === 'text/plain') return true;
  return false;
}

// ─── File size validation ──────────────────────────────────────────────────

/**
 * Check that file.size does not exceed the configured maximum.
 */
export function isFileSizeAllowed(size: number, maxBytes: number): boolean {
  return size > 0 && size <= maxBytes;
}

// ─── Filename validation ───────────────────────────────────────────────────

/**
 * Validate that a filename is safe and within limits.
 */
export function isValidFileName(fileName: string): boolean {
  return fileName.length > 0 && fileName.length <= MAX_FILENAME_LENGTH;
}

// ─── UTF-8 Strict Decoding ─────────────────────────────────────────────────

/**
 * Decode an ArrayBuffer as strict UTF-8.
 * Throws KNOWLEDGE_INVALID_UTF8 if the byte sequence is malformed.
 */
export function decodeUtf8File(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new KnowledgeError(
      'KNOWLEDGE_INVALID_UTF8',
      'This file is not valid UTF-8 text. Convert it to UTF-8 and try again.',
    );
  }
}

// ─── Text Normalization ─────────────────────────────────────────────────────

/**
 * Normalize imported text deterministically.
 *
 * Pipeline:
 * 1. Strip leading BOM (U+FEFF)
 * 2. Normalize line endings: CRLF → LF, CR → LF
 * 3. Unicode NFC normalization
 * 4. Replace non-text C0 controls (preserve tab, LF)
 * 5. Strip C1 controls
 * 6. Trim trailing whitespace per line, trim document edges
 * 7. Reject if empty afterward
 */
export function normalizeImportedText(raw: string): string {
  // 1. Strip leading BOM
  let text = raw;
  if (text.length > 0 && text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  // 2. Normalize line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 3. NFC normalization
  text = text.normalize('NFC');

  // 4. Replace C0 controls except tab, LF
  // U+0000 null → reject explicitly handled elsewhere via detectSuspiciousUnicode
  // U+0001–U+0008, U+000B, U+000C, U+000E–U+001F → replace with space
  text = text.replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, ' ');

  // 5. Strip C1 control characters (U+0080–U+009F) — not meaningful in text
  text = text.replace(/[\u0080-\u009f]/g, '');

  // 6. Trim trailing whitespace on each line
  text = text.replace(/[ \t]+$/gm, '');

  // 7. Trim leading/trailing blank space around the complete document
  text = text.trim();

  return text;
}

// ─── Suspicious Unicode Detection ──────────────────────────────────────────

/**
 * Detect null bytes in text.
 */
export function containsNullByte(text: string): boolean {
  return text.includes('\u0000');
}

/**
 * Count bidirectional override characters that could be used for
 * spoofing or confusing text ordering in a malicious file.
 *
 * Counted characters:
 *   U+202A LRE
 *   U+202B RLE
 *   U+202C PDF
 *   U+202D LRO
 *   U+202E RLO
 *   U+2066 LRI
 *   U+2067 RLI
 *   U+2068 FSI
 *   U+2069 PDI
 */
export function countBidiOverrides(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    if (
      cp === 0x202a || // LRE
      cp === 0x202b || // RLE
      cp === 0x202c || // PDF
      cp === 0x202d || // LRO
      cp === 0x202e || // RLO
      cp === 0x2066 || // LRI
      cp === 0x2067 || // RLI
      cp === 0x2068 || // FSI
      cp === 0x2069 // PDI
    ) {
      count++;
    }
  }
  return count;
}

/**
 * Detect high-risk or suspicious unicode content.
 *
 * Returns a list of warning strings (empty = no issues).
 */
export function detectSuspiciousUnicode(text: string): { warnings: string[]; rejected: boolean } {
  const warnings: string[] = [];

  // Null byte → always reject
  if (containsNullByte(text)) {
    return {
      warnings: ['File contains null bytes and cannot be imported.'],
      rejected: true,
    };
  }

  // Bidi override count
  const bidiCount = countBidiOverrides(text);
  if (bidiCount > MAX_BIDI_OVERRIDE_COUNT) {
    return {
      warnings: [
        `File contains ${bidiCount} bidirectional override characters, which exceeds the safe limit.`,
      ],
      rejected: true,
    };
  }
  if (bidiCount > 0) {
    warnings.push(
      `File contains ${bidiCount} bidirectional override character(s). The content should be reviewed.`,
    );
  }

  return { warnings, rejected: false };
}

// ─── Content Hashing ────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hex digest of text using native Web Crypto.
 */
export async function hashKnowledgeContent(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── Document Record Construction ───────────────────────────────────────────

/**
 * Build a valid KnowledgeDocumentRecord for a successfully imported file.
 */
export function buildKnowledgeDocumentRecord(
  fileName: string,
  normalizedContent: string,
  contentHash: string,
  byteSize: number,
): KnowledgeDocumentRecord {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    fileName,
    mimeType: 'text/plain',
    byteSize,
    characterCount: normalizedContent.length,
    importedAt: now,
    updatedAt: now,
    enabled: true,
    contentHash,
    processingVersion: KNOWLEDGE_PROCESSING_VERSION,
    content: normalizedContent,
  };
}

// ─── Main Import Orchestration ──────────────────────────────────────────────

/**
 * Validate a selected File against all gates before reading its contents.
 * Throws KnowledgeError on validation failure.
 */
export function validateSelectedFile(file: File, settings: KnowledgeSettings): void {
  // Extension
  if (!isTxtExtension(file.name)) {
    throw new KnowledgeError(
      'KNOWLEDGE_UNSUPPORTED_EXTENSION',
      `"${file.name}" is not a .txt file. Only .txt files are supported.`,
    );
  }

  // MIME type
  if (!isAllowedMimeType(file.type)) {
    throw new KnowledgeError(
      'KNOWLEDGE_UNSUPPORTED_MIME',
      `"${file.name}" has an unsupported file type (${file.type}). Only text/plain is supported.`,
    );
  }

  // File size
  if (!isFileSizeAllowed(file.size, settings.maximumFileSizeBytes)) {
    if (file.size === 0) {
      throw new KnowledgeError('KNOWLEDGE_EMPTY_DOCUMENT', `"${file.name}" is empty.`);
    }
    throw new KnowledgeError(
      'KNOWLEDGE_FILE_TOO_LARGE',
      `"${file.name}" exceeds the maximum file size of ${(settings.maximumFileSizeBytes / 1024).toFixed(0)} KB.`,
    );
  }

  // Filename length
  if (!isValidFileName(file.name)) {
    throw new KnowledgeError(
      'KNOWLEDGE_FILENAME_TOO_LONG',
      `"${file.name}" exceeds the maximum filename length.`,
    );
  }
}

/**
 * Check duplicate content before storing.
 * Returns the existing document record if a duplicate is found; undefined otherwise.
 */
export async function checkDuplicateContent(
  contentHash: string,
  normalizedContent: string,
): Promise<{ existing?: { fileName: string; documentId: string } }> {
  const existing = await findDocumentByContentHash(contentHash);
  if (existing) {
    return {
      existing: {
        fileName: existing.fileName,
        documentId: existing.id,
      },
    };
  }
  return {};
}

/**
 * Enforce document count and total storage limits.
 */
export function checkStorageLimits(
  settings: KnowledgeSettings,
  currentUsage: { documentCount: number; estimatedBytes: number },
  incomingBytes: number,
): void {
  // Account for this document being one more
  const newDocCount = currentUsage.documentCount + 1;
  if (newDocCount > settings.maximumDocumentCount) {
    throw new KnowledgeError(
      'KNOWLEDGE_DOCUMENT_COUNT_LIMIT',
      `Document limit reached (${settings.maximumDocumentCount}). Remove some documents before importing more.`,
    );
  }

  // Conservative estimate: incoming document bytes + overhead
  const incomingEstimate = incomingBytes + 2048; // 2 KB overhead
  const newTotal = currentUsage.estimatedBytes + incomingEstimate;
  if (newTotal > settings.maximumTotalStoredBytes) {
    throw new KnowledgeError(
      'KNOWLEDGE_STORAGE_SIZE_LIMIT',
      `Storage limit reached. Estimated usage would be ${(newTotal / 1024).toFixed(0)} KB of ${(settings.maximumTotalStoredBytes / 1024 / 1024).toFixed(0)} MB.`,
    );
  }
}

/**
 * Import a single file with full validation, normalization, and duplicate detection.
 *
 * Returns a typed import result — never throws to the caller.
 */
export async function importSingleFile(
  file: File,
  settings: KnowledgeSettings,
  currentUsage: { documentCount: number; estimatedBytes: number },
): Promise<KnowledgeImportResult> {
  const fileName = file.name;

  try {
    // Step 1: Validate before reading
    validateSelectedFile(file, settings);
  } catch (err) {
    return {
      status: 'rejected',
      fileName,
      reason: err instanceof KnowledgeError ? err.message : 'File validation failed.',
    };
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (err) {
    return {
      status: 'failed',
      fileName,
      reason: err instanceof Error ? err.message : 'Failed to read file.',
    };
  }

  // Step 2: Decode
  let decoded: string;
  try {
    decoded = decodeUtf8File(buffer);
  } catch (err) {
    return {
      status: 'rejected',
      fileName,
      reason: err instanceof KnowledgeError ? err.message : 'Decoding failed.',
    };
  }

  // Step 3: Normalize
  const normalized = normalizeImportedText(decoded);

  // Reject if empty after normalization
  if (!normalized) {
    return {
      status: 'rejected',
      fileName,
      reason: 'This file contains no readable text after processing.',
    };
  }

  // Step 4: Detect suspicious unicode
  const { rejected, warnings } = detectSuspiciousUnicode(normalized);
  if (rejected) {
    return {
      status: 'rejected',
      fileName,
      reason: warnings.join(' '),
    };
  }

  // Step 5: Hash
  let contentHash: string;
  try {
    contentHash = await hashKnowledgeContent(normalized);
  } catch {
    return {
      status: 'failed',
      fileName,
      reason: 'Failed to compute content hash.',
    };
  }

  // Step 6: Duplicate check
  const dupResult = await checkDuplicateContent(contentHash, normalized);
  if (dupResult.existing) {
    return {
      status: 'duplicate',
      fileName,
      existingFileName: dupResult.existing.fileName,
    };
  }

  // Step 7: Storage limits
  try {
    checkStorageLimits(settings, currentUsage, buffer.byteLength);
  } catch (err) {
    return {
      status: 'rejected',
      fileName,
      reason: err instanceof KnowledgeError ? err.message : 'Storage limit check failed.',
    };
  }

  // Step 8: Build record
  const document = buildKnowledgeDocumentRecord(
    fileName,
    normalized,
    contentHash,
    buffer.byteLength,
  );

  // Step 9: Generate chunks deterministically
  let chunks;
  try {
    chunks = chunkDocument(document.id, document.content);
  } catch (err) {
    return {
      status: 'failed',
      fileName,
      reason: err instanceof KnowledgeError ? err.message : 'Failed to chunk document.',
    };
  }

  // Step 10: Persist atomically with chunks
  try {
    await createDocumentWithChunks(document, chunks);
  } catch (err) {
    return {
      status: 'failed',
      fileName,
      reason: err instanceof KnowledgeError ? err.message : 'Failed to store document.',
    };
  }

  return {
    status: 'imported',
    fileName,
    documentId: document.id,
  };
}

/**
 * Import multiple files in deterministic order.
 *
 * Each file gets its own result. One invalid file does not fail the batch.
 * Limits account for files already successfully imported in this batch.
 */
export async function importMultipleFiles(
  files: File[],
  settings: KnowledgeSettings,
  currentUsage: { documentCount: number; estimatedBytes: number },
): Promise<KnowledgeImportResult[]> {
  const results: KnowledgeImportResult[] = [];
  let addedCount = 0;
  let addedBytes = 0;

  // Sort files by name for deterministic processing order
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));

  for (const file of sorted) {
    const batchUsage = {
      documentCount: currentUsage.documentCount + addedCount,
      estimatedBytes: currentUsage.estimatedBytes + addedBytes,
    };
    const result = await importSingleFile(file, settings, batchUsage);
    results.push(result);
    if (result.status === 'imported') {
      addedCount++;
      // Conservative estimate: file byte size + overhead
      addedBytes += file.size + 2048;
    }
  }

  return results;
}
