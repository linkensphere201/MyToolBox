export type ReverseTunnelServiceDeps = {
  getViewModel: () => Promise<unknown>;
  getSidebarItemsForTest: () => Promise<unknown[]>;
  syncStateFromSystem: () => Promise<boolean>;
  start: (remoteKey: string) => Promise<void>;
  stop: (remoteKey: string) => void;
  resetStatesForTest: () => void;
  getStatesForTest: () => unknown[];
  dispose: () => void;
};

export class ReverseTunnelService {
  constructor(private readonly deps: ReverseTunnelServiceDeps) {}

  getViewModel(): Promise<unknown> {
    return this.deps.getViewModel();
  }

  getSidebarItemsForTest(): Promise<unknown[]> {
    return this.deps.getSidebarItemsForTest();
  }

  syncStateFromSystem(): Promise<boolean> {
    return this.deps.syncStateFromSystem();
  }

  start(remoteKey: string): Promise<void> {
    return this.deps.start(remoteKey);
  }

  stop(remoteKey: string): void {
    this.deps.stop(remoteKey);
  }

  resetStatesForTest(): void {
    this.deps.resetStatesForTest();
  }

  getStatesForTest(): unknown[] {
    return this.deps.getStatesForTest();
  }

  dispose(): void {
    this.deps.dispose();
  }
}
