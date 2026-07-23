export type ErrorCode =
  | 'SETTINGS_MISSING'
  | 'API_KEY_MISSING'
  | 'MODEL_MISSING'
  | 'PROMPT_MISSING'
  | 'CAPTURE_FAILED'
  | 'SIDE_PANEL_OPEN_FAILED'
  | 'RESTRICTED_PAGE'
  | 'PROVIDER_AUTH'
  | 'PROVIDER_QUOTA'
  | 'PROVIDER_CREDIT_OR_QUOTA'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_MODEL'
  | 'PROVIDER_MODEL_NOT_FOUND'
  | 'PROVIDER_MODEL_NO_VISION'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_NETWORK'
  | 'PROVIDER_RESPONSE'
  | 'PROVIDER_BAD_REQUEST'
  | 'PROVIDER_EMPTY_RESPONSE'
  | 'RESPONSE_PARSE'
  | 'RESPONSE_SCHEMA'
  | 'UNKNOWN';
export type ErrorInfo = {
  code: ErrorCode;
  message: string;
  detail: string;
  provider?: string;
  stage: string;
  status?: number;
};
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public detail = message,
    public stage = 'unknown',
    public provider?: string,
    public status?: number,
  ) {
    super(message);
  }
}
export function userMessage(e: unknown) {
  if (e instanceof AppError) return e.message;
  return 'خطای غیرمنتظره‌ای رخ داد. دوباره تلاش کنید.';
}
export function errorInfo(e: unknown, provider?: string, stage = 'unknown'): ErrorInfo {
  if (e instanceof AppError)
    return {
      code: e.code,
      message: e.message,
      detail: e.detail.slice(0, 240),
      provider: e.provider ?? provider,
      stage: e.stage === 'unknown' ? stage : e.stage,
      status: e.status,
    };
  return {
    code: 'UNKNOWN',
    message: 'خطای غیرمنتظره‌ای رخ داد. دوباره تلاش کنید.',
    detail: serializeErrorDetail(e),
    provider,
    stage,
  };
}
export function serializeErrorDetail(value: unknown): string {
  if (value instanceof Error) return value.message.slice(0, 240);
  if (typeof value === 'string') return value.slice(0, 240);
  if (value == null) return String(value);
  try {
    return JSON.stringify(value).slice(0, 240);
  } catch {
    return 'Unserializable error';
  }
}
