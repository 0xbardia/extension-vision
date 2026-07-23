import type { ProviderId } from '../types';
import type { VisionProvider } from './provider.interface';
import { OpenAIProvider } from './openai.provider';
import { OpenRouterProvider } from './openrouter.provider';
export function providerFactory(id: ProviderId): VisionProvider {
  return id === 'openai' ? new OpenAIProvider() : new OpenRouterProvider();
}
