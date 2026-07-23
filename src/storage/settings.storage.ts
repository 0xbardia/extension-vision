import { DEFAULT_PROMPT } from '../prompt/default-prompt';
import type { Settings, SolveState } from '../types';
import { PRESET_IDS } from '../prompt/presets';
const defaults: Settings = {
  provider: 'openrouter',
  openRouterApiKey: '',
  openRouterModel: '',
  openAiApiKey: '',
  openAiModel: '',
  prompt: DEFAULT_PROMPT,
  requestTimeoutMs: 30000,
  imageQuality: 80,
  selectedPresetId: 'quiz_solver',
  presetOverrides: {},
  customPrompt: '',
  settingsUiExpanded: true,
};
export async function getSettings(): Promise<Settings> {
  const v = await chrome.storage.local.get(defaults);
  const selected = PRESET_IDS.includes(v.selectedPresetId)
    ? v.selectedPresetId
    : typeof v.prompt === 'string' && v.prompt.trim()
      ? 'custom'
      : 'quiz_solver';
  const overrides =
    typeof v.presetOverrides === 'object' && v.presetOverrides ? v.presetOverrides : {};
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
    selectedPresetId: selected,
    presetOverrides: overrides,
    customPrompt:
      typeof v.customPrompt === 'string' && v.customPrompt
        ? v.customPrompt
        : selected === 'custom'
          ? (v.prompt ?? '')
          : '',
    settingsUiExpanded:
      typeof v.settingsUiExpanded === 'boolean'
        ? v.settingsUiExpanded
        : !(v.openRouterApiKey || v.openAiApiKey),
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
