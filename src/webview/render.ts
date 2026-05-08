import * as vscode from 'vscode';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '&#10;');
}

function createNonce(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function iconSvg(name: string, className = ''): string {
  const common = 'class="lucide ' + escapeHtml(className) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"';
  const nodes: Record<string, string> = {
    activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    gitBranch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    linkOff: '<path d="M9 17H7A5 5 0 0 1 7 7"/><path d="M15 7h2a5 5 0 0 1 4 8"/><line x1="8" x2="12" y1="12" y2="12"/><line x1="2" x2="22" y1="2" y2="22"/>',
    list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
    loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    pin: '<path d="M12 17v5"/><path d="M9 10.76 5.4 14.36a1 1 0 0 0 .7 1.7h11.8a1 1 0 0 0 .7-1.7L15 10.76V5l1-1V2H8v2l1 1z"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    rocket: '<path d="M4.5 16.5c-1.5 1.26-2 3.75-2 3.75s2.49-.5 3.75-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-4.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-5.05 11a22 22 0 0 1-4.95 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
  };

  return '<svg ' + common + '>' + (nodes[name] ?? '') + '</svg>';
}

function getReverseTunnelActionIconSvg(actionId: string): string {
  if (actionId === 'bootstrap') {
    return iconSvg('rocket');
  }
  return actionId === 'logs' ? iconSvg('list') : iconSvg('settings');
}

function getReverseTunnelStateIconSvg(tone: 'connected' | 'external' | 'starting' | 'failed' | 'stopped'): string {
  if (tone === 'connected') {
    return '<span class="state-pulse-wrap">' + iconSvg('activity') + '<span class="state-pulse-dot"></span></span>';
  }
  if (tone === 'external') {
    return '<span class="state-pulse-wrap">' + iconSvg('activity') + '<span class="state-pulse-dot"></span></span>';
  }
  if (tone === 'starting') {
    return iconSvg('loader');
  }
  if (tone === 'failed') {
    return iconSvg('x');
  }
  return iconSvg('linkOff');
}

function getKeyProjectsToolbarIconSvg(actionId: string): string {
  return actionId === 'refresh' ? iconSvg('refresh') : iconSvg('settings');
}

function getPinnedProjectStateIconSvg(row: any): string {
  const remoteLabel = String(row.remoteLabel ?? '').toLowerCase();
  if (!row.available) {
    return iconSvg('x');
  }
  if (remoteLabel.startsWith('synced')) {
    return iconSvg('check');
  }
  if (remoteLabel.startsWith('ahead')) {
    return iconSvg('gitBranch');
  }
  if (remoteLabel.startsWith('behind')) {
    return iconSvg('refresh');
  }
  if (remoteLabel.startsWith('diverged')) {
    return iconSvg('x');
  }
  return row.clean ? iconSvg('check') : iconSvg('gitBranch');
}

function getPinnedProjectTone(row: any): string {
  const remoteLabel = String(row.remoteLabel ?? '').toLowerCase();
  if (!row.available) {
    return 'unavailable';
  }
  if (remoteLabel.startsWith('synced')) {
    return 'synced';
  }
  if (remoteLabel.startsWith('ahead')) {
    return 'ahead';
  }
  if (remoteLabel.startsWith('behind')) {
    return 'behind';
  }
  if (remoteLabel.startsWith('diverged')) {
    return 'diverged';
  }
  return row.clean ? 'synced' : 'dirty';
}

function getFavoriteWorkspaceLanguageBadge(language: string): { label: string; tone: string } {
  const normalized = String(language || '').toLowerCase();
  if (normalized === 'javascript') {
    return { label: 'JS', tone: 'javascript' };
  }
  if (normalized === 'typescript') {
    return { label: 'TS', tone: 'typescript' };
  }
  if (normalized === 'rust') {
    return { label: 'RS', tone: 'rust' };
  }
  if (normalized === 'python') {
    return { label: 'PY', tone: 'python' };
  }
  if (normalized === 'c++') {
    return { label: 'CP', tone: 'cpp' };
  }
  if (normalized === 'go') {
    return { label: 'GO', tone: 'go' };
  }
  if (normalized === 'java') {
    return { label: 'JV', tone: 'java' };
  }
  const words = String(language || '')
    .replace(/[^A-Za-z0-9+#]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const label = (words.length > 1 ? words.map((word) => word[0]).join('') : (words[0] ?? '?')).slice(0, 2).toUpperCase();
  return { label, tone: 'default' };
}

function getFavoriteWorkspaceLanguageColorVar(tone: string): string {
  const normalized = String(tone || '').replace(/[^a-z]/g, '');
  if (['javascript', 'typescript', 'rust', 'python', 'cpp', 'go', 'java'].includes(normalized)) {
    return 'var(--lang-' + normalized + ')';
  }
  return 'var(--lang-default)';
}

export function renderToolBoxWebview(webview: vscode.Webview, model: any): string {
  const nonce = createNonce();
  const topActions = model.reverseTunnel.actions
    .map((action: any) => {
      const icon = getReverseTunnelActionIconSvg(action.id);
      return '<button class="chrome-button" data-action="' + escapeHtml(action.id) + '" title="' + escapeHtml(action.label) + '" aria-label="' + escapeHtml(action.label) + '" ' + (action.enabled ? '' : 'disabled') + '><span class="action-icon" aria-hidden="true">' + icon + '</span></button>';
    })
    .join('');

  const reverseRows = model.reverseTunnel.rows
    .map((row: any, index: number) => {
      const stateIcon = getReverseTunnelStateIconSvg(row.tone);
      const tooltip = escapeHtmlAttribute(row.tooltip);
      const actionButton =
        row.action === 'none'
          ? '<button class="rt-action-button disabled" title="' + escapeHtml(row.stateLabel + ' ' + row.targetLabel) + '" disabled><span>' + escapeHtml(row.stateLabel) + '</span></button>'
          : '<button class="rt-action-button ' + escapeHtml(row.action) + '" data-remote-action="' + escapeHtml(row.action) + '" data-remote-key="' + escapeHtml(row.key) + '" title="' + escapeHtml(row.actionLabel + ' ' + row.targetLabel) + '" ' + (row.actionEnabled ? '' : 'disabled') + '><span class="button-icon" aria-hidden="true">' + (row.action === 'start' ? iconSvg('play') : iconSvg('square')) + '</span><span>' + escapeHtml(row.actionLabel) + '</span></button>';
      return [
        '<tr class="rt-row" style="animation-delay: ' + String(index * 50) + 'ms">',
        '  <td class="cell proxy"><span class="rt-proxy-main"><span class="rt-state-icon ' + escapeHtml(row.tone) + '" title="' + escapeHtml(row.stateLabel) + '" aria-label="' + escapeHtml(row.stateLabel) + '">' + stateIcon + '</span><code class="rt-host-code">' + escapeHtml(row.hostLabel) + '</code><span class="rt-info-icon" data-tooltip="' + tooltip + '" tabindex="0" aria-label="Tunnel details">' + iconSvg('info') + '</span></span></td>',
        '  <td class="cell rt-action">' + actionButton + '</td>',
        '</tr>'
      ].join('');
    })
    .join('');

  const reverseBody = model.reverseTunnel.issue
    ? '<div class="empty">' + escapeHtml(model.reverseTunnel.issue) + '</div>'
    : [
        '<div class="table-scroll">',
        '  <table class="dashboard-table rt-table">',
        '    <thead><tr><th>Proxy</th><th class="align-right">Action</th></tr></thead>',
        '    <tbody>' + reverseRows + '</tbody>',
        '  </table>',
        '</div>'
      ].join('');

  const refreshButtonClass = 'chrome-button' + (model.keyProjects.refreshing ? ' refreshing' : '');
  const keyToolbar = [
    '<button id="refresh" class="' + refreshButtonClass + '" title="' + escapeHtml(model.keyProjects.refreshing ? 'Refreshing...' : 'Refresh') + '" aria-label="' + escapeHtml(model.keyProjects.refreshing ? 'Refreshing...' : 'Refresh') + '" ' + (model.keyProjects.refreshing ? 'disabled' : '') + '><span class="action-icon" aria-hidden="true">' + getKeyProjectsToolbarIconSvg('refresh') + '</span></button>'
  ].join('');

  const keyDetailsByRepo = JSON.stringify(
    Object.fromEntries(
      model.keyProjects.rows.map((row: any) => [row.configuredRepoName, { title: row.detailTitle, text: row.detailText }])
    )
  ).replace(/</g, '\u003C');

  const keyRows = model.keyProjects.rows
    .map((row: any, index: number) => {
      const tone = getPinnedProjectTone(row);
      const stateCell = row.loaded
        ? '<span class="project-state-icon ' + escapeHtml(tone) + '" title="' + escapeHtml(row.stateLabel) + '">' + getPinnedProjectStateIconSvg(row) + '</span>'
        : '<span class="project-state-placeholder" title="Not loaded"></span>';
      const branchCell = row.loaded
        ? '<code class="branch-code">' + escapeHtml(row.branch) + '</code>'
        : '<span class="muted-placeholder" aria-label="Not loaded"></span>';
      const remoteCell = row.loaded
        ? '<span class="remote-label ' + escapeHtml(tone) + '">' + escapeHtml(row.remoteLabel) + '</span>'
        : '<span class="muted-placeholder" aria-label="Not loaded"></span>';
      return [
        '<tr class="table-row project-row" data-repo="' + escapeHtml(row.configuredRepoName) + '" tabindex="0" style="animation-delay: ' + String(index * 50) + 'ms">',
        '  <td class="cell state">' + stateCell + '</td>',
        '  <td class="cell repo"><span class="repo-name">' + escapeHtml(row.repoName) + '</span></td>',
        '  <td class="cell branch">' + branchCell + '</td>',
        '  <td class="cell remote">' + remoteCell + '</td>',
        '</tr>'
      ].join('');
    })
    .join('');

  let keyBody = '';
  if (model.keyProjects.issue) {
    keyBody = '<div class="empty">' + escapeHtml(model.keyProjects.issue) + '</div>';
  } else if (!model.keyProjects.rows.length && model.keyProjects.refreshing) {
    keyBody = '<div class="empty">Refreshing key projects...</div>';
  } else if (!model.keyProjects.rows.length) {
    keyBody = '<div class="empty">No key projects configured.</div>';
  } else {
    keyBody = [
      '<div class="table-scroll">',
      '  <table class="dashboard-table key-table">',
      '    <thead><tr><th>State</th><th>Repository</th><th>Branch</th><th>Remote</th></tr></thead>',
      '    <tbody>' + keyRows + '</tbody>',
      '  </table>',
      '</div>'
    ].join('');
  }

  const favoriteRefreshClass = 'chrome-button' + (model.favoriteWorkspaces.refreshing ? ' refreshing' : '');
  const favoriteToolbar = [
    '<button id="favorite-refresh" class="' + favoriteRefreshClass + '" title="' + escapeHtml(model.favoriteWorkspaces.refreshing ? 'Refreshing...' : 'Refresh workspaces') + '" aria-label="' + escapeHtml(model.favoriteWorkspaces.refreshing ? 'Refreshing...' : 'Refresh workspaces') + '" ' + (model.favoriteWorkspaces.refreshing ? 'disabled' : '') + '><span class="action-icon" aria-hidden="true">' + iconSvg('refresh') + '</span></button>',
    '<button id="favorite-add" class="chrome-button" title="Add workspace" aria-label="Add workspace"><span class="action-icon" aria-hidden="true">' + iconSvg('plus') + '</span></button>'
  ].join('');
  const favoriteRows = model.favoriteWorkspaces.rows
    .map((row: any, index: number) => {
      const pathValue = escapeHtmlAttribute(row.workspacePath);
      const folderSummary = String(row.folderSummary ?? '');
      const languages = Array.isArray(row.languages) ? row.languages.slice(0, 2) : [];
      const primaryBadge = languages[0] ? getFavoriteWorkspaceLanguageBadge(String(languages[0].name ?? '')) : null;
      const workspaceAccent = primaryBadge ? getFavoriteWorkspaceLanguageColorVar(primaryBadge.tone) : 'var(--purple-500)';
      let languagePercentTotal = 0;
      const languageDistribution = languages
        .map((language: any) => {
          const name = String(language.name ?? '');
          const percent = Math.max(0, Math.min(100, Number.isFinite(language.percent) ? Number(language.percent) : 0));
          languagePercentTotal += percent;
          const badge = getFavoriteWorkspaceLanguageBadge(name);
          return '<span class="workspace-language-segment ' + escapeHtmlAttribute(badge.tone) + '" style="width: ' + escapeHtmlAttribute(String(percent)) + '%"></span>';
        })
        .join('');
      const otherPercent = Math.max(0, 100 - Math.min(100, languagePercentTotal));
      const languageDistributionBar = languageDistribution
        ? '<span class="workspace-language-bar" aria-hidden="true">' + languageDistribution + (otherPercent > 0 ? '<span class="workspace-language-segment default" style="width: ' + escapeHtmlAttribute(String(otherPercent)) + '%"></span>' : '') + '</span>'
        : '';
      const languageRows = languages
        .map((language: any) => {
          const name = String(language.name ?? '');
          const percent = Number.isFinite(language.percent) ? Number(language.percent) : 0;
          const badge = getFavoriteWorkspaceLanguageBadge(name);
          return [
            '<span class="workspace-language">',
            '  <span class="workspace-language-dot ' + escapeHtmlAttribute(badge.tone) + '" aria-hidden="true"></span>',
            '  <span class="workspace-language-text">' + escapeHtml(name + ' ' + String(percent) + '%') + '</span>',
            '</span>'
          ].join('');
        })
        .join('');
      const unavailable = row.available ? '' : ' unavailable';
      const title = row.available ? 'Open workspace' : escapeHtml(row.error || 'Workspace unavailable');
      const nameTitle = escapeHtmlAttribute(row.name);
      return [
        '<button class="workspace-card' + unavailable + '" data-workspace-path="' + pathValue + '" title="' + title + '" style="--workspace-accent: ' + workspaceAccent + '; animation-delay: ' + String(index * 50) + 'ms">',
        '  <span class="workspace-card-top">',
        '    <span class="workspace-name" title="' + nameTitle + '">' + escapeHtml(row.name) + '</span>',
        '    <span class="workspace-card-actions">',
        '      <span class="workspace-remove" role="button" tabindex="0" data-workspace-remove="' + pathValue + '" aria-label="Remove workspace">' + iconSvg('x') + '</span>',
        '    </span>',
        '  </span>',
        folderSummary ? '  <span class="workspace-folders"><span class="workspace-folder-icon" aria-hidden="true">' + iconSvg('folder') + '</span><span class="workspace-folder-text">' + escapeHtml(folderSummary) + '</span></span>' : '  <span class="workspace-folders empty-description"></span>',
        languageRows ? '  <span class="workspace-language-divider" aria-hidden="true"></span>' : '',
        languageDistributionBar,
        languageRows ? '  <span class="workspace-languages">' + languageRows + '</span>' : '',
        '</button>'
      ].join('');
    })
    .join('');

  let favoriteBody = '';
  if (model.favoriteWorkspaces.issue) {
    favoriteBody = '<div class="empty">' + escapeHtml(model.favoriteWorkspaces.issue) + '</div>';
  } else if (!model.favoriteWorkspaces.rows.length) {
    favoriteBody = '<div class="empty">No favorite workspaces configured.</div>';
  } else {
    favoriteBody = '<div class="workspace-grid">' + favoriteRows + '</div>';
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      color-scheme: dark;
      --bg: #11161c;
      --bg-deep: #0b0f14;
      --bg-soft: #192029;
      --card: rgba(29, 35, 44, 0.76);
      --card-hover: rgba(38, 46, 58, 0.84);
      --card-header: rgba(41, 48, 59, 0.72);
      --code-bg: rgba(27, 33, 42, 0.86);
      --text: #f3f6fb;
      --muted: #98a2b3;
      --muted-2: #c2c9d6;
      --border: rgba(126, 139, 157, 0.26);
      --border-strong: rgba(169, 181, 197, 0.34);
      --border-soft: rgba(126, 139, 157, 0.16);
      --glass-highlight: rgba(255, 255, 255, 0.055);
      --shadow-sm: 0 1px 1px rgba(0, 0, 0, 0.34), inset 0 1px 0 var(--glass-highlight);
      --shadow-md: 0 16px 42px rgba(0, 0, 0, 0.34), inset 0 1px 0 var(--glass-highlight);
      --start-400: #60a5fa;
      --start-500: #3794ff;
      --start-600: #1f6fd8;
      --success: #57d68d;
      --danger-400: #ff7474;
      --danger-500: #f06161;
      --danger-600: #c94a4a;
      --purple-500: #c19cff;
      --purple-600: #b180ff;
      --purple-soft: rgba(177, 128, 255, 0.16);
      --amber-400: #f0c35a;
      --amber-500: #d7a83f;
      --blue-400: #66b3ff;
      --blue-500: #3794ff;
      --lang-javascript: #f4c527;
      --lang-typescript: #3b82f6;
      --lang-rust: #d97706;
      --lang-python: #3976ab;
      --lang-cpp: #7c3aed;
      --lang-go: #06b6d4;
      --lang-java: #dc2626;
      --lang-default: #64748b;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      min-height: 100vh;
      padding: 14px;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px;
      color: var(--text);
      background:
        radial-gradient(circle at 12% 7%, rgba(255, 255, 255, 0.075), transparent 24rem),
        radial-gradient(circle at 92% 4%, rgba(91, 141, 255, 0.08), transparent 23rem),
        radial-gradient(circle at 34% 88%, rgba(177, 128, 255, 0.08), transparent 20rem),
        linear-gradient(135deg, var(--bg-deep) 0%, var(--bg) 52%, #151c24 100%);
      background-attachment: fixed;
    }
    .app-shell,
    .stack {
      display: grid;
      gap: 18px;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .app-title {
      margin: 0;
      overflow: hidden;
      color: var(--text);
      font-size: 16px;
      line-height: 1.35;
      font-weight: 800;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-shadow: 0 1px 18px rgba(255, 255, 255, 0.12);
    }
    .section-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .section-title {
      margin: 0;
      min-width: 0;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--text);
      font-size: 13px;
      line-height: 1.35;
      font-weight: 750;
      text-shadow: 0 1px 14px rgba(0, 0, 0, 0.42);
    }
    .section-title-mark {
      width: 18px;
      height: 18px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      color: var(--purple-500);
      filter: drop-shadow(0 0 8px rgba(177, 128, 255, 0.26));
    }
    .section-title-mark svg {
      width: 17px;
      height: 17px;
    }
    .section-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto;
    }
    .card {
      overflow: visible;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--card);
      box-shadow: var(--shadow-md);
      backdrop-filter: blur(18px);
    }
    .chrome-button {
      width: 30px;
      height: 30px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: rgba(26, 32, 41, 0.68);
      color: var(--muted-2);
      box-shadow: var(--shadow-sm);
      cursor: pointer;
      transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
    }
    .chrome-button:hover:not(:disabled),
    .chrome-button:focus-visible:not(:disabled) {
      border-color: var(--border-strong);
      background: var(--card-hover);
      color: var(--text);
      transform: translateY(-1px);
      box-shadow: var(--shadow-md);
      outline: none;
    }
    .chrome-button:active:not(:disabled) {
      transform: translateY(0);
    }
    .chrome-button:disabled {
      cursor: default;
      opacity: 0.55;
    }
    .chrome-button.refreshing {
      color: var(--blue-400);
      opacity: 0.86;
    }
    .chrome-button.refreshing .action-icon {
      animation: spin 850ms linear infinite;
    }
    .action-icon,
    .button-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
    }
    .action-icon,
    .action-icon svg {
      width: 14px;
      height: 14px;
    }
    .button-icon,
    .button-icon svg {
      width: 12px;
      height: 12px;
    }
    .rt-action {
      display: inline-flex;
      justify-content: flex-end;
    }
    .rt-table th:nth-child(2),
    .rt-table td:nth-child(2) {
      width: 76px;
      text-align: right;
    }
    .align-right {
      text-align: right;
    }
    .rt-proxy-main {
      min-width: 0;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      max-width: 100%;
    }
    .rt-host-code,
    .branch-code {
      display: inline-block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: middle;
      white-space: nowrap;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--code-bg);
      color: var(--text);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 11px;
      line-height: 1.35;
      transition: border-color 150ms ease, color 150ms ease;
    }
    .rt-host-code {
      width: 20ch;
      padding: 5px 8px;
    }
    .branch-code {
      max-width: 14ch;
      padding: 5px 8px;
      color: var(--muted-2);
    }
    .rt-state-icon,
    .rt-info-icon,
    .project-state-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      position: relative;
      flex: 0 0 auto;
    }
    .rt-state-icon,
    .rt-state-icon svg,
    .project-state-icon,
    .project-state-icon svg {
      width: 16px;
      height: 16px;
    }
    .rt-state-icon.connected {
      color: var(--success);
    }
    .rt-state-icon.external {
      color: var(--blue-400);
    }
    .rt-state-icon.starting {
      color: var(--amber-400);
      animation: spin 1s linear infinite;
    }
    .rt-state-icon.failed {
      color: var(--danger-500);
    }
    .rt-state-icon.stopped {
      color: var(--muted);
    }
    .state-pulse-wrap {
      position: relative;
      display: inline-flex;
      width: 16px;
      height: 16px;
    }
    .state-pulse-dot {
      position: absolute;
      top: -3px;
      right: -3px;
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: currentColor;
      animation: pulse 2s cubic-bezier(.4, 0, .6, 1) infinite;
    }
    .rt-info-icon {
      width: 18px;
      height: 18px;
      border: 1px solid var(--border);
      border-radius: 5px;
      background: rgba(31, 38, 49, 0.84);
      color: var(--muted);
      cursor: help;
      transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease;
    }
    .rt-info-icon svg {
      width: 12px;
      height: 12px;
    }
    .rt-info-icon:hover,
    .rt-info-icon:focus {
      border-color: var(--border-strong);
      background: var(--card-hover);
      color: var(--text);
      outline: none;
    }
    .rt-action-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      width: 58px;
      min-height: 28px;
      padding: 0 8px;
      border: 0;
      border-radius: 6px;
      color: #ffffff;
      box-shadow: var(--shadow-sm);
      cursor: pointer;
      font: inherit;
      font-size: 11px;
      font-weight: 500;
      transition: background 200ms ease, transform 150ms ease, box-shadow 150ms ease, opacity 150ms ease;
    }
    .rt-action-button.start {
      background: linear-gradient(135deg, #4a9cff, var(--start-600));
      box-shadow: 0 7px 16px rgba(55, 148, 255, 0.24);
    }
    .rt-action-button.stop {
      background: linear-gradient(135deg, var(--danger-500), var(--danger-600));
      box-shadow: 0 7px 16px rgba(240, 97, 97, 0.2);
    }
    .rt-action-button.disabled {
      border: 1px solid var(--border);
      background: rgba(31, 38, 49, 0.62);
      color: var(--muted);
      box-shadow: none;
    }
    .rt-action-button.start:hover:not(:disabled),
    .rt-action-button.start:focus-visible:not(:disabled) {
      background: linear-gradient(135deg, var(--start-400), var(--start-500));
    }
    .rt-action-button.stop:hover:not(:disabled),
    .rt-action-button.stop:focus-visible:not(:disabled) {
      background: linear-gradient(135deg, var(--danger-400), var(--danger-500));
    }
    .rt-action-button:hover:not(:disabled),
    .rt-action-button:focus-visible:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: var(--shadow-md);
      outline: none;
    }
    .rt-action-button:disabled {
      cursor: default;
      opacity: 0.58;
    }
    .rt-tooltip {
      position: fixed;
      display: none;
      z-index: 90;
      width: min(320px, calc(100vw - 20px));
      padding: 8px 10px;
      border-radius: 7px;
      border: 1px solid var(--border-strong);
      background: rgba(14, 18, 24, 0.96);
      color: #ffffff;
      box-shadow: 0 18px 38px rgba(0, 0, 0, 0.38);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 11px;
      line-height: 1.45;
      text-align: left;
      pointer-events: none;
    }
    .rt-tooltip.open {
      display: block;
    }
    .table-scroll {
      overflow-x: auto;
    }
    .dashboard-table {
      width: 100%;
      min-width: 430px;
      border-collapse: collapse;
      table-layout: auto;
    }
    .dashboard-table thead tr {
      border-bottom: 1px solid var(--border);
      background: linear-gradient(180deg, rgba(44, 52, 64, 0.82), rgba(34, 41, 51, 0.7));
    }
    .dashboard-table th {
      padding: 11px 12px;
      color: var(--muted-2);
      font-size: 10px;
      line-height: 1.25;
      font-weight: 750;
      letter-spacing: 0.05em;
      text-align: left;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .dashboard-table td {
      padding: 12px;
      border-bottom: 1px solid var(--border-soft);
      vertical-align: middle;
    }
    .dashboard-table tbody tr:last-child td {
      border-bottom: 0;
    }
    .dashboard-table tbody tr {
      transition: background-color 150ms ease, color 150ms ease;
    }
    .dashboard-table tbody tr:hover {
      background: rgba(255, 255, 255, 0.035);
    }
    .key-table th:nth-child(1),
    .key-table td:nth-child(1) {
      width: 58px;
    }
    .key-table th:nth-child(2),
    .key-table td:nth-child(2) {
      min-width: 130px;
    }
    .project-row {
      cursor: pointer;
    }
    .project-row:focus-visible {
      outline: 2px solid var(--purple-500);
      outline-offset: -2px;
    }
    .project-state-icon.synced {
      color: var(--purple-500);
      filter: drop-shadow(0 0 6px rgba(177, 128, 255, 0.3));
    }
    .project-state-placeholder,
    .muted-placeholder {
      display: inline-block;
      width: 12px;
      height: 1px;
      background: transparent;
    }
    .project-state-icon.ahead {
      width: auto;
      height: auto;
      padding: 4px 8px;
      border: 1px solid rgba(59, 130, 246, 0.30);
      border-radius: 999px;
      background: rgba(59, 130, 246, 0.14);
      color: var(--blue-400);
    }
    .project-state-icon.behind {
      width: auto;
      height: auto;
      padding: 4px 8px;
      border: 1px solid rgba(245, 158, 11, 0.30);
      border-radius: 999px;
      background: rgba(245, 158, 11, 0.14);
      color: var(--amber-400);
    }
    .project-state-icon.diverged,
    .project-state-icon.dirty,
    .project-state-icon.unavailable {
      width: auto;
      height: auto;
      padding: 4px 8px;
      border: 1px solid rgba(255, 116, 116, 0.30);
      border-radius: 999px;
      background: rgba(255, 116, 116, 0.14);
      color: var(--danger-400);
    }
    .project-state-icon.ahead svg,
    .project-state-icon.behind svg,
    .project-state-icon.diverged svg,
    .project-state-icon.dirty svg,
    .project-state-icon.unavailable svg {
      width: 13px;
      height: 13px;
    }
    .repo-name {
      display: inline-block;
      max-width: 100%;
      overflow: hidden;
      color: var(--text);
      text-overflow: ellipsis;
      white-space: nowrap;
      transition: color 150ms ease;
    }
    .project-row:hover .repo-name {
      color: var(--text);
    }
    .project-row:hover .branch-code {
      border-color: var(--border-strong);
      color: var(--text);
    }
    .remote-label {
      display: inline-block;
      max-width: 14ch;
      overflow: hidden;
      color: var(--muted);
      text-overflow: ellipsis;
      text-transform: capitalize;
      white-space: nowrap;
    }
    .remote-label.synced {
      color: #ce9cff;
    }
    .remote-label.ahead {
      color: var(--blue-500);
    }
    .remote-label.behind {
      color: var(--amber-500);
    }
    .remote-label.diverged,
    .remote-label.dirty,
    .remote-label.unavailable {
      color: var(--danger-500);
    }
    .workspace-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(118px, 136px));
      gap: 10px;
      justify-content: start;
    }
    .workspace-card {
      width: 100%;
      min-height: 124px;
      display: grid;
      align-content: start;
      gap: 12px;
      position: relative;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0)),
        var(--card);
      color: var(--text);
      box-shadow: var(--shadow-sm);
      cursor: pointer;
      font: inherit;
      text-align: left;
      backdrop-filter: blur(18px);
      transition: background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease, opacity 150ms ease;
    }
    .workspace-card::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 3px;
      background: linear-gradient(180deg, var(--workspace-accent, var(--purple-500)), color-mix(in srgb, var(--workspace-accent, var(--purple-500)) 36%, transparent));
      box-shadow: 0 0 14px color-mix(in srgb, var(--workspace-accent, var(--purple-500)) 38%, transparent);
    }
    .workspace-card:hover,
    .workspace-card:focus-visible {
      border-color: var(--border-strong);
      background-color: var(--card-hover);
      box-shadow: var(--shadow-md);
      transform: translateY(-1px);
      outline: none;
    }
    .workspace-card.unavailable {
      opacity: 0.72;
    }
    .workspace-card-top {
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .workspace-name {
      min-width: 0;
      overflow: hidden;
      color: var(--text);
      font-size: 14px;
      font-weight: 600;
      line-height: 1.35;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .workspace-card-actions {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      flex: 0 0 auto;
    }
    .workspace-remove {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
    }
    .workspace-remove {
      border-radius: 5px;
      color: var(--muted);
      opacity: 0.46;
      transition: background-color 150ms ease, color 150ms ease, opacity 150ms ease;
    }
    .workspace-remove svg {
      width: 13px;
      height: 13px;
    }
    .workspace-card:hover .workspace-remove,
    .workspace-card:focus-visible .workspace-remove,
    .workspace-remove:hover,
    .workspace-remove:focus-visible {
      opacity: 1;
    }
    .workspace-remove:hover,
    .workspace-remove:focus-visible {
      background: rgba(255, 255, 255, 0.05);
      color: var(--danger-400);
      outline: none;
    }
    .workspace-folders {
      min-width: 0;
      display: grid;
      grid-template-columns: 14px minmax(0, 1fr);
      align-items: start;
      gap: 6px;
      color: var(--muted-2);
      font-size: 11px;
      line-height: 1.35;
    }
    .workspace-folder-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      color: var(--muted);
      opacity: 0.78;
    }
    .workspace-folder-icon svg {
      width: 13px;
      height: 13px;
    }
    .workspace-folder-text {
      min-width: 0;
      overflow: hidden;
      overflow-wrap: anywhere;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .workspace-folders.empty-description {
      min-height: 0;
    }
    .workspace-language-divider {
      display: block;
      height: 1px;
      width: 100%;
      background: color-mix(in srgb, var(--border) 62%, transparent);
      margin: 1px 0 0;
    }
    .workspace-language-bar {
      display: flex;
      width: 100%;
      height: 3px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(100, 116, 139, 0.22);
    }
    .workspace-language-segment {
      display: block;
      height: 100%;
      min-width: 2px;
    }
    .workspace-languages {
      display: grid;
      gap: 6px;
      min-width: 0;
    }
    .workspace-language {
      min-width: 0;
      display: grid;
      grid-template-columns: 7px minmax(0, 1fr);
      align-items: center;
      gap: 6px;
      color: color-mix(in srgb, var(--muted) 88%, transparent);
      font-size: 10px;
      line-height: 1.2;
    }
    .workspace-language-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--lang-default);
      box-shadow: 0 0 8px color-mix(in srgb, currentColor 18%, transparent);
    }
    .workspace-language-dot.javascript,
    .workspace-language-segment.javascript { background: var(--lang-javascript); }
    .workspace-language-dot.typescript,
    .workspace-language-segment.typescript { background: var(--lang-typescript); }
    .workspace-language-dot.rust,
    .workspace-language-segment.rust { background: var(--lang-rust); }
    .workspace-language-dot.python,
    .workspace-language-segment.python { background: var(--lang-python); }
    .workspace-language-dot.cpp,
    .workspace-language-segment.cpp { background: var(--lang-cpp); }
    .workspace-language-dot.go,
    .workspace-language-segment.go { background: var(--lang-go); }
    .workspace-language-dot.java,
    .workspace-language-segment.java { background: var(--lang-java); }
    .workspace-language-dot.default,
    .workspace-language-segment.default { background: var(--lang-default); }
    .workspace-language-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .empty {
      margin: 8px;
      border: 1px dashed var(--border);
      border-radius: 7px;
      padding: 10px;
      color: var(--muted);
      background: rgba(31, 38, 49, 0.56);
      line-height: 1.45;
    }
    .detail-popover {
      position: fixed;
      display: none;
      width: min(360px, calc(100vw - 20px));
      max-height: min(260px, calc(100vh - 20px));
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--card);
      box-shadow: var(--shadow-md);
      backdrop-filter: blur(18px);
      z-index: 70;
    }
    .detail-popover.open {
      display: grid;
      grid-template-rows: auto 1fr;
    }
    .detail-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 9px 10px;
      border-bottom: 1px solid var(--border);
      background: var(--card-header);
    }
    .detail-title {
      overflow: hidden;
      color: var(--text);
      font-size: 12px;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .detail-close {
      width: 24px;
      height: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--card);
      color: var(--muted-2);
      cursor: pointer;
    }
    .detail-close svg {
      width: 13px;
      height: 13px;
    }
    .detail-close:hover,
    .detail-close:focus-visible {
      background: var(--card-hover);
      outline: none;
    }
    @media (min-width: 520px) {
      body {
        padding: 18px;
      }
      .app-shell,
      .stack {
        gap: 22px;
      }
      .app-title {
        font-size: 20px;
      }
      .section-title {
        font-size: 15px;
      }
      .dashboard-table td {
        padding-top: 14px;
        padding-bottom: 14px;
      }
      .workspace-grid {
        grid-template-columns: repeat(auto-fill, minmax(132px, 156px));
      }
    }
    .detail-body {
      margin: 0;
      padding: 10px;
      overflow: auto;
      color: var(--text);
      white-space: pre-wrap;
      user-select: text;
      -webkit-user-select: text;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 11px;
      line-height: 1.5;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @keyframes pulse {
      50% { opacity: 0.45; }
    }
  </style>
</head>
<body>
  <main class="app-shell">
    <header class="topbar">
      <h1 class="app-title">My Dashboard</h1>
      <div class="section-actions">${topActions}</div>
    </header>
    <div class="stack">
      <section class="panel reverse-panel">
        <div class="section-head">
          <h2 class="section-title"><span class="section-title-mark reverse-title-icon">${iconSvg('shield')}</span><span>Reverse Tunnel Proxies</span></h2>
        </div>
        <div class="card">${reverseBody}</div>
      </section>
      <section class="panel key-panel">
        <div class="section-head">
          <h2 class="section-title"><span class="section-title-mark pinned-title-icon">${iconSvg('pin')}</span><span>Pinned Projects</span></h2>
          <div class="section-actions">${keyToolbar}</div>
        </div>
        <div class="card">${keyBody}</div>
      </section>
      <section class="panel favorite-panel">
        <div class="section-head">
          <h2 class="section-title"><span class="section-title-mark favorite-title-icon">${iconSvg('heart')}</span><span>Favorite Workspaces</span></h2>
          <div class="section-actions">${favoriteToolbar}</div>
        </div>
        ${favoriteBody}
      </section>
    </div>
  </main>
  <div id="rt-tooltip" class="rt-tooltip" aria-hidden="true"></div>
  <div id="detail-popover" class="detail-popover" aria-hidden="true">
    <div class="detail-head">
      <div id="detail-title" class="detail-title">Key Project Details</div>
      <button id="detail-close" class="detail-close" type="button" aria-label="Close">${iconSvg('x')}</button>
    </div>
    <pre id="detail-body" class="detail-body"></pre>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('button[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.getAttribute('data-action');
        if (action) {
          vscode.postMessage({ type: 'action', action });
        }
      });
    });
    document.getElementById('refresh')?.addEventListener('click', (event) => {
      const button = event.currentTarget;
      if (button instanceof HTMLElement) {
        button.classList.add('refreshing');
        button.setAttribute('aria-label', 'Refreshing...');
        button.setAttribute('title', 'Refreshing...');
      }
      vscode.postMessage({ type: 'action', action: 'keyRefresh' });
    });
    document.getElementById('favorite-add')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'action', action: 'favoriteAdd' });
    });
    document.getElementById('favorite-refresh')?.addEventListener('click', (event) => {
      const button = event.currentTarget;
      if (button instanceof HTMLElement) {
        button.classList.add('refreshing');
        button.setAttribute('aria-label', 'Refreshing...');
        button.setAttribute('title', 'Refreshing...');
      }
      vscode.postMessage({ type: 'action', action: 'favoriteRefresh' });
    });
    document.querySelectorAll('button[data-remote-action][data-remote-key]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.getAttribute('data-remote-action');
        const remoteKey = button.getAttribute('data-remote-key');
        if (action && remoteKey) {
          vscode.postMessage({ type: 'reverseTunnel', action, remoteKey });
        }
      });
    });
    document.querySelectorAll('.workspace-card[data-workspace-path]').forEach((card) => {
      card.addEventListener('click', (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest('.workspace-remove')) {
          return;
        }
        const workspacePath = card.getAttribute('data-workspace-path');
        if (workspacePath) {
          vscode.postMessage({ type: 'favoriteWorkspace', action: 'open', workspacePath });
        }
      });
    });
    document.querySelectorAll('.workspace-remove[data-workspace-remove]').forEach((button) => {
      const remove = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const workspacePath = button.getAttribute('data-workspace-remove');
        if (workspacePath) {
          vscode.postMessage({ type: 'favoriteWorkspace', action: 'remove', workspacePath });
        }
      };
      button.addEventListener('click', remove);
      button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          remove(event);
        }
      });
    });
    const rtTooltip = document.getElementById('rt-tooltip');
    const hideReverseTooltip = () => {
      rtTooltip?.classList.remove('open');
      rtTooltip?.setAttribute('aria-hidden', 'true');
    };
    const showReverseTooltip = (target) => {
      if (!rtTooltip || !(target instanceof HTMLElement)) {
        return;
      }
      const text = target.getAttribute('data-tooltip') || '';
      if (!text) {
        return;
      }
      rtTooltip.textContent = text;
      rtTooltip.classList.add('open');
      rtTooltip.setAttribute('aria-hidden', 'false');
      const rect = target.getBoundingClientRect();
      const margin = 10;
      const tooltipRect = rtTooltip.getBoundingClientRect();
      const left = Math.min(Math.max(rect.left, margin), window.innerWidth - tooltipRect.width - margin);
      const top = Math.min(Math.max(rect.bottom + 6, margin), window.innerHeight - tooltipRect.height - margin);
      rtTooltip.style.left = left + 'px';
      rtTooltip.style.top = top + 'px';
    };
    document.querySelectorAll('.rt-info-icon').forEach((trigger) => {
      trigger.addEventListener('mouseenter', () => showReverseTooltip(trigger));
      trigger.addEventListener('focus', () => showReverseTooltip(trigger));
      trigger.addEventListener('mouseleave', hideReverseTooltip);
      trigger.addEventListener('blur', hideReverseTooltip);
    });
    window.addEventListener('scroll', hideReverseTooltip, true);
    window.addEventListener('resize', hideReverseTooltip);
    const detailPopover = document.getElementById('detail-popover');
    const detailTitle = document.getElementById('detail-title');
    const detailBody = document.getElementById('detail-body');
    const keyDetailsByRepo = ${keyDetailsByRepo};
    const closeDetails = () => {
      detailPopover?.classList.remove('open');
      detailPopover?.setAttribute('aria-hidden', 'true');
    };
    document.getElementById('detail-close')?.addEventListener('click', closeDetails);
    window.addEventListener('click', (event) => {
      if (!detailPopover?.classList.contains('open')) {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && (target.closest('.project-row') || target.closest('#detail-popover'))) {
        return;
      }
      closeDetails();
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideReverseTooltip();
        closeDetails();
      }
    });
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message?.type !== 'detail' || !detailBody || !detailTitle || !detailPopover) {
        return;
      }
      const margin = 10;
      const width = Math.min(360, window.innerWidth - margin * 2);
      const height = Math.min(260, window.innerHeight - margin * 2);
      const left = Math.min(Math.max(Number(message.left ?? margin), margin), window.innerWidth - width - margin);
      const top = Math.min(Math.max(Number(message.top ?? margin), margin), window.innerHeight - height - margin);
      detailTitle.textContent = message.title || 'Key Project Details';
      detailBody.textContent = message.text || '';
      detailPopover.style.left = left + 'px';
      detailPopover.style.top = top + 'px';
      detailPopover.classList.add('open');
      detailPopover.setAttribute('aria-hidden', 'false');
    });
    document.querySelectorAll('.project-row').forEach((row) => {
      const openDetail = (event) => {
        const repoName = row.getAttribute('data-repo');
        if (repoName && detailBody && detailTitle && detailPopover) {
          const clientX = event instanceof MouseEvent ? event.clientX : 10;
          const clientY = event instanceof MouseEvent ? event.clientY : 10;
          const detail = keyDetailsByRepo[repoName];
          const margin = 10;
          const width = Math.min(360, window.innerWidth - margin * 2);
          const height = Math.min(260, window.innerHeight - margin * 2);
          const left = Math.min(Math.max(clientX + 8, margin), window.innerWidth - width - margin);
          const top = Math.min(Math.max(clientY + 8, margin), window.innerHeight - height - margin);
          detailTitle.textContent = detail?.title || 'Key Project Details';
          detailBody.textContent = detail?.text || 'Status not loaded. Click Refresh first.';
          detailPopover.style.left = left + 'px';
          detailPopover.style.top = top + 'px';
          detailPopover.classList.add('open');
          detailPopover.setAttribute('aria-hidden', 'false');
        }
      };
      row.addEventListener('click', openDetail);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDetail(event);
        }
      });
    });
  </script>
</body>
</html>`;
}
