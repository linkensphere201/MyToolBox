export type GitSyncState = 'synced' | 'ahead' | 'behind' | 'diverged' | 'no-upstream' | 'unknown';

export type GitStatusSummary = {
  branch: string;
  upstream?: string;
  syncState: GitSyncState;
  aheadCount: number;
  behindCount: number;
  shortStatus: string;
  clean: boolean;
};

export function parseGitStatusSummary(output: string): GitStatusSummary {
  const lines = output.replace(/\r/g, '').split('\n');
  let branch = 'HEAD';
  let upstream: string | undefined;
  let aheadCount = 0;
  let behindCount = 0;
  const shortLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith('# branch.head ')) {
      branch = trimmed.slice('# branch.head '.length).trim() || 'HEAD';
      continue;
    }

    if (trimmed.startsWith('# branch.upstream ')) {
      upstream = trimmed.slice('# branch.upstream '.length).trim() || undefined;
      continue;
    }

    if (trimmed.startsWith('# branch.ab ')) {
      const match = trimmed.match(/^# branch\.ab \+(\d+) \-(\d+)$/);
      if (match) {
        aheadCount = Number(match[1]);
        behindCount = Number(match[2]);
      }
      continue;
    }

    if (!trimmed.startsWith('# ')) {
      shortLines.push(trimmed);
    }
  }

  let syncState: GitSyncState = 'unknown';
  if (!upstream) {
    syncState = 'no-upstream';
  } else if (aheadCount > 0 && behindCount > 0) {
    syncState = 'diverged';
  } else if (aheadCount > 0) {
    syncState = 'ahead';
  } else if (behindCount > 0) {
    syncState = 'behind';
  } else {
    syncState = 'synced';
  }

  return {
    branch,
    upstream,
    syncState,
    aheadCount,
    behindCount,
    shortStatus: shortLines.join('\n'),
    clean: shortLines.length === 0
  };
}

export function getKeyProjectSyncLabel(status: Pick<GitStatusSummary, 'syncState' | 'aheadCount' | 'behindCount'>): string {
  switch (status.syncState) {
    case 'synced':
      return 'synced';
    case 'ahead':
      return 'ahead ' + status.aheadCount;
    case 'behind':
      return 'behind ' + status.behindCount;
    case 'diverged':
      return 'diverged +' + status.aheadCount + '/-' + status.behindCount;
    case 'no-upstream':
      return 'no upstream';
    default:
      return 'sync unknown';
  }
}
