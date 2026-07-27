import {
  getSettings,
  setCurrentSolveState,
  getCurrentSolveState,
} from '../storage/settings.storage';
import { providerFactory } from '../providers/provider-factory';
import { AppError, errorInfo, userMessage } from '../utils/errors';
import { isKnownProtectedUrl, resolveTargetTab, tabProtocol } from './target-tab';
import { openPanelFromUserGesture } from './command-flow';
import { buildFinalPrompt } from '../prompt/default-prompt';
import { PRESETS } from '../prompt/presets';
import { buildKnowledgeContext } from '../knowledge/context-builder';
import { SOLVE_KNOWLEDGE_USAGE_EVENT } from '../knowledge/types';
import type { KnowledgeSolveUsageMessage } from '../knowledge/types';
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
let activeController: AbortController | undefined;
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
  if (m?.type === 'CANCEL_SOLVE') {
    activeController?.abort();
    send({ ok: true });
    return false;
  }
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
  const controller = new AbortController();
  activeController = controller;
  const previousState = await getCurrentSolveState();
  const requestId = crypto.randomUUID();
  let providerName: 'OpenAI' | 'OpenRouter' = 'OpenRouter';
  const started = performance.now();
  const log = (stage: string, tab?: chrome.tabs.Tab) =>
    console.info(
      '[solve]',
      stage,
      Date.now() - started,
      'ms',
      tab ? { tabId: tab.id, windowId: tab.windowId, protocol: tabProtocol(tab.url) } : '',
    );
  log('solve requested');
  await setCurrentSolveState({
    status: 'loading',
    requestId,
    startedAt: Date.now(),
    stage: 'preparing',
  });
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
    await setCurrentSolveState({ status: 'loading', requestId, stage: 'capturing' });
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
    await setCurrentSolveState({ status: 'loading', requestId, stage: 'sending' });
    log('provider request started');
    const effectiveInstruction =
      settings.presetOverrides[settings.selectedPresetId] ??
      (settings.customPrompt || settings.prompt);

    // ── Local Knowledge integration (Phase 3) ────────────────────
    let knowledgeBlock = '';
    const presetInstruction =
      PRESETS[settings.selectedPresetId as keyof typeof PRESETS]?.instruction ?? '';
    let knowledgeMeta: import('../knowledge/types').SolveKnowledgeMetadata | undefined;

    try {
      const knowledgeStartedAt = performance.now();
      const context = await buildKnowledgeContext(effectiveInstruction, presetInstruction);
      if (context.status === 'included' && context.text) {
        knowledgeBlock = '\n\n' + context.text;
      }
      knowledgeMeta = {
        included: context.status === 'included',
        status: context.status,
        sourceCount: context.sourceCount,
        chunkCount: context.chunkCount,
        characterCount: context.characterCount,
        buildDurationMs: Math.round(performance.now() - knowledgeStartedAt),
      };

      // Send Solve usage event to Side Panel (non-blocking — must not delay provider)
      const usageStatus = context.status === 'included' ? 'used' : context.status;
      void sendSolveKnowledgeUsage({
        type: SOLVE_KNOWLEDGE_USAGE_EVENT,
        status: usageStatus as KnowledgeSolveUsageMessage['status'],
        requestId,
        included: context.status === 'included',
        sourceCount: context.sourceCount,
        chunkCount: context.chunkCount,
        characterCount: context.characterCount,
        buildDurationMs: knowledgeMeta.buildDurationMs,
      });
    } catch {
      // Knowledge failure never breaks Solve
      knowledgeMeta = {
        included: false,
        status: 'failed',
        sourceCount: 0,
        chunkCount: 0,
        characterCount: 0,
        buildDurationMs: 0,
      };
      void sendSolveKnowledgeUsage({
        type: SOLVE_KNOWLEDGE_USAGE_EVENT,
        status: 'failed',
        requestId,
        included: false,
        sourceCount: 0,
        chunkCount: 0,
        characterCount: 0,
        buildDurationMs: 0,
      });
    }

    // ── Provider request ─────────────────────────────────────────
    log('provider request started', tab);
    const answer = await providerFactory(settings.provider).solveScreenshot({
      screenshotDataUrl: image,
      prompt:
        buildFinalPrompt(
          PRESETS[settings.selectedPresetId as keyof typeof PRESETS]?.instruction ?? '',
          effectiveInstruction,
        ) + knowledgeBlock,
      model,
      apiKey: key,
      timeoutMs: settings.requestTimeoutMs,
      signal: controller.signal,
    });
    const current = await getCurrentSolveState();
    if (current.requestId === requestId) {
      log('response parsed and schema validated');
      await setCurrentSolveState({
        status: 'success',
        requestId,
        answer,
        stage: 'completed',
        metadata: { provider: providerName, model },
        timings: { totalDurationMs: Math.round(performance.now() - started) },
      });
      log('state stored');
    }
  } catch (e) {
    const current = await getCurrentSolveState();
    if (current.requestId === requestId) {
      if (controller.signal.aborted) {
        await setCurrentSolveState({
          status: 'error',
          requestId,
          error: 'درخواست متوقف شد.',
          errorInfo: {
            code: 'REQUEST_CANCELLED',
            detail: 'user cancelled',
            provider: providerName,
            stage: 'cancelling',
          },
          stage: 'cancelled',
        });
        return;
      }
      const info = errorInfo(e, providerName);
      console.error('[solve]', info);
      await setCurrentSolveState({
        status: 'error',
        requestId,
        error: userMessage(e),
        errorInfo: info,
        previous:
          previousState.status === 'success' && previousState.answer
            ? {
                answer: previousState.answer,
                metadata: previousState.metadata,
                timings: previousState.timings,
              }
            : undefined,
      });
      log('state stored');
    }
  }
}

/**
 * Send a Solve knowledge usage event to the Side Panel.
 * This is a fire-and-forget message — failure to deliver does not
 * affect the Solve flow. Uses broadcast to reach any open side panel.
 */
async function sendSolveKnowledgeUsage(msg: KnowledgeSolveUsageMessage): Promise<void> {
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {
    // Side panel may be closed — ignore
  }
}
