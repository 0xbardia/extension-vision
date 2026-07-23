import { expect, it } from 'vitest';
import { providerFactory } from '../../src/providers/provider-factory';
it('creates OpenRouter without constructing or importing an SDK client', () => {
  const provider = providerFactory('openrouter');
  expect(provider.constructor.name).toBe('OpenRouterProvider');
});
