import './sidepanel.css';
import { DEFAULT_PROMPT } from '../prompt/default-prompt';
import { getSettings, saveSettings, getCurrentSolveState } from '../storage/settings.storage';
import type { ProviderId, SolveState, Settings } from '../types';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const provider = $<HTMLSelectElement>('provider'),
  key = $<HTMLInputElement>('apiKey'),
  model = $<HTMLInputElement>('model'),
  prompt = $<HTMLTextAreaElement>('prompt'),
  save = $<HTMLButtonElement>('save'),
  solve = $<HTMLButtonElement>('solve');
const fields = {
  openrouter: { key: 'openRouterApiKey', model: 'openRouterModel' },
  openai: { key: 'openAiApiKey', model: 'openAiModel' },
} as const;
let settings: Settings;
const drafts: Partial<Record<ProviderId, { key: string; model: string }>> = {};
async function load() {
  settings = await getSettings();
  provider.value = settings.provider;
  renderProvider();
  prompt.value = settings.prompt;
  render(await getCurrentSolveState());
}
function currentProvider() {
  return provider.value as ProviderId;
}
function renderProvider() {
  const id = currentProvider(),
    field = fields[id],
    draft = drafts[id];
  key.value = draft?.key ?? settings[field.key];
  model.value = draft?.model ?? settings[field.model];
}
function draftCurrent() {
  drafts[currentProvider()] = { key: key.value, model: model.value };
}
provider.onchange = () => {
  draftCurrent();
  renderProvider();
};
$('toggleKey').onclick = () => {
  const value = key.value;
  key.type = key.type === 'password' ? 'text' : 'password';
  key.value = value;
  $('toggleKey').textContent = key.type === 'password' ? 'Show' : 'Hide';
};
$('reset').onclick = () => {
  prompt.value = DEFAULT_PROMPT;
};
async function saveCurrentForm() {
  const id = currentProvider(),
    field = fields[id];
  const next = {
    ...settings,
    provider: id,
    [field.key]: key.value.trim(),
    [field.model]: model.value.trim(),
    prompt: prompt.value,
  };
  await saveSettings(next);
  settings = await getSettings();
  drafts[id] = { key: settings[field.key], model: settings[field.model] };
  const verified = await getSettings();
  if (!verified[field.key]) throw new Error('Selected API key did not persist');
  console.info('[settings saved]', {
    provider: id,
    hasApiKey: Boolean(verified[field.key]),
    modelPresent: Boolean(verified[field.model]),
    promptPresent: Boolean(verified.prompt.trim()),
  });
  $('saved').textContent = 'Saved';
  setTimeout(() => {
    $('saved').textContent = '';
  }, 1800);
}
save.onclick = () => {
  void saveCurrentForm().catch(() => {
    $('saved').textContent = 'Save failed';
  });
};
solve.onclick = async () => {
  try {
    await saveCurrentForm();
    await chrome.runtime.sendMessage({ type: 'SOLVE_CURRENT_PAGE' });
  } catch {
    $('saved').textContent = 'Save settings first';
  }
};
$('retry').onclick = () => {
  void solve.click();
};
chrome.runtime.onMessage.addListener((m) => {
  if (m?.type === 'SOLVE_STATE_CHANGED') void render(m.state);
});
async function render(s: SolveState) {
  const busy = s.status === 'loading';
  solve.disabled = busy;
  $('retry').toggleAttribute('disabled', busy);
  $('loading').hidden = !busy;
  $('result').hidden = s.status !== 'success';
  $('error').hidden = s.status !== 'error';
  $('status').textContent = busy
    ? 'Reading the visible page…'
    : s.status === 'idle'
      ? 'Ready when you are.'
      : s.status === 'success'
        ? 'Answer ready.'
        : '';
  if (s.status === 'error') {
    $('errorText').textContent = s.error ?? 'Unknown error';
    const x = s.errorInfo;
    $('errorDetails').textContent = x
      ? [
          `Code: ${x.code}`,
          `Provider: ${x.provider ?? '—'}`,
          `Stage: ${x.stage}`,
          x.status ? `HTTP: ${x.status}` : '',
          x.detail,
        ]
          .filter(Boolean)
          .join('\n')
      : '';
  }
  if (s.status === 'success' && s.answer) {
    const a = s.answer;
    $('answer').textContent = a.answer || 'No answer found';
    $('question').textContent = a.question || 'Not found';
    $('type').textContent = a.type;
    $('answerText').textContent = a.answerText ?? '—';
    $('explanation').textContent = a.explanation;
    $('confidence').textContent = `${Math.round(a.confidence * 100)}%`;
    const w = $('warning');
    w.hidden = a.found && a.confidence >= 0.7;
    w.textContent = a.found
      ? 'Confidence is low. Verify this answer.'
      : 'No readable question was found.';
  }
}
void load();
