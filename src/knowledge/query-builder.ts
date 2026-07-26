/**
 * Derive a bounded retrieval query from a Solve task.
 *
 * The query is used only as local input to retrieveKnowledge().
 * It must not create additional external data leakage.
 */

import { isMeaningfulKnowledgeQuery } from './search-normalization';

/** Maximum raw query length */
export const MAX_RETRIEVAL_QUERY_LENGTH = 2000;

/**
 * Build a deterministic retrieval query from a Solve task.
 *
 * Priority:
 * 1. User's custom instruction / effective prompt
 * 2. Preset instruction if no user instruction
 * 3. Empty string if neither is available (skips retrieval)
 *
 * @param effectiveInstruction - The combined user instruction for Solve
 * @param presetInstruction - The preset instruction (if any)
 * @returns A bounded query string, or empty string if no meaningful query
 */
export function buildKnowledgeQuery(
  effectiveInstruction: string,
  presetInstruction?: string,
): string {
  // Use the user's instruction first
  const raw = effectiveInstruction.trim();
  if (raw) {
    return normalizeQuery(raw);
  }

  // Fall back to preset instruction
  if (presetInstruction && presetInstruction.trim()) {
    return normalizeQuery(presetInstruction.trim());
  }

  return '';
}

/**
 * Normalize a query string: trim, collapse whitespace, enforce max length,
 * and strip credentials.
 */
function normalizeQuery(query: string): string {
  let result = query.normalize('NFC').replace(/\s+/g, ' ').trim();

  // Strip credential patterns that could leak into retrieval queries
  result = stripCredentials(result);

  if (result.length > MAX_RETRIEVAL_QUERY_LENGTH) {
    result = result.slice(0, MAX_RETRIEVAL_QUERY_LENGTH);
  }

  return result;
}

/**
 * Remove credential-like patterns from a query string.
 *
 * Handles:
 * - OpenAI keys: sk-... and sk-proj-...
 * - Bearer tokens
 * - ENV-style assignments: OPENAI_API_KEY=..., OPENROUTER_API_KEY=...
 * - API key fields: apiKey, api_key in objects
 * - GitHub tokens: github_pat_...
 * - PEM private key markers
 * - Authorization header values
 *
 * Does NOT remove normal words beginning with "sk" or "api".
 * Does NOT log or expose the removed value.
 */
export function stripCredentials(text: string): string {
  if (!text) return text;

  // Remove Bearer tokens (case-insensitive)
  // Remove Bearer tokens (case-insensitive)
  text = text.replace(/\b[Bb]earer\s+[A-Za-z0-9\-_.]{20,}/g, '');

  // Remove OPENAI_API_KEY=... and OPENROUTER_API_KEY=... env assignments
  // Process BEFORE generic sk- patterns so the full assignment is consumed
  text = text.replace(/\bOPENAI_API_KEY\s*=\s*['"]?\S+['"]?/g, '');
  text = text.replace(/\bOPENROUTER_API_KEY\s*=\s*['"]?\S+['"]?/g, '');

  // Remove sk-... and sk-proj-... OpenAI-style keys
  text = text.replace(/\bsk-proj-[A-Za-z0-9\-_.]{4,}/g, '');

  // Remove inline apiKey/api_key assignments — before generic sk- so
  // the whole "apiKey: sk-..." line is consumed before sk- removes just the key
  text = text.replace(/\b(apiKey|api_key)\s*[:=]\s*['"]?[A-Za-z0-9\-_.]{20,}['"]?/g, '');

  text = text.replace(/\bsk-[A-Za-z0-9\-_.]{4,}\b/g, '');

  // Remove GitHub tokens
  text = text.replace(/\bgithub_pat_[A-Za-z0-9\-_]{20,}/g, '');

  // Remove inline apiKey/api_key assignments — before generic sk- patterns
  text = text.replace(/\b(apiKey|api_key)\s*[:=]\s*['"]?[A-Za-z0-9\-_.]{20,}['"]?/g, '');

  // Remove PEM private-key markers and content
  text = text.replace(
    /-----BEGIN\s+(RSA\s+)?(EC\s+)?(OPENSSH\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?(EC\s+)?(OPENSSH\s+)?PRIVATE\s+KEY-----/g,
    '',
  );

  // Remove authorization header fragments — consume everything after the colon
  text = text.replace(/\bauthorization\s*:\s*.+/gi, '');

  // Normalize whitespace after removals
  text = text.replace(/\s{2,}/g, ' ').trim();
  // Clean up trailing punctuation left by credential removal (e.g., "using ?" → "using?")
  text = text.replace(/\s+([.,!?;:])/g, '$1');

  return text;
}

/**
 * Quick check whether a potential query is worth sending to retrieval.
 * Pure function, no side effects, deterministic.
 */
export function isValidRetrievalQuery(query: string): boolean {
  if (!query || !query.trim()) return false;
  return isMeaningfulKnowledgeQuery(query);
}
