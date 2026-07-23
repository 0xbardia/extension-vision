import { z } from 'zod';
import type { SolveState } from '../types';
export const messageSchema = z.object({
  type: z.enum([
    'SOLVE_CURRENT_PAGE',
    'SOLVE_STATE_CHANGED',
    'GET_SOLVE_STATE',
    'SETTINGS_UPDATED',
  ]),
  state: z.any().optional(),
});
export type Message = {
  type: 'SOLVE_CURRENT_PAGE' | 'GET_SOLVE_STATE' | 'SETTINGS_UPDATED' | 'SOLVE_STATE_CHANGED';
  state?: SolveState;
};
