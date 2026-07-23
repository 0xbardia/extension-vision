import { answerSchema } from './answer.schema';
import type { VisionAnswer } from '../types';
import { AppError } from '../utils/errors';
export function parseAnswer(raw: string): VisionAnswer {
  if (!raw.trim())
    throw new AppError(
      'RESPONSE_PARSE',
      'پاسخ مدل خالی بود.',
      'empty response',
      'response extraction',
    );
  const s = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let value: unknown;
  try {
    value = JSON.parse(s);
  } catch {
    const a = s.indexOf('{'),
      b = s.lastIndexOf('}');
    if (a < 0 || b <= a)
      throw new AppError(
        'RESPONSE_PARSE',
        'پاسخ مدل JSON معتبر نداشت.',
        'no unambiguous JSON object',
        'JSON parsing',
      );
    try {
      value = JSON.parse(s.slice(a, b + 1));
    } catch {
      throw new AppError(
        'RESPONSE_PARSE',
        'پاسخ مدل JSON معتبر نداشت.',
        'invalid JSON syntax',
        'JSON parsing',
      );
    }
  }
  const r = answerSchema.safeParse(value);
  if (!r.success)
    throw new AppError(
      'RESPONSE_SCHEMA',
      'ساختار پاسخ مدل معتبر نبود.',
      r.error.issues.map((x) => x.path.join('.') + ': ' + x.message).join('; '),
      'schema validation',
    );
  return r.data;
}
