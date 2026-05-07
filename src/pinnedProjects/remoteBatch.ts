export type BatchedSshKeyProjectResult = {
  configuredRepoName: string;
  repoPath: string;
  remoteUrl: string;
  fetchError: string;
  statusOutput: string;
  error: string;
};

type RemoteBatchConfig = {
  rootDir: string;
  repoNames: string[];
  mode: 'local' | 'ssh';
};

export function quotePosixShellArg(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}

export function buildRemoteGitCommand(repoPath: string, args: string[]): string {
  return ['git', '-C', quotePosixShellArg(repoPath), ...args].join(' ');
}

export function getKeyProjectRefreshConcurrency(config: RemoteBatchConfig): number {
  return config.mode === 'ssh' ? 4 : 4;
}

export function getRemoteKeyProjectsBatchToken(): string {
  return `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2, 10)}`;
}

export function getRemoteKeyProjectsScriptPath(token: string): string {
  return `/tmp/mytoolbox-key-projects-script-${token}.sh`;
}

export function getRemoteKeyProjectsRunDir(token: string): string {
  return `/tmp/mytoolbox-key-projects-run-${token}`;
}

export function buildRemoteKeyProjectsBatchScript(config: RemoteBatchConfig, remoteRunDir: string): string {
  const repoSpecs = config.repoNames
    .map((repoName, index) => `${index}|${repoName}`)
    .join('\n');
  const jobs = String(Math.max(1, Math.min(getKeyProjectRefreshConcurrency(config), config.repoNames.length || 1)));

  return [
    '#!/bin/sh',
    'set -eu',
    'ROOT_DIR=' + quotePosixShellArg(config.rootDir.replace(/\\/g, '/')),
    'JOBS=' + quotePosixShellArg(jobs),
    'RUN_DIR="${KEY_PROJECTS_RUN_DIR:-' + remoteRunDir.replace(/"/g, '\"') + '}"',
    'REPO_SPECS_FILE="$RUN_DIR/repo-specs.txt"',
    'mkdir -p "$RUN_DIR"',
    "cat <<'__MYTB_REPO_SPECS__' > \"$REPO_SPECS_FILE\"",
    repoSpecs,
    '__MYTB_REPO_SPECS__',
    'run_repo() {',
    '  idx="$1"',
    '  repo_name="$2"',
    '  out_file="$RUN_DIR/$idx.out"',
    '  repo_path="$ROOT_DIR"',
    '  if [ "$repo_name" != "." ]; then',
    '    repo_path="$ROOT_DIR/$repo_name"',
    '  fi',
    '  remote_url=""',
    '  fetch_error=""',
    '  status_output=""',
    '  error_message=""',
    '  if remote_url=$(git -C "$repo_path" config --get remote.origin.url 2>/dev/null); then',
    '    :',
    '  else',
    '    remote_url=""',
    '  fi',
    '  fetch_tmp="$RUN_DIR/$idx.fetch.err"',
    '  if git -C "$repo_path" fetch --prune --quiet > /dev/null 2>"$fetch_tmp"; then',
    '    :',
    '  else',
    '    fetch_error=$(cat "$fetch_tmp")',
    '  fi',
    '  status_tmp="$RUN_DIR/$idx.status.out"',
    '  if git -C "$repo_path" status --porcelain=v2 --branch >"$status_tmp" 2>&1; then',
    '    status_output=$(cat "$status_tmp")',
    '  else',
    '    error_message=$(cat "$status_tmp")',
    '  fi',
    '  {',
    '    printf "%s\n" "__MYTB_BEGIN__ $idx $repo_name"',
    '    printf "%s\n" "__MYTB_FIELD__ repoPath"',
    '    printf "%s\n" "$repo_path"',
    '    printf "%s\n" "__MYTB_END_FIELD__ repoPath"',
    '    printf "%s\n" "__MYTB_FIELD__ remoteUrl"',
    '    printf "%s\n" "$remote_url"',
    '    printf "%s\n" "__MYTB_END_FIELD__ remoteUrl"',
    '    printf "%s\n" "__MYTB_FIELD__ fetchError"',
    '    printf "%s\n" "$fetch_error"',
    '    printf "%s\n" "__MYTB_END_FIELD__ fetchError"',
    '    printf "%s\n" "__MYTB_FIELD__ error"',
    '    printf "%s\n" "$error_message"',
    '    printf "%s\n" "__MYTB_END_FIELD__ error"',
    '    printf "%s\n" "__MYTB_FIELD__ status"',
    '    printf "%s\n" "$status_output"',
    '    printf "%s\n" "__MYTB_END_FIELD__ status"',
    '    printf "%s\n" "__MYTB_END__ $idx $repo_name"',
    '  } > "$out_file"',
    '}',
    'activeJobs=0',
    'while IFS="|" read -r idx repo_name; do',
    '  [ -n "$idx" ] || continue',
    '  run_repo "$idx" "$repo_name" &',
    '  activeJobs=$((activeJobs + 1))',
    '  if [ "$activeJobs" -ge "$JOBS" ]; then',
    '    wait',
    '    activeJobs=0',
    '  fi',
    'done < "$REPO_SPECS_FILE"',
    'wait',
    'while IFS="|" read -r idx repo_name; do',
    '  [ -n "$idx" ] || continue',
    '  cat "$RUN_DIR/$idx.out"',
    'done < "$REPO_SPECS_FILE"'
  ].join('\n') + '\n';
}

export function buildRemoteKeyProjectsBootstrapCommand(remoteScriptPath: string, remoteRunDir: string): string {
  return `sh -s -- ${quotePosixShellArg(remoteScriptPath)} ${quotePosixShellArg(remoteRunDir)}`;
}

export function buildRemoteKeyProjectsBootstrapScript(batchScript: string): string {
  return [
    '#!/bin/sh',
    'set -eu',
    'remote_script_path="$1"',
    'remote_run_dir="$2"',
    'mkdir -p "$remote_run_dir"',
    "cat > \"$remote_script_path\" <<'__MYTB_REMOTE_BATCH_SCRIPT__'",
    batchScript.replace(/\r/g, '').replace(/\n$/, ''),
    '__MYTB_REMOTE_BATCH_SCRIPT__',
    'chmod +x "$remote_script_path"',
    'KEY_PROJECTS_RUN_DIR="$remote_run_dir" "$remote_script_path"'
  ].join('\n') + '\n';
}

export function parseBatchedSshKeyProjectResults(output: string): Map<string, BatchedSshKeyProjectResult> {
  const lines = output.replace(/\r/g, '').split('\n');
  const results = new Map<string, BatchedSshKeyProjectResult>();
  let currentRepoName: string | null = null;
  let currentField: keyof Omit<BatchedSshKeyProjectResult, 'configuredRepoName'> | null = null;
  let currentFieldLines: string[] = [];
  let currentResult: BatchedSshKeyProjectResult | null = null;

  const commitField = (): void => {
    if (!currentResult || !currentField) {
      return;
    }

    currentResult[currentField] = currentFieldLines.join('\n').replace(/\n+$/g, '');
    currentField = null;
    currentFieldLines = [];
  };

  for (const line of lines) {
    const beginMatch = line.match(/^__MYTB_BEGIN__\s+(\d+)\s+(.*)$/);
    if (beginMatch) {
      currentRepoName = beginMatch[2];
      currentResult = {
        configuredRepoName: currentRepoName,
        repoPath: '',
        remoteUrl: '',
        fetchError: '',
        statusOutput: '',
        error: ''
      };
      currentField = null;
      currentFieldLines = [];
      continue;
    }

    const fieldMatch = line.match(/^__MYTB_FIELD__\s+(repoPath|remoteUrl|fetchError|error|status)$/);
    if (fieldMatch && currentResult) {
      commitField();
      const fieldName = fieldMatch[1] === 'status' ? 'statusOutput' : fieldMatch[1];
      currentField = fieldName as keyof Omit<BatchedSshKeyProjectResult, 'configuredRepoName'>;
      currentFieldLines = [];
      continue;
    }

    const endFieldMatch = line.match(/^__MYTB_END_FIELD__\s+(repoPath|remoteUrl|fetchError|error|status)$/);
    if (endFieldMatch && currentResult) {
      commitField();
      continue;
    }

    const endMatch = line.match(/^__MYTB_END__\s+(\d+)\s+(.*)$/);
    if (endMatch && currentResult && currentRepoName) {
      commitField();
      results.set(currentRepoName, currentResult);
      currentRepoName = null;
      currentResult = null;
      continue;
    }

    if (currentField) {
      currentFieldLines.push(line);
    }
  }

  return results;
}
