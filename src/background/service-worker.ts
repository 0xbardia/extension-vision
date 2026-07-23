import {
  getSettings,
  setCurrentSolveState,
  getCurrentSolveState,
} from '../storage/settings.storage';
import { providerFactory } from '../providers/provider-factory';
import { AppError, errorInfo, userMessage } from '../utils/errors';
import { isKnownProtectedUrl, resolveTargetTab, tabProtocol } from './target-tab';
import { openPanelFromUserGesture } from './command-flow';
import { buildVisionPrompt } from '../prompt/default-prompt';
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'solve-visible-page')
    openPanelFromUserGesture(
      tab,
      (windowId) => chrome.sidePanel.open({ windowId }),
      () => startSolve({ preferredTab: tab }),
      recordPanelOpenError,
    );
});
chrome.runtime.onMessage.addListener((m, s, send) => {
  if (m?.type === 'SOLVE_CURRENT_PAGE') {
    startSolve()
      .then(() => send({ ok: true }))
      .catch(() => send({ ok: false }));
    return true;
  }
  if (m?.type === 'GET_SOLVE_STATE') {
    getCurrentSolveState().then((state) => send({ state }));
    return true;
  }
  return false;
});
async function recordPanelOpenError(error: unknown) {
  const requestId = crypto.randomUUID();
  const detail = error instanceof Error ? error.message : 'sidePanel.open rejected';
  const failure = new AppError(
    'SIDE_PANEL_OPEN_FAILED',
    'باز کردن Side Panel ممکن نشد.',
    detail,
    'side panel opening',
  );
  const info = errorInfo(failure);
  await setCurrentSolveState({
    status: 'error',
    requestId,
    error: userMessage(failure),
    errorInfo: info,
  });
}

async function startSolve(options: { preferredTab?: chrome.tabs.Tab } = {}) {
  const requestId = crypto.randomUUID();
  let providerName: 'OpenAI' | 'OpenRouter' = 'OpenRouter';
  const started = Date.now();
  const log = (stage: string, tab?: chrome.tabs.Tab) =>
    console.info(
      '[solve]',
      stage,
      Date.now() - started,
      'ms',
      tab ? { tabId: tab.id, windowId: tab.windowId, protocol: tabProtocol(tab.url) } : '',
    );
  log('solve requested');
  await setCurrentSolveState({ status: 'loading', requestId, startedAt: Date.now() });
  try {
    let tab: chrome.tabs.Tab;
    try {
      tab = await resolveTargetTab(options.preferredTab);
    } catch (e) {
      throw new AppError(
        'CAPTURE_FAILED',
        'تب فعال قابل استفاده نیست.',
        e instanceof Error ? e.message : 'target tab resolution failed',
        'target tab resolution',
      );
    }
    log('target tab resolution', tab);
    if (isKnownProtectedUrl(tab.url, chrome.runtime.id))
      throw new AppError(
        'RESTRICTED_PAGE',
        'گرفتن اسکرین‌شات از این صفحه توسط Chrome مجاز نیست.',
        'known protected browser page',
        'tab validation',
      );
    log('tab validation', tab);
    const settings = await getSettings();
    log('settings loaded');
    providerName = settings.provider === 'openai' ? 'OpenAI' : 'OpenRouter';
    const key = settings.provider === 'openai' ? settings.openAiApiKey : settings.openRouterApiKey;
    const model = settings.provider === 'openai' ? settings.openAiModel : settings.openRouterModel;
    if (!key)
      throw new AppError(
        'API_KEY_MISSING',
        `کلید API برای ${settings.provider === 'openai' ? 'OpenAI' : 'OpenRouter'} وارد نشده است.`,
        'settings validation',
        providerName,
      );
    if (!model) throw new AppError('MODEL_MISSING', 'مدل Vision را وارد کنید.');
    if (!settings.prompt.trim())
      throw new AppError('PROMPT_MISSING', 'متن prompt نمی‌تواند خالی باشد.');
    let image: string;
    try {
      image = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'jpeg',
        quality: settings.imageQuality,
      });
    } catch (e) {
      throw new AppError(
        'CAPTURE_FAILED',
        'گرفتن اسکرین‌شات از این صفحه ممکن نیست.',
        e instanceof Error ? e.message : 'captureVisibleTab failed',
        'screenshot capture',
      );
    }
    log('screenshot capture', tab);
    log('provider request started');
    const answer = await providerFactory(settings.provider).solveScreenshot({
      screenshotDataUrl: image,
      prompt: buildVisionPrompt(settings.prompt),
      model,
      apiKey: key,
      timeoutMs: settings.requestTimeoutMs,
    });
    const current = await getCurrentSolveState();
    if (current.requestId === requestId) {
      log('response parsed and schema validated');
      await setCurrentSolveState({ status: 'success', requestId, answer });
      log('state stored');
    }
  } catch (e) {
    const current = await getCurrentSolveState();
    if (current.requestId === requestId) {
      const info = errorInfo(e, providerName);
      console.error('[solve]', info);
      await setCurrentSolveState({
        status: 'error',
        requestId,
        error: userMessage(e),
        errorInfo: info,
      });
      log('state stored');
    }
  }
}
