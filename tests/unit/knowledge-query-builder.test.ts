import { describe, expect, it } from 'vitest';
import {
  buildKnowledgeQuery,
  isValidRetrievalQuery,
  MAX_RETRIEVAL_QUERY_LENGTH,
} from '../../src/knowledge/query-builder';

describe('buildKnowledgeQuery', () => {
  it('returns empty string for empty task', () => {
    expect(buildKnowledgeQuery('')).toBe('');
  });

  it('returns empty string for whitespace-only task', () => {
    expect(buildKnowledgeQuery('   ')).toBe('');
  });

  it('returns normalized English task', () => {
    const result = buildKnowledgeQuery('What is the capital of France?');
    expect(result).toBe('What is the capital of France?');
  });

  it('returns normalized Persian task', () => {
    const result = buildKnowledgeQuery('پایتخت فرانسه کجاست؟');
    expect(result).toBe('پایتخت فرانسه کجاست؟');
  });

  it('returns normalized mixed-language task', () => {
    const result = buildKnowledgeQuery('What is قیمت of بیت‌کوین?');
    expect(result).toContain('What');
    expect(result).toContain('قیمت');
    expect(result).toContain('بیت‌کوین');
  });

  it('collapses repeated whitespace', () => {
    const result = buildKnowledgeQuery('What   is   this?');
    expect(result).toBe('What is this?');
  });

  it('trims leading/trailing whitespace', () => {
    const result = buildKnowledgeQuery('  hello world  ');
    expect(result).toBe('hello world');
  });

  it('bounded to MAX_RETRIEVAL_QUERY_LENGTH', () => {
    const long = 'x'.repeat(MAX_RETRIEVAL_QUERY_LENGTH + 100);
    const result = buildKnowledgeQuery(long);
    expect(result.length).toBeLessThanOrEqual(MAX_RETRIEVAL_QUERY_LENGTH);
  });

  it('preserves technical identifiers', () => {
    const result = buildKnowledgeQuery('What is ERC-20 and GPT-4?');
    expect(result).toContain('ERC-20');
    expect(result).toContain('GPT-4');
  });

  it('falls back to preset instruction when no user instruction', () => {
    const result = buildKnowledgeQuery('', 'Default preset');
    expect(result).toBe('Default preset');
  });

  it('uses user instruction over preset', () => {
    const result = buildKnowledgeQuery('User question', 'Preset text');
    expect(result).toContain('User');
    expect(result).not.toContain('Preset');
  });

  it('returns empty when both inputs are empty', () => {
    expect(buildKnowledgeQuery('', '')).toBe('');
    expect(buildKnowledgeQuery('', undefined)).toBe('');
  });

  it('deterministic output', () => {
    const a = buildKnowledgeQuery('Test question');
    const b = buildKnowledgeQuery('Test question');
    expect(a).toBe(b);
  });

  it('does not include screenshot or binary data', () => {
    const result = buildKnowledgeQuery('Solve this task');
    expect(result).not.toContain('data:image');
    expect(result).not.toContain('base64');
    expect(result).not.toContain('sk-');
  });

  it('does not include API keys', () => {
    // Credential-only queries produce no meaningful query
    expect(buildKnowledgeQuery('sk-proj-fake-key')).toBe('');
    expect(buildKnowledgeQuery('sk-fake-key')).toBe('');
  });

  it('strips credential embedded in English task', () => {
    const result = buildKnowledgeQuery('What is the price using sk-proj-abc123def456?');
    // The "?" remains as the original question punctuation
    expect(result).toBe('What is the price using?');
  });

  it('strips credential embedded in Persian task', () => {
    const result = buildKnowledgeQuery('قیمت با sk-proj-abc123def456 چقدر است؟');
    expect(result).toBe('قیمت با چقدر است؟');
  });

  it('strips Bearer tokens', () => {
    const result = buildKnowledgeQuery('What is Bearer xyz123token4567890123456789');
    expect(result).toBe('What is');
  });

  it('strips Bearer with lowercase bearer', () => {
    const result = buildKnowledgeQuery('Use bearer xyz123token4567890123456789');
    expect(result).toBe('Use');
  });

  it('strips ENV-style API key assignment', () => {
    expect(buildKnowledgeQuery('OPENAI_API_KEY=sk-abc123')).toBe('');
    expect(buildKnowledgeQuery('OPENROUTER_API_KEY=sk-abc456')).toBe('');
  });

  it('strips GitHub tokens', () => {
    expect(buildKnowledgeQuery('github_pat_abc123def456ghi789jkl012mno345')).toBe('');
  });

  it('strips PEM private key markers', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nABC123\n-----END PRIVATE KEY-----';
    expect(buildKnowledgeQuery(pem)).toBe('');
  });

  it('strips apiKey JSON field', () => {
    const result = buildKnowledgeQuery('config with apiKey: sk-abc123def456ghi789jkl012');
    expect(result).toBe('config with');
  });

  it('strips authorization header', () => {
    const result = buildKnowledgeQuery(
      'Authorization: Bearer abc123def456ghi789jkl012mno345pqr678stu901',
    );
    expect(result).toBe('');
  });

  it('preserves normal words beginning with sk', () => {
    const result = buildKnowledgeQuery('What is a skill and skillfully doing things?');
    expect(result).toContain('skill');
    expect(result).toContain('skillfully');
  });

  it('preserves technical identifiers around credentials', () => {
    const result = buildKnowledgeQuery('What is the ERC-20 contract address?');
    expect(result).toBe('What is the ERC-20 contract address?');
  });

  it('does not mutate input', () => {
    const input = 'Test task';
    const result = buildKnowledgeQuery(input);
    expect(input).toBe('Test task'); // Original unchanged
    expect(result).toBe('Test task'); // Result matches
  });

  it('Persian surrounding text remains usable after credential strip', () => {
    const result = buildKnowledgeQuery('رمز ارز اتریوم با sk-proj-test1234567890 چیست؟');
    expect(result).toContain('رمز');
    expect(result).toContain('ارز');
    expect(result).toContain('اتریوم');
    expect(result).toContain('چیست');
    expect(result).not.toContain('sk-proj');
  });
});

describe('isValidRetrievalQuery', () => {
  it('returns false for empty', () => {
    expect(isValidRetrievalQuery('')).toBe(false);
  });

  it('returns false for whitespace only', () => {
    expect(isValidRetrievalQuery('   ')).toBe(false);
  });

  it('returns false for punctuation only', () => {
    expect(isValidRetrievalQuery('!!! ???')).toBe(false);
  });

  it('returns true for English word', () => {
    expect(isValidRetrievalQuery('capital')).toBe(true);
  });

  it('returns true for Persian word', () => {
    expect(isValidRetrievalQuery('پایتخت')).toBe(true);
  });

  it('returns true for mixed language', () => {
    expect(isValidRetrievalQuery('What is قیمت')).toBe(true);
  });

  it('returns true for technical identifier', () => {
    expect(isValidRetrievalQuery('ERC-20')).toBe(true);
    expect(isValidRetrievalQuery('GPT-4')).toBe(true);
  });
});
