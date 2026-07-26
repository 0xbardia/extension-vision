/**
 * Search normalization for retrieval.
 *
 * This module produces a derived representation used only for matching.
 * Stored document and chunk text remain faithful to the original import.
 *
 * Operations: Unicode NFC, Latin lowercasing, Persian/Arabic letter
 * normalization, digit normalization, tatweel removal, tokenization,
 * stop-word removal, and meaningful-query detection.
 */

// ─── Persian/Arabic Normalization Maps ───────────────────────────────

const PERSIAN_NORMALIZE_MAP: Record<string, string> = {
  // Persian/Arabic letter variants → standard Persian form
  ي: 'ی', // Arabic yā' → Persian ye
  ى: 'ی', // Arabic alif maqsura → Persian ye
  ك: 'ک', // Arabic kāf → Persian kaf
};

// Characters to remove entirely
const TATWEEL_RE = /\u0640/g; // Arabic tatweel/kashida
const COMBINING_MARKS_RE = /[\u064B-\u065F\u0670]/g; // Arabic combining marks

// ─── Stop Words ─────────────────────────────────────────────────────

const ENGLISH_STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'to',
  'of',
  'in',
  'is',
  'are',
  'for',
  'on',
  'with',
  'it',
  'as',
  'at',
  'by',
  'be',
  'this',
  'that',
  'from',
  'was',
  'were',
  'been',
  'has',
  'have',
  'had',
  'not',
  'but',
]);

const PERSIAN_STOP_WORDS = new Set([
  'و',
  'یا',
  'از',
  'به',
  'در',
  'که',
  'این',
  'آن',
  'برای',
  'با',
  'است',
  'را',
  'یک',
  'شد',
  'شده',
  'می',
  'های',
  'تا',
  'بر',
  'بود',
  'نیز',
  'شدن',
  'کردن',
  'گرفتن',
]);

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Normalize a query or chunk text for retrieval matching.
 *
 * This does NOT modify stored content.
 */
export function normalizeForSearch(text: string): string {
  let result = text.normalize('NFC');

  // Lowercase Latin letters
  result = result.replace(/[A-Za-z]/g, (c) => c.toLowerCase());

  // Normalize Persian/Arabic letter variants
  result = result.replace(/[يى]/g, 'ی');
  result = result.replace(/ك/g, 'ک');

  // Remove tatweel
  result = result.replace(TATWEEL_RE, '');

  // Remove Arabic combining marks
  result = result.replace(COMBINING_MARKS_RE, '');

  // Normalize digits: Persian/Arabic-Indic → ASCII
  result = result.replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 0x30));
  result = result.replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06f0 + 0x30));

  // Normalize whitespace
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}

/**
 * Tokenize a normalized search string into terms.
 * Preserves meaningful identifiers, ZWNJ, and technical terms.
 */
export function tokenizeForSearch(normalized: string): string[] {
  if (!normalized) return [];

  // Split on whitespace, punctuation boundaries while preserving meaningful terms
  // This regex keeps: words (including with hyphens/underscores/dots), numbers,
  // and alphanumeric identifiers. It splits on whitespace and most punctuation.
  const tokens: string[] = [];
  const parts = normalized.split(/\s+/);

  for (const part of parts) {
    if (!part) continue;

    // For each part, try to keep it intact if it's meaningful.
    // Split further on punctuation that isn't internal to technical terms.
    const subTokens = splitTechnicalTerms(part);
    for (const token of subTokens) {
      if (token && token.trim()) {
        tokens.push(token.trim());
      }
    }
  }

  return tokens;
}

/**
 * Split a string into meaningful tokens, preserving technical terms
 * like "GPT-4", "ERC-20", "Phase 1.2", "0xabc123", "کیف‌پول".
 */
function splitTechnicalTerms(text: string): string[] {
  // If the text contains internal hyphens, underscores, or dots,
  // try to keep it as one token (for technical terms)
  // but also check if it's a compound we should split

  // Keep strings with mixed alphanumeric + internal punctuation as single tokens
  if (/^[a-zA-Z0-9_\-.]+$/.test(text) && /[a-zA-Z]/.test(text) && /[0-9]/.test(text)) {
    return [text];
  }

  // Keep hex-like identifiers (0x...)
  if (/^0x[a-fA-F0-9]+$/.test(text)) {
    return [text];
  }

  // Keep wallet-like identifiers (long alphanumeric)
  if (/^[a-zA-Z0-9]{20,}$/.test(text)) {
    return [text];
  }

  // Keep model names (alphanumeric with hyphens/slashes)
  if (/^[a-zA-Z0-9\-/]+$/.test(text) && text.length >= 3) {
    return [text];
  }

  // Split on general punctuation boundaries
  const tokens: string[] = [];
  const current: string[] = [];

  for (const ch of text) {
    if (/[\s\-_./:;,!?()\[\]{}'"،؛؟]/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current.join(''));
        current.length = 0;
      }
      // Don't include punctuation as tokens
    } else {
      current.push(ch);
    }
  }

  if (current.length > 0) {
    tokens.push(current.join(''));
  }

  return tokens;
}

/**
 * Remove stop words from a list of tokens.
 */
export function removeStopWords(tokens: string[]): string[] {
  return tokens.filter((t) => {
    const lower = t.toLowerCase();
    return !ENGLISH_STOP_WORDS.has(lower) && !PERSIAN_STOP_WORDS.has(t);
  });
}

/**
 * Check if a query is meaningful enough for retrieval.
 */
export function isMeaningfulKnowledgeQuery(query: string): boolean {
  if (!query || query.trim().length === 0) return false;

  // Check max length
  if (query.length > 2000) return false;

  const normalized = normalizeForSearch(query);

  // Reject if empty after normalization
  if (!normalized) return false;

  // Check for only punctuation/whitespace
  if (/^[\s\p{P}\p{C}]+$/u.test(normalized)) return false;

  const tokens = removeStopWords(tokenizeForSearch(normalized));

  // Reject if no meaningful tokens
  if (tokens.length === 0) return false;

  // Reject if only single-character tokens
  const meaningfulTokens = tokens.filter((t) => t.length > 1 || /[a-zA-Z]/.test(t));
  if (meaningfulTokens.length === 0) return false;

  // Allow: meaningful Persian word (contains Persian chars)
  const hasPersian = /[\u0600-\u06FF]/.test(normalized);
  if (hasPersian && meaningfulTokens.length > 0) return true;

  // Allow: at least one multi-character non-pure-punctuation token
  return meaningfulTokens.length > 0;
}

/**
 * Compute term frequency in a text (for BM25).
 */
export function computeTermFrequency(text: string, term: string): number {
  if (!text || !term) return 0;
  const normalized = normalizeForSearch(text);
  const tokens = tokenizeForSearch(normalized);
  let count = 0;
  for (const token of tokens) {
    if (token === term) count++;
  }
  return count;
}

/**
 * Get token set from normalized text.
 */
export function getTokenSet(normalized: string): Set<string> {
  const tokens = tokenizeForSearch(normalized);
  return new Set(removeStopWords(tokens));
}
