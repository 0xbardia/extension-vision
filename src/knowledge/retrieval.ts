/**
 * Local lexical retrieval for the Knowledge Base.
 *
 * Implements a BM25-style scoring algorithm over stored chunks.
 * No embeddings, no external calls. All computation is local.
 *
 * BM25 constants:
 *   k1 = 1.2
 *   b = 0.75
 */

import type {
  KnowledgeRetrievalOptions,
  KnowledgeRetrievalResult,
  KnowledgeRetrievalMatch,
  KnowledgeSettings,
} from './types';
import { DEFAULT_KNOWLEDGE_SETTINGS, KNOWLEDGE_PROCESSING_VERSION } from './types';
import { getKnowledgeSettings } from './settings';
import { listDocuments, getChunksForDocuments } from './repository';
import {
  normalizeForSearch,
  tokenizeForSearch,
  removeStopWords,
  isMeaningfulKnowledgeQuery,
  computeTermFrequency,
} from './search-normalization';

// ─── BM25 Constants ──────────────────────────────────────────────────

const BM25_K1 = 1.2;
const BM25_B = 0.75;

// ─── Boost Constants ────────────────────────────────────────────────

const EXACT_PHRASE_BOOST = 1.25;
const FULL_COVERAGE_BOOST = 1.15;
const FILENAME_BONUS = 0.1;

// ─── Max Query Length ───────────────────────────────────────────────

const MAX_QUERY_LENGTH = 2000;

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Retrieve knowledge chunks matching a query using local lexical search.
 *
 * Returns empty matches with a clear reason when no results are available.
 * Never throws for normal retrieval — degrades gracefully.
 */
export async function retrieveKnowledge(
  query: string,
  options?: KnowledgeRetrievalOptions,
): Promise<KnowledgeRetrievalResult> {
  // ── 1. Check global enabled state ─────────────────────────────────
  let settings: KnowledgeSettings;
  try {
    settings = await getKnowledgeSettings();
  } catch {
    return emptyResult(query, 'Unexpected error reading settings.', 'knowledge-disabled');
  }

  if (!settings.enabled) {
    return emptyResult(query, 'Local Knowledge is disabled.', 'knowledge-disabled');
  }

  // ── 2. Validate query ─────────────────────────────────────────────
  if (!isMeaningfulKnowledgeQuery(query) || query.length > MAX_QUERY_LENGTH) {
    return emptyResult(query, 'Query is not meaningful.', 'query-not-meaningful');
  }

  const normalizedQuery = normalizeForSearch(query);
  const queryTokens = removeStopWords(tokenizeForSearch(normalizedQuery));

  if (queryTokens.length === 0) {
    return emptyResult(query, 'Query contains only stop words.', 'query-not-meaningful');
  }

  // ── 3. Load eligible documents and chunks ─────────────────────────
  const documents = await listDocuments();
  const enabledDocs = documents.filter((d) => d.enabled);

  if (enabledDocs.length === 0) {
    return emptyResult(query, normalizedQuery, 'no-enabled-documents');
  }

  // Load all eligible chunks in a single IndexedDB pass
  const eligibleChunks: {
    chunk: import('./types').KnowledgeChunkRecord;
    docFileName: string;
  }[] = [];

  // Build a set of enabled doc IDs for fast lookup
  const enabledDocIds = new Set<string>();
  for (const doc of enabledDocs) {
    if (doc.processingVersion >= KNOWLEDGE_PROCESSING_VERSION) {
      enabledDocIds.add(doc.id);
    }
  }

  // Use a single key-range cursor over chunks, checking documentId
  const allChunks = await getChunksForDocuments(Array.from(enabledDocIds));
  for (const chunk of allChunks) {
    if (!chunk.text || chunk.text.trim().length === 0) continue;
    if (chunk.processingVersion < KNOWLEDGE_PROCESSING_VERSION) continue;
    const doc = enabledDocs.find((d) => d.id === chunk.documentId);
    if (!doc) continue;
    eligibleChunks.push({ chunk, docFileName: doc.fileName });
  }

  if (eligibleChunks.length === 0) {
    return emptyResult(query, normalizedQuery, 'no-processed-chunks');
  }

  // ── 4. Score all eligible chunks ──────────────────────────────────
  const scored = scoreChunks(queryTokens, normalizedQuery, eligibleChunks);

  if (scored.length === 0) {
    return emptyResult(query, normalizedQuery, 'no-match');
  }

  // ── 5. Apply diversity: max 2 chunks per document in first pass ───
  const maxChunks = options?.maximumChunks ?? DEFAULT_KNOWLEDGE_SETTINGS.maximumRetrievedChunks;
  const maxChars =
    options?.maximumCharacters ?? DEFAULT_KNOWLEDGE_SETTINGS.maximumContextCharacters;

  const diverse = applyDiversity(scored, maxChunks);

  // ── 6. Apply character budget ─────────────────────────────────────
  const budgeted = applyCharacterBudget(diverse, maxChars);

  // ── 7. Build result ───────────────────────────────────────────────
  const totalMatched = scored.length;
  const returnedChars = budgeted.reduce((sum, m) => sum + m.text.length, 0);

  return {
    query,
    normalizedQuery,
    matches: budgeted,
    totalEligibleDocuments: enabledDocs.length,
    totalEligibleChunks: eligibleChunks.length,
    totalMatchedChunks: totalMatched,
    returnedCharacters: returnedChars,
    reason: budgeted.length === 0 ? 'no-match' : undefined,
  };
}

// ─── Scoring ────────────────────────────────────────────────────────

interface ScoredEntry {
  chunk: {
    id: string;
    documentId: string;
    index: number;
    text: string;
    startOffset: number;
    endOffset: number;
  };
  docFileName: string;
  score: number;
}

/**
 * Score all eligible chunks against the query tokens using BM25 + boosts.
 */
function scoreChunks(
  queryTokens: string[],
  normalizedQuery: string,
  eligibleEntries: {
    chunk: {
      id: string;
      documentId: string;
      index: number;
      text: string;
      startOffset: number;
      endOffset: number;
    };
    docFileName: string;
  }[],
): ScoredEntry[] {
  // Calculate document frequency for each query token
  const totalChunks = eligibleEntries.length;
  const docFrequency: Map<string, number> = new Map();

  for (const { chunk } of eligibleEntries) {
    const normalizedChunk = normalizeForSearch(chunk.text);
    const chunkTokens = new Set(tokenizeForSearch(normalizedChunk));
    for (const token of queryTokens) {
      if (chunkTokens.has(token)) {
        docFrequency.set(token, (docFrequency.get(token) || 0) + 1);
      }
    }
  }

  // Calculate average chunk length
  const totalLength = eligibleEntries.reduce((sum, { chunk }) => sum + chunk.text.length, 0);
  const avgChunkLength = totalChunks > 0 ? totalLength / totalChunks : 1;

  const results: ScoredEntry[] = [];

  for (const { chunk, docFileName } of eligibleEntries) {
    const normalizedChunk = normalizeForSearch(chunk.text);
    const chunkTokens = tokenizeForSearch(normalizedChunk);

    // BM25 score
    let score = 0;
    const chunkLength = chunk.text.length;

    for (const token of queryTokens) {
      const tf = computeTermFrequency(chunk.text, token);
      if (tf === 0) continue;

      const df = docFrequency.get(token) || 1;
      const idf = Math.log((totalChunks - df + 0.5) / (df + 0.5) + 1);

      const numerator = tf * (BM25_K1 + 1);
      const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (chunkLength / avgChunkLength));
      score += idf * (numerator / denominator);
    }

    // Exact phrase boost
    if (normalizedChunk.includes(normalizedQuery)) {
      score *= EXACT_PHRASE_BOOST;
    }

    // Full coverage boost: all meaningful query tokens appear
    const chunkTokenSet = new Set(removeStopWords(chunkTokens));
    const allTokensPresent = queryTokens.every((t) => chunkTokenSet.has(t));
    if (allTokensPresent && queryTokens.length >= 2) {
      score *= FULL_COVERAGE_BOOST;
    }

    // Filename bonus
    const normalizedFileName = normalizeForSearch(docFileName);
    const fileNameTokens = tokenizeForSearch(normalizedFileName);
    for (const qToken of queryTokens) {
      if (fileNameTokens.includes(qToken)) {
        score += FILENAME_BONUS;
      }
    }

    if (score > 0) {
      results.push({
        chunk: {
          id: chunk.id,
          documentId: chunk.documentId,
          index: chunk.index,
          text: chunk.text,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
        },
        docFileName,
        score,
      });
    }
  }

  // Sort by score descending, then deterministic tie-break
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.chunk.documentId !== b.chunk.documentId)
      return a.chunk.documentId < b.chunk.documentId ? -1 : 1;
    if (a.chunk.index !== b.chunk.index) return a.chunk.index - b.chunk.index;
    return a.chunk.id < b.chunk.id ? -1 : a.chunk.id > b.chunk.id ? 1 : 0;
  });

  return results;
}

// ─── Diversity ──────────────────────────────────────────────────────

/**
 * Apply diversity: first pass caps per-document chunks at 2,
 * second pass fills remaining slots from any document.
 */
function applyDiversity(
  scored: ScoredEntry[],
  maxChunks: number,
): {
  chunk: {
    id: string;
    documentId: string;
    index: number;
    text: string;
    startOffset: number;
    endOffset: number;
  };
  docFileName: string;
  score: number;
}[] {
  if (scored.length === 0) return [];

  const MAX_PER_DOC_FIRST_PASS = 2;
  const selected: ScoredEntry[] = [];
  const perDocCount: Map<string, number> = new Map();

  // First pass: max 2 per document
  for (const entry of scored) {
    if (selected.length >= maxChunks) break;
    const count = perDocCount.get(entry.chunk.documentId) || 0;
    if (count < MAX_PER_DOC_FIRST_PASS) {
      selected.push(entry);
      perDocCount.set(entry.chunk.documentId, count + 1);
    }
  }

  // Second pass: fill remaining slots
  if (selected.length < maxChunks) {
    for (const entry of scored) {
      if (selected.length >= maxChunks) break;
      if (selected.find((s) => s.chunk.id === entry.chunk.id)) continue;
      selected.push(entry);
    }
  }

  return selected;
}

// ─── Character Budget ──────────────────────────────────────────────

/**
 * Apply character budget: keep complete chunks, stop when next doesn't fit.
 */
function applyCharacterBudget(
  entries: {
    chunk: {
      id: string;
      documentId: string;
      index: number;
      text: string;
      startOffset: number;
      endOffset: number;
    };
    docFileName: string;
    score: number;
  }[],
  maxChars: number,
): KnowledgeRetrievalMatch[] {
  const results: KnowledgeRetrievalMatch[] = [];
  let usedChars = 0;

  for (const entry of entries) {
    const chunkLen = entry.chunk.text.length;
    if (usedChars + chunkLen > maxChars) continue; // skip, keep ranked order
    usedChars += chunkLen;
    results.push({
      chunkId: entry.chunk.id,
      documentId: entry.chunk.documentId,
      fileName: entry.docFileName,
      chunkIndex: entry.chunk.index,
      text: entry.chunk.text,
      score: Math.round(entry.score * 1000) / 1000,
      startOffset: entry.chunk.startOffset,
      endOffset: entry.chunk.endOffset,
    });
  }

  return results;
}

// ─── Helpers ────────────────────────────────────────────────────────

function emptyResult(
  query: string,
  normalizedQuery: string,
  reason: KnowledgeRetrievalResult['reason'],
): KnowledgeRetrievalResult {
  return {
    query,
    normalizedQuery,
    matches: [],
    totalEligibleDocuments: 0,
    totalEligibleChunks: 0,
    totalMatchedChunks: 0,
    returnedCharacters: 0,
    reason,
  };
}
