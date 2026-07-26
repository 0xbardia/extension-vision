/**
 * Deterministic document chunking for the Local Knowledge Base.
 *
 * Chunks are created from normalized document content.
 * Boundaries prefer natural breaks: paragraph → sentence → word → character.
 * Overlap preserves context between adjacent chunks.
 * All IDs are deterministic (no random UUIDs).
 */

import type { KnowledgeChunkRecord } from './types';
import {
  CHUNK_TARGET_CHARS,
  CHUNK_MAX_CHARS,
  CHUNK_MIN_CHARS,
  CHUNK_OVERLAP_CHARS,
  CHUNK_MAX_PER_DOCUMENT,
  KNOWLEDGE_PROCESSING_VERSION,
} from './types';
import { KnowledgeError } from './errors';

// ─── Constants for boundary detection ───────────────────────────────

const DOUBLE_NEWLINE_RE = /\n\n+/g;
const SINGLE_NEWLINE_RE = /\n/g;
const SENTENCE_END_RE = /[.!?؟؛]/g;
const WHITESPACE_RE = /\s+/g;

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Chunk a document's normalized content deterministically.
 *
 * Returns an array of KnowledgeChunkRecord suitable for storage.
 * Throws KNOWLEDGE_CHUNKING_OVERFLOW if the document would produce
 * more than CHUNK_MAX_PER_DOCUMENT chunks.
 */
export function chunkDocument(documentId: string, content: string): KnowledgeChunkRecord[] {
  // Reject empty content
  if (!content || content.trim().length === 0) {
    return [];
  }

  const chunks: KnowledgeChunkRecord[] = [];
  let startOffset = 0;

  while (startOffset < content.length) {
    // Enforce safety ceiling
    if (chunks.length >= CHUNK_MAX_PER_DOCUMENT) {
      throw new KnowledgeError(
        'KNOWLEDGE_CHUNKING_OVERFLOW',
        `Document ${documentId} exceeds maximum chunk count of ${CHUNK_MAX_PER_DOCUMENT}.`,
      );
    }

    const remaining = content.length - startOffset;

    // If the remaining text fits in one chunk, finish
    if (remaining <= CHUNK_TARGET_CHARS) {
      const chunk = makeChunk(documentId, chunks.length, content, startOffset, content.length);
      if (!chunk) break; // skip empty
      chunks.push(chunk);
      break;
    }

    // Find the best boundary near the target end
    const targetEnd = startOffset + CHUNK_TARGET_CHARS;
    const hardMax = Math.min(startOffset + CHUNK_MAX_CHARS, content.length);

    const boundary = findBestBoundary(content, targetEnd, hardMax);

    if (boundary <= startOffset) {
      // Fallback: hard split at the hard max
      const end = Math.min(startOffset + CHUNK_MAX_CHARS, content.length);
      const chunk = makeChunk(documentId, chunks.length, content, startOffset, end);
      if (chunk) chunks.push(chunk);
      startOffset = end;
    } else {
      const chunk = makeChunk(documentId, chunks.length, content, startOffset, boundary);
      if (chunk) chunks.push(chunk);
      startOffset = boundary;
    }

    // Apply overlap: move back by overlap chars, preferring a natural boundary
    if (startOffset < content.length && chunks.length > 0) {
      const overlapStart = Math.max(
        startOffset - CHUNK_OVERLAP_CHARS,
        chunks[chunks.length - 1].startOffset,
      );
      if (overlapStart < startOffset) {
        // Find a natural boundary near the overlap start
        const overlapBoundary = findBackwardBoundary(content, overlapStart, startOffset);
        if (
          overlapBoundary > chunks[chunks.length - 1].startOffset &&
          overlapBoundary < startOffset
        ) {
          startOffset = overlapBoundary;
        }
      }

      // Safety: prevent infinite loop by ensuring progress
      if (startOffset >= content.length) break;
      // Make sure we always make forward progress (at least 1 char)
      // Also prevent identical adjacent chunks
      const prevChunk = chunks[chunks.length - 1];
      if (prevChunk.endOffset >= startOffset) {
        startOffset = prevChunk.endOffset;
      }
    }
  }

  return chunks;
}

/**
 * Check if a document needs processing.
 * A document needs processing when any of these is true:
 * - processingVersion < KNOWLEDGE_PROCESSING_VERSION (2)
 * - document has no chunks while content is non-empty
 */
export function documentNeedsProcessing(
  processingVersion: number,
  hasChunks: boolean,
  content: string,
): boolean {
  if (processingVersion < KNOWLEDGE_PROCESSING_VERSION) return true;
  if (!hasChunks && content.trim().length > 0) return true;
  return false;
}

/**
 * Build a deterministic chunk ID.
 * Format: `${documentId}:v2:${index}`
 */
export function makeChunkId(documentId: string, index: number): string {
  return `${documentId}:v2:${index}`;
}

// ─── Internal Helpers ───────────────────────────────────────────────

/**
 * Create a single chunk record.
 * Returns null if the chunk would be empty.
 */
function makeChunk(
  documentId: string,
  index: number,
  content: string,
  startOffset: number,
  endOffset: number,
): KnowledgeChunkRecord | null {
  const text = content.slice(startOffset, endOffset);
  if (!text || text.trim().length === 0) return null;

  return {
    id: makeChunkId(documentId, index),
    documentId,
    index,
    text,
    startOffset,
    endOffset,
    processingVersion: KNOWLEDGE_PROCESSING_VERSION,
  };
}

/**
 * Find the best boundary position in [targetEnd, hardMax].
 * Prefers: paragraph → newline → sentence → whitespace → hard max.
 */
function findBestBoundary(content: string, targetEnd: number, hardMax: number): number {
  // 1. Search for paragraph boundary (double newline) in the forward range
  const paraEnd = findNearestForward(content, DOUBLE_NEWLINE_RE, targetEnd, hardMax);
  if (paraEnd >= 0) return paraEnd;

  // 2. Search for single newline
  const newlineEnd = findNearestForward(content, SINGLE_NEWLINE_RE, targetEnd, hardMax);
  if (newlineEnd >= 0) return newlineEnd;

  // 3. Search for sentence end
  const sentenceEnd = findNearestForward(content, SENTENCE_END_RE, targetEnd, hardMax);
  if (sentenceEnd >= 0) return sentenceEnd + 1; // include the punctuation

  // 4. Search for whitespace
  const whitespaceEnd = findLastWhitespaceInRange(content, targetEnd, hardMax);
  if (whitespaceEnd >= 0) return whitespaceEnd + 1;

  // 5. Hard boundary at hardMax
  return hardMax;
}

/**
 * Find a natural boundary moving backward from overlapStart.
 * Returns the boundary position, or overlapStart if no good boundary found.
 */
function findBackwardBoundary(content: string, overlapStart: number, currentStart: number): number {
  // Search backward for a newline
  for (let i = currentStart - 1; i >= overlapStart; i--) {
    if (content[i] === '\n') return i + 1;
  }
  // Search backward for a sentence end
  for (let i = currentStart - 1; i >= overlapStart; i--) {
    if (/[.!?؟؛]/.test(content[i])) return i + 1;
  }
  // Search backward for whitespace
  for (let i = currentStart - 1; i >= overlapStart; i--) {
    if (/\s/.test(content[i])) return i + 1;
  }
  // No good boundary found
  return overlapStart;
}

/**
 * Find the nearest occurrence of a regex pattern in [start, end].
 * Returns the position (end of match) or -1 if not found.
 */
function findNearestForward(content: string, pattern: RegExp, start: number, end: number): number {
  // Reset regex state
  pattern.lastIndex = -1;
  const searchText = content.slice(start, end);
  let match: RegExpExecArray | null;

  // Use exec in a loop to find the first match
  while ((match = pattern.exec(searchText)) !== null) {
    return start + match.index + match[0].length;
  }
  return -1;
}

/**
 * Find the last whitespace position in [start, end).
 */
function findLastWhitespaceInRange(content: string, start: number, end: number): number {
  for (let i = end - 1; i >= start; i--) {
    if (/\s/.test(content[i])) return i;
  }
  return -1;
}
