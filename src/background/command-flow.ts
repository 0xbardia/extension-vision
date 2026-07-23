export type CommandTab = { id?: number; windowId?: number };
export function openPanelFromUserGesture(
  tab: CommandTab | undefined,
  openPanel: (windowId: number) => Promise<void>,
  startSolve: () => Promise<void>,
  recordOpenError: (error: unknown) => Promise<void>,
): void {
  if (tab?.windowId == null) {
    void recordOpenError(new Error('Command did not include a windowId'));
    return;
  }
  const openPromise = openPanel(tab.windowId);
  void openPromise.then(startSolve).catch(recordOpenError);
}
