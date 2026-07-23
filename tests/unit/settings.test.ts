import { it, expect } from 'vitest';
import { DEFAULT_PROMPT } from '../../src/prompt/default-prompt';
it('has a nonempty safe default prompt', () => expect(DEFAULT_PROMPT.length).toBeGreaterThan(100));
