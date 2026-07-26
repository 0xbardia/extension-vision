import { describe, expect, it } from 'vitest';
import {
  normalizeForSearch,
  tokenizeForSearch,
  removeStopWords,
  isMeaningfulKnowledgeQuery,
  computeTermFrequency,
  getTokenSet,
} from '../../src/knowledge/search-normalization';

describe('normalizeForSearch', () => {
  it('lowercases Latin text', () => {
    expect(normalizeForSearch('Hello World')).toBe('hello world');
  });

  it('preserves Persian characters', () => {
    const result = normalizeForSearch('سلام دنیا');
    expect(result).toContain('سلام');
    expect(result).toContain('دنیا');
  });

  it('normalizes Arabic yā to Persian ye', () => {
    expect(normalizeForSearch('ميس')).toBe('میس');
  });

  it('normalizes alif maqsura to Persian ye', () => {
    expect(normalizeForSearch('على')).toBe('علی');
  });

  it('normalizes Arabic kāf to Persian kaf', () => {
    expect(normalizeForSearch('كتاب')).toBe('کتاب');
  });

  it('removes tatweel', () => {
    expect(normalizeForSearch('كتـاب')).toBe('کتاب');
  });

  it('normalizes Persian digits to ASCII', () => {
    expect(normalizeForSearch('۱۲۳')).toBe('123');
  });

  it('normalizes Arabic-Indic digits to ASCII', () => {
    expect(normalizeForSearch('١٢٣')).toBe('123');
  });

  it('preserves English digits', () => {
    expect(normalizeForSearch('123')).toBe('123');
  });

  it('handles mixed Persian and English digits', () => {
    expect(normalizeForSearch('۱۲3')).toBe('123');
  });

  it('preserves model names', () => {
    const result = normalizeForSearch('GPT-4');
    expect(result).toContain('gpt-4');
  });

  it('preserves ERC-20', () => {
    const result = normalizeForSearch('ERC-20');
    expect(result).toContain('erc-20');
  });

  it('handles "Phase 1.2"', () => {
    const result = normalizeForSearch('Phase 1.2');
    expect(result).toContain('phase');
    expect(result).toContain('1.2');
  });

  it('handles wallet-like identifiers', () => {
    const result = normalizeForSearch('0xabc123def456');
    expect(result).toContain('0xabc123def456');
  });

  it('removes Arabic combining marks', () => {
    const result = normalizeForSearch('مُحَمَّد');
    // After removing combining marks: 'محم\u062f'
    expect(result).not.toContain('\u064e'); // fatha
  });

  it('preserves ZWNJ', () => {
    const result = normalizeForSearch('می\u200cشود');
    expect(result).toContain('\u200c');
  });

  it('normalizes repeated whitespace', () => {
    expect(normalizeForSearch('hello    world')).toBe('hello world');
  });

  it('is deterministic', () => {
    const input = 'Hello World ۱۲۳ GPT-4';
    expect(normalizeForSearch(input)).toBe(normalizeForSearch(input));
  });
});

describe('tokenizeForSearch', () => {
  it('splits on whitespace', () => {
    const tokens = tokenizeForSearch('hello world');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
  });

  it('preserves hyphenated technical terms', () => {
    const tokens = tokenizeForSearch('GPT-4');
    expect(tokens).toContain('GPT-4');
  });

  it('preserves ERC-20', () => {
    const tokens = tokenizeForSearch('ERC-20 standard');
    expect(tokens).toContain('ERC-20');
  });

  it('preserves hex identifiers', () => {
    const tokens = tokenizeForSearch('0xabc123');
    expect(tokens).toContain('0xabc123');
  });

  it('preserves Persian words', () => {
    const tokens = tokenizeForSearch('سلام دنیا');
    expect(tokens).toContain('سلام');
    expect(tokens).toContain('دنیا');
  });

  it('handles mixed Persian and English', () => {
    const tokens = tokenizeForSearch('سلام world 123');
    expect(tokens).toContain('سلام');
    expect(tokens).toContain('world');
    expect(tokens).toContain('123');
  });

  it('returns empty for empty input', () => {
    expect(tokenizeForSearch('')).toEqual([]);
  });

  it('splits on punctuation', () => {
    const tokens = tokenizeForSearch('hello,world.test');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
    expect(tokens).toContain('test');
  });
});

describe('removeStopWords', () => {
  it('removes English stop words', () => {
    const tokens = ['the', 'hello', 'and', 'world', 'is'];
    expect(removeStopWords(tokens)).toEqual(['hello', 'world']);
  });

  it('removes Persian stop words', () => {
    const tokens = ['سلام', 'و', 'دنیا', 'از'];
    expect(removeStopWords(tokens)).toEqual(['سلام', 'دنیا']);
  });

  it('preserves meaningful words', () => {
    const tokens = ['hello', 'world', 'سلام', 'دنیا'];
    expect(removeStopWords(tokens)).toEqual(['hello', 'world', 'سلام', 'دنیا']);
  });

  it('returns empty array when all tokens are stop words', () => {
    const tokens = ['the', 'a', 'an', 'و'];
    expect(removeStopWords(tokens)).toEqual([]);
  });
});

describe('isMeaningfulKnowledgeQuery', () => {
  it('rejects empty query', () => {
    expect(isMeaningfulKnowledgeQuery('')).toBe(false);
  });

  it('rejects whitespace-only query', () => {
    expect(isMeaningfulKnowledgeQuery('   ')).toBe(false);
  });

  it('rejects punctuation-only query', () => {
    expect(isMeaningfulKnowledgeQuery('!!! ???')).toBe(false);
  });

  it('rejects stop-word-only query', () => {
    expect(isMeaningfulKnowledgeQuery('the and of')).toBe(false);
  });

  it('rejects excessively long query', () => {
    expect(isMeaningfulKnowledgeQuery('x'.repeat(2001))).toBe(false);
  });

  it('accepts meaningful English word', () => {
    expect(isMeaningfulKnowledgeQuery('hello')).toBe(true);
  });

  it('accepts meaningful Persian word', () => {
    expect(isMeaningfulKnowledgeQuery('سلام')).toBe(true);
  });

  it('accepts model names', () => {
    expect(isMeaningfulKnowledgeQuery('GPT-4')).toBe(true);
  });

  it('accepts version numbers with context', () => {
    expect(isMeaningfulKnowledgeQuery('version 1.2')).toBe(true);
  });

  it('accepts acronyms', () => {
    expect(isMeaningfulKnowledgeQuery('ERC-20')).toBe(true);
  });

  it('accepts blockchain identifiers', () => {
    expect(isMeaningfulKnowledgeQuery('0xabc123')).toBe(true);
  });

  it('accepts technical terms', () => {
    expect(isMeaningfulKnowledgeQuery('OpenRouter')).toBe(true);
  });

  it('accepts mixed Persian and English', () => {
    expect(isMeaningfulKnowledgeQuery('کیف پول blockchain')).toBe(true);
  });
});

describe('computeTermFrequency', () => {
  it('returns 0 for absent term', () => {
    expect(computeTermFrequency('hello world', 'bye')).toBe(0);
  });

  it('counts occurrences', () => {
    expect(computeTermFrequency('hello hello world', 'hello')).toBe(2);
  });

  it('is case-insensitive', () => {
    expect(computeTermFrequency('Hello HELLO hello', 'hello')).toBe(3);
  });

  it('handles Persian terms', () => {
    expect(computeTermFrequency('سلام سلام دنیا', 'سلام')).toBe(2);
  });
});

describe('getTokenSet', () => {
  it('returns unique tokens without stop words', () => {
    const tokens = getTokenSet('the hello the world and test');
    expect(tokens.has('hello')).toBe(true);
    expect(tokens.has('world')).toBe(true);
    expect(tokens.has('test')).toBe(true);
    expect(tokens.has('the')).toBe(false);
    expect(tokens.has('and')).toBe(false);
  });
});
