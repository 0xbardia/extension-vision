import type { VisionAnswer } from '../types';
export type SolveInput = {
  screenshotDataUrl: string;
  prompt: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
};
export interface VisionProvider {
  solveScreenshot(input: SolveInput): Promise<VisionAnswer>;
}
