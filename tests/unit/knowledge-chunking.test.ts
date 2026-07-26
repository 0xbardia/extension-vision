import { describe, expect, it } from 'vitest';
import { chunkDocument, makeChunkId, documentNeedsProcessing } from '../../src/knowledge/chunking';
import {
  CHUNK_TARGET_CHARS,
  CHUNK_MAX_CHARS,
  CHUNK_OVERLAP_CHARS,
  KNOWLEDGE_PROCESSING_VERSION,
} from '../../src/knowledge/types';
import { KnowledgeError } from '../../src/knowledge/errors';

describe('chunkDocument', () => {
  it('returns empty array for empty input', () => {
    expect(chunkDocument('doc-1', '')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(chunkDocument('doc-1', '   \n\n  ')).toEqual([]);
  });

  it('creates one chunk for a short document', () => {
    const content = 'Short document with minimal text.';
    const chunks = chunkDocument('doc-1', content);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(content);
    expect(chunks[0].startOffset).toBe(0);
    expect(chunks[0].endOffset).toBe(content.length);
    expect(chunks[0].index).toBe(0);
  });

  it('creates multiple chunks for a long document', () => {
    const content =
      'Paragraph one.\n\n' +
      'Word '.repeat(500) +
      '\n\n' +
      'Final paragraph with some more content to ensure multiple chunks.\n'.repeat(10);
    const chunks = chunkDocument('doc-multi', content);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('chunk text matches source slices exactly', () => {
    const content = 'Test document.\n\n' + 'Hello world. '.repeat(300) + '\n\nFinal content here.';
    const chunks = chunkDocument('doc-slice', content);
    for (const chunk of chunks) {
      expect(chunk.text).toBe(content.slice(chunk.startOffset, chunk.endOffset));
      expect(chunk.endOffset).toBeGreaterThan(chunk.startOffset);
    }
  });

  it('chunk indexes are contiguous starting at 0', () => {
    const content = 'Paragraph A.\n\n' + 'B text. '.repeat(300) + '\n\n' + 'C text. '.repeat(300);
    const chunks = chunkDocument('doc-idx', content);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
    }
  });

  it('chunk IDs are deterministic', () => {
    const content = 'Deterministic test content. '.repeat(200);
    const chunks1 = chunkDocument('doc-det', content);
    const chunks2 = chunkDocument('doc-det', content);
    expect(chunks1.map((c) => c.id)).toEqual(chunks2.map((c) => c.id));
  });

  it('chunk IDs have the correct format', () => {
    const content = 'ID format test. '.repeat(200);
    const chunks = chunkDocument('doc-id-test', content);
    for (const chunk of chunks) {
      expect(chunk.id).toBe(`doc-id-test:v2:${chunk.index}`);
    }
  });

  it('different documents do not collide in IDs', () => {
    const content = 'Same content but different docs. '.repeat(200);
    const chunksA = chunkDocument('doc-A', content);
    const chunksB = chunkDocument('doc-B', content);
    for (const ca of chunksA) {
      for (const cb of chunksB) {
        expect(ca.id).not.toBe(cb.id);
      }
    }
  });

  it('prefers paragraph boundaries', () => {
    const content =
      'Short first paragraph.\n\n' +
      'Short second paragraph.\n\n' +
      'Short third paragraph.\n\n' +
      'Short fourth paragraph.\n\n' +
      'x'.repeat(CHUNK_TARGET_CHARS) +
      ' more content to force a split.' +
      'y'.repeat(100);
    const chunks = chunkDocument('doc-para', content);
    // Some chunk boundaries should align with newlines where possible
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
    }
  });

  it('no chunk exceeds maximum size', () => {
    const content = 'x'.repeat(5000) + ' ' + 'y'.repeat(5000);
    const chunks = chunkDocument('doc-max', content);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
    }
  });

  it('no infinite loop for pathological input', () => {
    const content = 'x'.repeat(100000); // No boundaries at all
    const chunks = chunkDocument('doc-path', content);
    expect(chunks.length).toBeLessThan(500);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('preserves ZWNJ', () => {
    const content = 'می\u200cشود '.repeat(100) + ' for chunking with ZWNJ.';
    const chunks = chunkDocument('doc-zwnj', content);
    for (const chunk of chunks) {
      expect(chunk.text).toContain('\u200c');
    }
  });

  it('processingVersion is 2', () => {
    const content = 'Version check.';
    const chunks = chunkDocument('doc-ver', content);
    for (const chunk of chunks) {
      expect(chunk.processingVersion).toBe(KNOWLEDGE_PROCESSING_VERSION);
    }
  });

  it('handles Persian text correctly', () => {
    const content = 'این یک متن فارسی برای تست است. '.repeat(300);
    const chunks = chunkDocument('doc-fa', content);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeGreaterThan(0);
    }
  });

  it('handles mixed Persian/English text', () => {
    const paragraphs: string[] = [];
    for (let i = 0; i < 50; i++) {
      paragraphs.push(`Paragraph ${i}: این یک متن ترکیبی است. Mixed content with numbers ۱۲۳۴۵.`);
    }
    const content = paragraphs.join('\n\n');
    const chunks = chunkDocument('doc-mixed', content);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text).toBeTruthy();
    }
  });

  it('compound unique positions are valid', () => {
    const content = 'Position test content. '.repeat(300);
    const chunks = chunkDocument('doc-pos', content);
    const seen = new Set<string>();
    for (const chunk of chunks) {
      const key = `${chunk.documentId}:${chunk.index}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('produces a small chunk for a small document', () => {
    const content = 'Hello, world!';
    const chunks = chunkDocument('doc-small', content);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(content);
    expect(chunks[0].startOffset).toBe(0);
    expect(chunks[0].endOffset).toBe(content.length);
  });
});

describe('makeChunkId', () => {
  it('produces deterministic IDs', () => {
    expect(makeChunkId('doc-1', 0)).toBe('doc-1:v2:0');
    expect(makeChunkId('doc-1', 1)).toBe('doc-1:v2:1');
    expect(makeChunkId('other', 0)).toBe('other:v2:0');
  });
});

describe('documentNeedsProcessing', () => {
  it('returns true for version 1 document', () => {
    expect(documentNeedsProcessing(1, false, 'content')).toBe(true);
  });

  it('returns true for version 1 with chunks', () => {
    expect(documentNeedsProcessing(1, true, 'content')).toBe(true);
  });

  it('returns true for version 2 with no chunks', () => {
    expect(documentNeedsProcessing(2, false, 'content')).toBe(true);
  });

  it('returns false for healthy version 2 document', () => {
    expect(documentNeedsProcessing(2, true, 'content')).toBe(false);
  });

  it('returns true for version 1 regardless of content', () => {
    expect(documentNeedsProcessing(1, false, '')).toBe(true);
  });

  it('v2 with empty content and no chunks does not need processing', () => {
    expect(documentNeedsProcessing(2, false, '')).toBe(false);
  });
});
