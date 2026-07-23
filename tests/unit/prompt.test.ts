import { expect, it } from 'vitest';
import { buildVisionPrompt } from '../../src/prompt/default-prompt';
it('keeps the JSON contract around custom Persian prose', () => {
  const prompt = buildVisionPrompt('جزئیات این صفحه رو بگو');
  expect(prompt).toContain('جزئیات این صفحه رو بگو');
  expect(prompt).toContain('output only one JSON object');
  expect(prompt).toContain('page_analysis');
});
