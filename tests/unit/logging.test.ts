import { expect, it } from 'vitest';
import { serializeErrorDetail } from '../../src/utils/errors';
it('never serializes an object as [object Object]', () => {
  expect(serializeErrorDetail({ code: 'X' })).not.toContain('[object Object]');
  expect(serializeErrorDetail(null)).toBe('null');
});
