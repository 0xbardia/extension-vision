import { parseAnswer } from '../vision/response-parser';
import { AppError } from '../utils/errors';
import type { VisionProvider, SolveInput } from './provider.interface';

export class OpenAIProvider implements VisionProvider {
  async solveScreenshot(i: SolveInput) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), i.timeoutMs);
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${i.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: i.model,
          input: [
            {
              role: 'user',
              content: [
                { type: 'input_text', text: i.prompt },
                { type: 'input_image', image_url: i.screenshotDataUrl, detail: 'high' },
              ],
            },
          ],
          temperature: 0,
          max_output_tokens: 300,
        }),
        signal: i.signal ?? controller.signal,
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new AppError(
          response.status === 401
            ? 'PROVIDER_AUTH'
            : response.status === 429
              ? 'PROVIDER_RATE_LIMIT'
              : response.status === 404
                ? 'PROVIDER_MODEL'
                : 'PROVIDER_RESPONSE',
          response.status === 401
            ? 'احراز هویت OpenAI ناموفق بود.'
            : response.status === 404
              ? 'مدل OpenAI پیدا نشد یا ورودی تصویر را پشتیبانی نمی‌کند.'
              : 'OpenAI پاسخ نامعتبر داد.',
          safeDetail(body),
          'provider response',
          'OpenAI',
          response.status,
        );
      const text =
        typeof (body as { output_text?: unknown }).output_text === 'string'
          ? (body as { output_text: string }).output_text
          : extractText(body);
      if (!text.trim())
        throw new AppError(
          'PROVIDER_RESPONSE',
          'پاسخ OpenAI خالی بود.',
          'response output was empty',
          'response extraction',
          'OpenAI',
          response.status,
        );
      return parseAnswer(text);
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (e instanceof DOMException && e.name === 'AbortError')
        throw new AppError(
          'PROVIDER_TIMEOUT',
          'درخواست بیش از حد طول کشید. دوباره تلاش کنید.',
          'AbortController timeout',
          'provider request',
          'OpenAI',
        );
      throw new AppError(
        'PROVIDER_NETWORK',
        'ارتباط با OpenAI برقرار نشد.',
        e instanceof Error ? e.message.slice(0, 240) : 'network failure',
        'provider request',
        'OpenAI',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
function extractText(body: unknown): string {
  const output = (body as { output?: unknown[] })?.output;
  return Array.isArray(output)
    ? output
        .flatMap((x) =>
          Array.isArray((x as { content?: unknown[] })?.content)
            ? (x as { content: { text?: string }[] }).content.map((c) => c.text ?? '')
            : [],
        )
        .join('')
    : '';
}
function safeDetail(body: unknown): string {
  const message = (body as { error?: { message?: unknown } })?.error?.message;
  return typeof message === 'string' ? message.slice(0, 240) : 'provider returned an error payload';
}
