import { describe, expect, it, vi } from 'vitest';
import { openPanelFromUserGesture } from '../../src/background/command-flow';
describe('command panel flow', () => {
  it('opens synchronously before solve', async () => {
    const order: string[] = [];
    const open = vi.fn((id: number) => {
      order.push(`open:${id}`);
      return Promise.resolve();
    });
    const start = vi.fn(async () => {
      order.push('start');
    });
    openPanelFromUserGesture({ windowId: 9 }, open, start, vi.fn());
    expect(order).toEqual(['open:9']);
    await vi.waitFor(() => expect(order).toEqual(['open:9', 'start']));
  });
  it('records panel failures', async () => {
    const record = vi.fn(async () => {});
    openPanelFromUserGesture(
      { windowId: 9 },
      () => Promise.reject(new Error('gesture')),
      vi.fn(),
      record,
    );
    await vi.waitFor(() => expect(record).toHaveBeenCalled());
  });
  it('does not start without a command window', () => {
    const start = vi.fn();
    const record = vi.fn();
    openPanelFromUserGesture({}, vi.fn(), start, record);
    expect(start).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalled();
  });
});
