import { parseAnswer } from '../vision/response-parser';
import { AppError } from '../utils/errors';
import type { VisionProvider, SolveInput } from './provider.interface';
function mapStatus(status: number, detail: string): AppError {
  const common = {
    detail: detail.slice(0, 240),
    stage: 'provider response',
    provider: 'OpenRouter',
    status,
  };
  if (status === 401 || status === 403)
    return new AppError(
      'PROVIDER_AUTH',
      'احراز هویت OpenRouter ناموفق بود.',
      common.detail,
      common.stage,
      common.provider,
      status,
    );
  if (status === 402)
    return new AppError(
      'PROVIDER_QUOTA',
      'اعتبار یا سهمیه OpenRouter کافی نیست.',
      common.detail,
      common.stage,
      common.provider,
      status,
    );
  if (status === 429)
    return new AppError(
      'PROVIDER_RATE_LIMIT',
      'درخواست‌های OpenRouter بیش از حد مجاز است.',
      common.detail,
      common.stage,
      common.provider,
      status,
    );
  if (status === 404)
    return new AppError(
      'PROVIDER_MODEL',
      'مدل OpenRouter پیدا نشد یا ورودی تصویر را پشتیبانی نمی‌کند.',
      common.detail,
      common.stage,
      common.provider,
      status,
    );
  if (status === 400)
    return new AppError(
      'PROVIDER_RESPONSE',
      'درخواست OpenRouter نامعتبر بود.',
      common.detail,
      common.stage,
      common.provider,
      status,
    );
  return new AppError(
    'PROVIDER_RESPONSE',
    'OpenRouter پاسخ نامعتبر داد.',
    common.detail,
    common.stage,
    common.provider,
    status,
  );
}
export class OpenRouterProvider implements VisionProvider {
  async solveScreenshot(i: SolveInput) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), i.timeoutMs);
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${i.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: i.model,
          temperature: 0,
          max_tokens: 250,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: i.prompt },
                { type: 'image_url', image_url: { url: i.screenshotDataUrl } },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      const body: unknown = await r.json().catch(() => ({}));
      if (!r.ok) throw mapStatus(r.status, safeDetail(body));
      const choices = (body as { choices?: unknown }).choices;
      const content = Array.isArray(choices)
        ? (choices[0] as { message?: { content?: unknown } })?.message?.content
        : undefined;
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .map((x) => (typeof x === 'string' ? x : ((x as { text?: string })?.text ?? '')))
                .join('')
            : '';
      if (!text.trim())
        throw new AppError(
          'PROVIDER_RESPONSE',
          'پاسخ OpenRouter خالی بود.',
          'choices[0].message.content was empty or unsupported',
          'response extraction',
          'OpenRouter',
          r.status,
        );
      try {
        return parseAnswer(text);
      } catch (e) {
        if (!(e instanceof AppError) || e.code !== 'RESPONSE_PARSE') throw e;
        const repair = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${i.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: i.model,
            temperature: 0,
            max_tokens: 250,
            messages: [
              {
                role: 'user',
                content: `Convert the following model output to exactly one JSON object matching the required schema. Output JSON only, with no fences or prose. Original model output:\n${text}`,
              },
            ],
          }),
          signal: controller.signal,
        });
        const repairBody: unknown = await repair.json().catch(() => ({}));
        if (!repair.ok) throw mapStatus(repair.status, safeDetail(repairBody));
        const repairChoices = (repairBody as { choices?: { message?: { content?: unknown } }[] })
          .choices;
        const repaired = repairChoices?.[0]?.message?.content;
        const repairedText =
          typeof repaired === 'string'
            ? repaired
            : Array.isArray(repaired)
              ? repaired
                  .map((x) => (typeof x === 'string' ? x : ((x as { text?: string })?.text ?? '')))
                  .join('')
              : '';
        if (!repairedText.trim())
          throw new AppError(
            'RESPONSE_PARSE',
            'پاسخ اصلاح‌شده خالی بود.',
            'repair response empty',
            'JSON parsing',
            'OpenRouter',
            repair.status,
          );
        return parseAnswer(repairedText);
      }
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (e instanceof DOMException && e.name === 'AbortError')
        throw new AppError(
          'PROVIDER_TIMEOUT',
          'درخواست بیش از حد طول کشید. دوباره تلاش کنید.',
          'AbortController timeout',
          'provider request',
          'OpenRouter',
        );
      throw new AppError(
        'PROVIDER_NETWORK',
        'ارتباط با OpenRouter برقرار نشد.',
        e instanceof Error ? e.message : 'network failure',
        'provider request',
        'OpenRouter',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
function safeDetail(body: unknown) {
  const x = body as { error?: { message?: string } };
  return typeof x?.error?.message === 'string'
    ? x.error.message
    : 'provider returned an error payload';
}
