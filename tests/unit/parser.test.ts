import { describe, it, expect } from 'vitest';
import { parseAnswer } from '../../src/vision/response-parser';
describe('response parser', () => {
  const good = JSON.stringify({
    found: true,
    question: 'Q',
    type: 'multiple_choice',
    answer: 'B',
    answerText: 'Blue',
    explanation: 'Reason',
    confidence: 0.95,
  });
  it('parses JSON and fences', () => {
    expect(parseAnswer(good).answer).toBe('B');
    expect(parseAnswer('```json\n' + good + '\n```').confidence).toBe(0.95);
  });
  it('extracts surrounding text', () => {
    expect(parseAnswer('Here: ' + good).question).toBe('Q');
  });
  it('normalizes percentages', () => {
    expect(parseAnswer(good.replace('"confidence":0.95', '"confidence":95')).confidence).toBe(0.95);
  });
  it('rejects invalid', () => {
    expect(() => parseAnswer('{}')).toThrow();
  });
});
