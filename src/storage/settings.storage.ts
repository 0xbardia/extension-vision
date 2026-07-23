import { DEFAULT_PROMPT } from '../prompt/default-prompt';
import type { Settings, SolveState } from '../types';
const defaults: Settings = {
  provider: 'openrouter',
  openRouterApiKey: '',
  openRouterModel: '',
  openAiApiKey: '',
  openAiModel: '',
  prompt: DEFAULT_PROMPT,
  requestTimeoutMs: 30000,
  imageQuality: 80,
};
export async function getSettings(): Promise<Settings> {
  const v = await chrome.storage.local.get(defaults);
  return {
    ...defaults,
    ...v,
    openRouterApiKey:
      typeof v.openRouterApiKey === 'string' && !/^•+$/.test(v.openRouterApiKey)
        ? v.openRouterApiKey
        : '',
    openAiApiKey:
      typeof v.openAiApiKey === 'string' && !/^•+$/.test(v.openAiApiKey) ? v.openAiApiKey : '',
    provider: v.provider === 'openai' ? 'openai' : 'openrouter',
    requestTimeoutMs:
      typeof v.requestTimeoutMs === 'number' && v.requestTimeoutMs >= 5000
        ? v.requestTimeoutMs
        : defaults.requestTimeoutMs,
    imageQuality:
      typeof v.imageQuality === 'number' && v.imageQuality >= 1 && v.imageQuality <= 100
        ? v.imageQuality
        : defaults.imageQuality,
  };
}
export async function saveSettings(v: Partial<Settings>) {
  const s = { ...defaults, ...(await getSettings()), ...v };
  await chrome.storage.local.set(s);
}
export async function getCurrentSolveState(): Promise<SolveState> {
  return (
    (await chrome.storage.session.get('solveState')).solveState ?? { status: 'idle', requestId: '' }
  );
}
export async function setCurrentSolveState(s: SolveState) {
  await chrome.storage.session.set({ solveState: s });
  try {
    await chrome.runtime.sendMessage({ type: 'SOLVE_STATE_CHANGED', state: s });
  } catch {}
}
export async function clearCurrentSolveState() {
  await chrome.storage.session.remove('solveState');
}
