import { z } from 'zod';
export const answerSchema = z
  .object({
    found: z.boolean(),
    mode: z.enum(['quiz', 'page_analysis', 'unknown']).default('unknown'),
    question: z.string(),
    type: z.enum(['multiple_choice', 'true_false', 'short_answer', 'page_analysis', 'unknown']),
    answer: z.string(),
    answerText: z.string().nullable().default(null),
    explanation: z.string(),
    confidence: z.number().finite(),
  })
  .transform((v) => ({
    ...v,
    question: v.question.trim(),
    answer: v.answer.trim(),
    answerText: v.answerText?.trim() ?? null,
    explanation: v.explanation.trim(),
    confidence: v.confidence > 1 && v.confidence <= 100 ? v.confidence / 100 : v.confidence,
  }))
  .refine((v) => v.confidence >= 0 && v.confidence <= 1, { message: 'confidence must be 0..1' });
