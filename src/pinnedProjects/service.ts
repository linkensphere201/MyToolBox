export type PinnedProjectsServiceDeps = {
  getViewModel: () => Promise<unknown>;
  refresh: () => Promise<void>;
  invalidateCache: (reason: string) => void;
  openSettings: (workspacePath?: string) => Promise<string>;
  showStatus: (repoName: string) => Promise<string>;
  getSidebarItemsForTest: () => Promise<unknown[]>;
  setWorkspaceOverrideForTest: (workspacePath?: string | null) => Promise<string | null>;
};

export class PinnedProjectsService {
  constructor(private readonly deps: PinnedProjectsServiceDeps) {}

  getViewModel(): Promise<unknown> {
    return this.deps.getViewModel();
  }

  refresh(): Promise<void> {
    return this.deps.refresh();
  }

  invalidateCache(reason: string): void {
    this.deps.invalidateCache(reason);
  }

  openSettings(workspacePath?: string): Promise<string> {
    return this.deps.openSettings(workspacePath);
  }

  showStatus(repoName: string): Promise<string> {
    return this.deps.showStatus(repoName);
  }

  getSidebarItemsForTest(): Promise<unknown[]> {
    return this.deps.getSidebarItemsForTest();
  }

  setWorkspaceOverrideForTest(workspacePath?: string | null): Promise<string | null> {
    return this.deps.setWorkspaceOverrideForTest(workspacePath);
  }
}
