export type ProviderId = 'openrouter' | 'openai';
export type QuestionType =
  'multiple_choice' | 'true_false' | 'short_answer' | 'page_analysis' | 'unknown';
export type AnswerMode = 'quiz' | 'page_analysis' | 'unknown';
export type VisionAnswer = {
  found: boolean;
  mode: AnswerMode;
  question: string;
  type: QuestionType;
  answer: string;
  answerText: string | null;
  explanation: string;
  confidence: number;
};
export type Settings = {
  provider: ProviderId;
  openRouterApiKey: string;
  openRouterModel: string;
  openAiApiKey: string;
  openAiModel: string;
  prompt: string;
  requestTimeoutMs: number;
  imageQuality: number;
  selectedPresetId: string;
  presetOverrides: Record<string, string>;
  customPrompt: string;
  settingsUiExpanded: boolean;
};
export type SolveState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  requestId: string;
  answer?: VisionAnswer;
  error?: string;
  errorInfo?: { code: string; detail: string; provider?: string; stage: string; status?: number };
  startedAt?: number;
  stage?:
    | 'preparing'
    | 'capturing'
    | 'sending'
    | 'analyzing'
    | 'parsing'
    | 'completed'
    | 'cancelling'
    | 'cancelled';
  timings?: {
    captureDurationMs?: number;
    providerDurationMs?: number;
    parseDurationMs?: number;
    totalDurationMs?: number;
  };
  metadata?: { provider: string; model: string };
  previous?: {
    answer: VisionAnswer;
    metadata?: SolveState['metadata'];
    timings?: SolveState['timings'];
  };
};
