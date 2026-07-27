/**
 * Build knowledge context for a Solve request.
 *
 * Orchestrates:
 * 1. Settings check
 * 2. Query derivation
 * 3. Retrieval
 * 4. Context wrapping
 * 5. Budget enforcement
 * 6. Timeout handling
 */

import type { KnowledgeContextResult, KnowledgeSettings } from './types';
import { DEFAULT_KNOWLEDGE_SETTINGS } from './types';
import { getKnowledgeSettings } from './settings';
import { retrieveKnowledge } from './retrieval';
import {
  buildKnowledgeBlock,
  getKnowledgeWrapperOverhead,
  sanitizeSourceLabel,
  KNOWLEDGE_SECURITY_NOTICE,
} from './prompt-boundary';
import { isValidRetrievalQuery, buildKnowledgeQuery } from './query-builder';

/**
 * Maximum time (ms) for knowledge preparation before Solve continues
 * without knowledge.
 */
export const KNOWLEDGE_TIMEOUT_MS = 1500;

/**
 * Token estimation divisor for safe provider budget.
 */
const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 4;

/**
 * Product-level safe maximum total input characters.
 * Used when provider model limits are not known.
 */
const SAFE_MAX_INPUT_CHARS = 32_000;

/**
 * Build knowledge context for a Solve request.
 *
 * This is the main integration point called from the Solve flow.
 * It handles all failure modes gracefully — the Solve proceeds without
 * knowledge when anything goes wrong.
 *
 * @param effectiveInstruction - The combined user instruction for Solve
 * @param presetInstruction - The preset instruction (if any)
 * @returns A KnowledgeContextResult with status and bounded text
 */
export async function buildKnowledgeContext(
  effectiveInstruction: string,
  presetInstruction?: string,
): Promise<KnowledgeContextResult> {
  const started = performance.now();

  try {
    // ── 1. Check settings ────────────────────────────────────────
    const settings = await getKnowledgeSettingsSafe();
    if (!settings) {
      return emptyResult('unavailable', started, 'settings-unavailable');
    }

    if (!settings.enabled) {
      return emptyResult('disabled', started);
    }

    // ── 2. Derive query ──────────────────────────────────────────
    const query = buildKnowledgeQuery(effectiveInstruction, presetInstruction);
    if (!isValidRetrievalQuery(query)) {
      return emptyResult('no-query', started);
    }

    // ── 3. Retrieve with timeout ─────────────────────────────────
    const retrievalPromise = retrieveKnowledge(query, {
      maximumChunks: settings.maximumRetrievedChunks,
      maximumCharacters: settings.maximumContextCharacters,
    });

    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), KNOWLEDGE_TIMEOUT_MS);
    });

    const retrievalResult = await Promise.race([retrievalPromise, timeoutPromise]);

    if (!retrievalResult) {
      return emptyResult('timeout', started, 'timeout');
    }

    if (retrievalResult.reason === 'knowledge-disabled') {
      return emptyResult('disabled', started);
    }

    if (
      retrievalResult.reason === 'query-not-meaningful' ||
      retrievalResult.reason === 'no-match'
    ) {
      const status = retrievalResult.reason === 'query-not-meaningful' ? 'no-query' : 'no-match';
      return emptyResult(status, started);
    }

    if (retrievalResult.matches.length === 0) {
      return emptyResult('no-match', started);
    }

    // ── 4. Build context block ──────────────────────────────────
    const sources = retrievalResult.matches.map((m) => ({
      fileName: m.fileName,
      text: m.text,
    }));

    const contextBlock = buildKnowledgeBlock(sources);

    if (!contextBlock) {
      return emptyResult('no-match', started);
    }

    // ── 5. Budget enforcement ───────────────────────────────────
    // The retrieval already respects maximumContextCharacters for chunk text.
    // But we also need to ensure the FULL block (wrapper + notice + overhead)
    // doesn't exceed the budget.
    const budgetChars = settings.maximumContextCharacters;
    if (contextBlock.length > budgetChars) {
      // The block is too large — try with fewer sources
      const trimmedSources = [];
      let runningLength = 0;
      for (const source of sources) {
        const estimatedEntry = `Source ${trimmedSources.length + 1} - ${sanitizeSourceLabel(source.fileName, trimmedSources.length + 1)}:\n${source.text}\n\n`;
        if (runningLength + estimatedEntry.length > budgetChars) break;
        trimmedSources.push(source);
        runningLength += estimatedEntry.length;
      }
      // Rebuild with trimmed sources
      const trimmedBlock = trimmedSources.length > 0 ? buildKnowledgeBlock(trimmedSources) : '';
      if (!trimmedBlock) {
        return emptyResult('no-match', started);
      }

      const docIds = [
        ...new Set(
          sources
            .slice(0, trimmedSources.length)
            .map((_, i) => retrievalResult.matches[i]?.documentId || ''),
        ),
      ].filter(Boolean);

      return {
        status: 'included',
        text: trimmedBlock,
        sourceCount: trimmedSources.length,
        chunkCount: trimmedSources.length,
        characterCount: trimmedBlock.length,
        documentIds: docIds,
      };
    }

    // ── 6. Build result ─────────────────────────────────────────
    const docIds = [...new Set(retrievalResult.matches.map((m) => m.documentId))];

    return {
      status: 'included',
      text: contextBlock,
      sourceCount: sources.length,
      chunkCount: sources.length,
      characterCount: contextBlock.length,
      documentIds: docIds,
    };
  } catch (err) {
    const errorCode =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: string }).code)
        : err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message).substring(0, 100)
          : 'unknown';
    return emptyResult('failed', started, errorCode);
  }
}

/**
 * Read knowledge settings safely — returns null on failure.
 */
async function getKnowledgeSettingsSafe(): Promise<KnowledgeSettings | null> {
  try {
    return await getKnowledgeSettings();
  } catch {
    return null;
  }
}

/**
 * Build an empty result (no knowledge included).
 */
function emptyResult(
  status: KnowledgeContextResult['status'],
  startedAt: number,
  errorCode?: string,
): KnowledgeContextResult {
  return {
    status,
    text: '',
    sourceCount: 0,
    chunkCount: 0,
    characterCount: 0,
    documentIds: [],
    ...(errorCode ? { errorCode } : {}),
  };
}
