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

function getReverseTunnelActionIconSvg(actionId: string): string {
  if (actionId === 'logs') {
    return '<svg viewBox="0 0 16 16" fill="currentColor" focusable="false" aria-hidden="true"><path d="M5 10.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5m0-2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m0-2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m0-2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5"/><path d="M3 0h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-1h1v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v1H1V2a2 2 0 0 1 2-2"/><path d="M1 5v-.5a.5.5 0 0 1 1 0V5h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1zm0 3v-.5a.5.5 0 0 1 1 0V8h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1zm0 3v-.5a.5.5 0 0 1 1 0v.5h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1z"/></svg>';
  }
  return '<svg viewBox="0 0 16 16" fill="currentColor" focusable="false" aria-hidden="true"><path d="M7.068.727c.243-.97 1.62-.97 1.864 0l.071.286a.96.96 0 0 0 1.622.434l.205-.211c.695-.719 1.888-.03 1.613.931l-.08.284a.96.96 0 0 0 1.187 1.187l.283-.081c.96-.275 1.65.918.931 1.613l-.211.205a.96.96 0 0 0 .434 1.622l.286.071c.97.243.97 1.62 0 1.864l-.286.071a.96.96 0 0 0-.434 1.622l.211.205c.719.695.03 1.888-.931 1.613l-.284-.08a.96.96 0 0 0-1.187 1.187l.081.283c.275.96-.918 1.65-1.613.931l-.205-.211a.96.96 0 0 0-1.622.434l-.071.286c-.243.97-1.62.97-1.864 0l-.071-.286a.96.96 0 0 0-1.622-.434l-.205.211c-.695.719-1.888.03-1.613-.931l.08-.284a.96.96 0 0 0-1.186-1.187l-.284.081c-.96.275-1.65-.918-.931-1.613l.211-.205a.96.96 0 0 0-.434-1.622l-.286-.071c-.97-.243-.97-1.62 0-1.864l.286-.071a.96.96 0 0 0 .434-1.622l-.211-.205c-.719-.695-.03-1.888.931-1.613l.284.08a.96.96 0 0 0 1.187-1.186l-.081-.284c-.275-.96.918-1.65 1.613-.931l.205.211a.96.96 0 0 0 1.622-.434zM12.973 8.5H8.25l-2.834 3.779A4.998 4.998 0 0 0 12.973 8.5m0-1a4.998 4.998 0 0 0-7.557-3.779l2.834 3.78zM5.048 3.967l-.087.065zm-.431.355A4.98 4.98 0 0 0 3.002 8c0 1.455.622 2.765 1.615 3.678L7.375 8zm.344 7.646.087.065z"/></svg>';
}

function getReverseTunnelStateIconSvg(tone: 'connected' | 'external' | 'starting' | 'failed' | 'stopped'): string {
  if (tone === 'connected') {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><path d="M8 1.75v6"/><path d="M4.7 4.55a5 5 0 1 0 6.6 0"/></svg>';
  }
  if (tone === 'external') {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><path d="M8 1.8v5.2"/><path d="M4.7 4.9a4.8 4.8 0 1 0 6.6 0"/><path d="M2.6 8.8 1.4 10a2 2 0 0 0 2.8 2.8l1.1-1.1"/><path d="M10.7 4.3 11.8 3.2A2 2 0 0 1 14.6 6l-1.2 1.2"/></svg>';
  }
  if (tone === 'starting') {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><path d="M13.2 8a5.2 5.2 0 0 1-8.9 3.7"/><path d="M2.8 8a5.2 5.2 0 0 1 8.9-3.7"/><path d="M11.7 1.9v2.4H9.3"/><path d="M4.3 14.1v-2.4h2.4"/></svg>';
  }
  if (tone === 'failed') {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><path d="M8 1.9 14.4 13a1 1 0 0 1-.9 1.5h-11a1 1 0 0 1-.9-1.5z"/><path d="M8 5.8v3.2"/><path d="M8 12h.01"/></svg>';
  }
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><path d="M8 1.75v6"/><path d="M4.7 4.55a5 5 0 1 0 6.6 0"/><path d="M3 13 13 3"/></svg>';
}

function getInfoIconSvg(): string {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 7.4v3.6"/><path d="M8 5h.01"/></svg>';
}

function getKeyProjectsToolbarIconSvg(actionId: string): string {
  if (actionId === 'refresh') {
    return '<svg viewBox="0 0 16 16" fill="currentColor" focusable="false" aria-hidden="true"><path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.418A6 6 0 1 1 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/></svg>';
  }
  return '<svg viewBox="0 0 16 16" fill="currentColor" focusable="false" aria-hidden="true"><path d="M7.068.727c.243-.97 1.62-.97 1.864 0l.071.286a.96.96 0 0 0 1.622.434l.205-.211c.695-.719 1.888-.03 1.613.931l-.08.284a.96.96 0 0 0 1.187 1.187l.283-.081c.96-.275 1.65.918.931 1.613l-.211.205a.96.96 0 0 0 .434 1.622l.286.071c.97.243.97 1.62 0 1.864l-.286.071a.96.96 0 0 0-.434 1.622l.211.205c.719.695.03 1.888-.931 1.613l-.284-.08a.96.96 0 0 0-1.187 1.187l.081.283c.275.96-.918 1.65-1.613.931l-.205-.211a.96.96 0 0 0-1.622.434l-.071.286c-.243.97-1.62.97-1.864 0l-.071-.286a.96.96 0 0 0-1.622-.434l-.205.211c-.695.719-1.888.03-1.613-.931l.08-.284a.96.96 0 0 0-1.186-1.187l-.284.081c-.96.275-1.65-.918-.931-1.613l.211-.205a.96.96 0 0 0-.434-1.622l-.286-.071c-.97-.243-.97-1.62 0-1.864l.286-.071a.96.96 0 0 0 .434-1.622l-.211-.205c-.719-.695-.03-1.888.931-1.613l.284.08a.96.96 0 0 0 1.187-1.186l-.081-.284c-.275-.96.918-1.65 1.613-.931l.205.211a.96.96 0 0 0 1.622-.434zM12.973 8.5H8.25l-2.834 3.779A4.998 4.998 0 0 0 12.973 8.5m0-1a4.998 4.998 0 0 0-7.557-3.779l2.834 3.78zM5.048 3.967l-.087.065zm-.431.355A4.98 4.98 0 0 0 3.002 8c0 1.455.622 2.765 1.615 3.678L7.375 8zm.344 7.646.087.065z"/></svg>';
}
export function renderToolBoxWebview(webview: vscode.Webview, model: any): string {
  const nonce = createNonce();
  const reverseActions = model.reverseTunnel.actions
    .map((action: any) => {
      const classes = ['action'];
      const icon = getReverseTunnelActionIconSvg(action.id);
      return '<button class="' + classes.join(' ') + '" data-action="' + escapeHtml(action.id) + '" title="' + escapeHtml(action.label) + '" aria-label="' + escapeHtml(action.label) + '" ' + (action.enabled ? '' : 'disabled') + '><span class="action-icon" aria-hidden="true">' + icon + '</span></button>';
    })
    .join('');

  const reverseRows = model.reverseTunnel.rows
    .map((row: any) => {
      const stateIcon = getReverseTunnelStateIconSvg(row.tone);
      const infoIcon = getInfoIconSvg();
      const tooltip = escapeHtmlAttribute(row.tooltip);
      const actionButton =
        row.action === 'none'
          ? '<span class="rt-action-empty">-</span>'
          : '<button class="rt-action-button ' + escapeHtml(row.action) + '" data-remote-action="' + escapeHtml(row.action) + '" data-remote-key="' + escapeHtml(row.key) + '" title="' + escapeHtml(row.actionLabel + ' ' + row.targetLabel) + '" ' + (row.actionEnabled ? '' : 'disabled') + '>' + escapeHtml(row.actionLabel) + '</button>';
      return [
        '<div class="rt-row">',
        '  <span class="rt-cell rt-host"><code class="rt-host-code">' + escapeHtml(row.hostLabel) + '</code></span>',
        '  <span class="rt-cell rt-state" title="' + escapeHtml(row.stateLabel) + '" aria-label="' + escapeHtml(row.stateLabel) + '"><span class="rt-state-icon ' + escapeHtml(row.tone) + '">' + stateIcon + '</span><span class="rt-info-icon" data-tooltip="' + tooltip + '" tabindex="0" aria-label="Tunnel details">' + infoIcon + '</span></span>',
        '  <span class="rt-cell rt-action">' + actionButton + '</span>',
        '</div>'
      ].join('');
    })
    .join('');

  const reverseBody = model.reverseTunnel.issue
    ? '<div class="empty">' + escapeHtml(model.reverseTunnel.issue) + '</div>'
    : [
        '<div class="rt-table">',
        '  <div class="rt-rows">' + reverseRows + '</div>',
        '</div>'
      ].join('');

  const keyToolbar = [
    '<button id="refresh" class="icon-button" title="' + escapeHtml(model.keyProjects.refreshing ? 'Refreshing...' : 'Refresh') + '" aria-label="' + escapeHtml(model.keyProjects.refreshing ? 'Refreshing...' : 'Refresh') + '" ' + (model.keyProjects.refreshing ? 'disabled' : '') + '><span class="action-icon" aria-hidden="true">' + getKeyProjectsToolbarIconSvg('refresh') + '</span></button>',
    '<button id="key-settings" class="icon-button secondary" title="Settings" aria-label="Settings"><span class="action-icon" aria-hidden="true">' + getKeyProjectsToolbarIconSvg('settings') + '</span></button>'
  ].join('');

  const keyDetailsByRepo = JSON.stringify(
    Object.fromEntries(
      model.keyProjects.rows.map((row: any) => [row.configuredRepoName, { title: row.detailTitle, text: row.detailText }])
    )
  ).replace(/</g, '\u003C');

  const keyRows = model.keyProjects.rows
    .map((row: any) => {
      return [
        '<button class="table-row" data-repo="' + escapeHtml(row.configuredRepoName) + '">',
        '  <span class="cell state" title="' + escapeHtml(row.stateLabel) + '">' + row.stateEmoji + '</span>',
        '  <span class="cell repo">' + escapeHtml(row.repoName) + '</span>',
        '  <span class="cell branch">' + escapeHtml(row.branch) + '</span>',
        '  <span class="cell remote">' + escapeHtml(row.remoteLabel) + '</span>',
        '</button>'
      ].join('');
    })
    .join('');

  let keyBody = '';
  if (model.keyProjects.issue) {
    keyBody = '<div class="empty">' + escapeHtml(model.keyProjects.issue) + '</div>';
  } else if (!model.keyProjects.configLoaded && !model.keyProjects.refreshing) {
    keyBody = '<div class="empty">Click Refresh to load key project status.</div>';
  } else if (!model.keyProjects.rows.length && model.keyProjects.refreshing) {
    keyBody = '<div class="empty">Refreshing key projects...</div>';
  } else if (!model.keyProjects.rows.length) {
    keyBody = '<div class="empty">No key projects configured.</div>';
  } else {
    keyBody = [
      '<div class="table-header">',
      '  <span class="cell state">State</span>',
      '  <span class="cell repo">Repo</span>',
      '  <span class="cell branch">Branch</span>',
      '  <span class="cell remote">Remote</span>',
      '</div>',
      '<div class="table-rows">' + keyRows + '</div>'
    ].join('');
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      margin: 0;
      padding: 12px;
      font-family: var(--vscode-font-family);
      font-size: 12px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    .stack {
      display: grid;
      gap: 8px;
    }
    .panel {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      overflow: hidden;
      background: color-mix(in srgb, var(--vscode-editor-background) 86%, transparent);
    }
    .reverse-block {
      display: grid;
      gap: 5px;
      justify-items: start;
    }
    .reverse-title {
      padding-left: 0;
      text-align: left;
    }
    .reverse-panel {
      width: 100%;
      justify-self: start;
      margin-left: 0;
      overflow: visible;
    }
    .key-block {
      display: grid;
      gap: 5px;
      justify-items: stretch;
    }
    .key-title {
      padding-left: 0;
      text-align: left;
    }
    .key-panel {
      width: 100%;
    }
    .panel-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 12px 10px;
      border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, transparent);
    }
    .panel-title {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .eyebrow {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--vscode-descriptionForeground);
    }
    .headline {
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .subline {
      color: var(--vscode-descriptionForeground);
      line-height: 1.4;
    }
    .tone {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--vscode-disabledForeground);
      flex: 0 0 auto;
    }
    .tone.connected, .dot.clean { background: var(--vscode-testing-iconPassed); }
    .tone.external { background: color-mix(in srgb, var(--vscode-testing-iconPassed) 62%, var(--vscode-descriptionForeground)); }
    .tone.starting { background: var(--vscode-testing-iconQueued); }
    .tone.failed, .dot.dirty { background: var(--vscode-testing-iconFailed); }
    .tone.stopped, .dot.unavailable { background: var(--vscode-disabledForeground); }
    .reverse-toolbar {
      display: flex;
      gap: 8px;
      padding: 12px 12px 10px;
    }
    .rt-table {
      padding: 0 12px 12px;
    }
    .rt-row {
      display: grid;
      grid-template-columns: 20ch minmax(16px, 1fr) 48px 54px;
      gap: 8px;
      align-items: center;
      box-sizing: border-box;
      width: 100%;
      min-height: 30px;
      padding: 7px 4px;
    }
    .rt-row {
      border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 65%, transparent);
    }
    .rt-row:last-child {
      border-bottom: 0;
    }
    .rt-cell {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .rt-host {
      display: inline-flex;
      align-items: center;
      width: 20ch;
    }
    .rt-host-code {
      width: 20ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      box-sizing: border-box;
      padding: 2px 5px;
      border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 82%, transparent);
      border-radius: 4px;
      background: var(--vscode-textCodeBlock-background, color-mix(in srgb, var(--vscode-editor-background) 76%, var(--vscode-foreground) 6%));
      color: var(--vscode-textPreformat-foreground, var(--vscode-foreground));
      font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
      font-size: 11px;
      line-height: 1.45;
    }
    .rt-state {
      grid-column: 3;
      display: inline-flex;
      gap: 6px;
      align-items: center;
      justify-content: flex-start;
      overflow: visible;
    }
    .rt-state-icon,
    .rt-info-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      flex: 0 0 auto;
    }
    .rt-state-icon svg,
    .rt-info-icon svg {
      width: 15px;
      height: 15px;
      display: block;
    }
    .rt-state-icon.connected { color: var(--vscode-testing-iconPassed); }
    .rt-state-icon.external { color: color-mix(in srgb, var(--vscode-testing-iconPassed) 62%, var(--vscode-descriptionForeground)); }
    .rt-state-icon.starting { color: var(--vscode-testing-iconQueued); }
    .rt-state-icon.failed { color: var(--vscode-testing-iconFailed); }
    .rt-state-icon.stopped { color: var(--vscode-disabledForeground); }
    .rt-info-icon {
      color: var(--vscode-descriptionForeground);
      opacity: 0.86;
      position: relative;
      cursor: help;
    }
    .rt-info-icon:hover,
    .rt-info-icon:focus {
      opacity: 1;
      color: var(--vscode-foreground);
      z-index: 60;
    }
    .rt-info-icon:hover::after,
    .rt-info-icon:focus::after {
      content: attr(data-tooltip);
      position: absolute;
      z-index: 50;
      top: calc(100% + 7px);
      right: -8px;
      width: min(280px, calc(100vw - 32px));
      box-sizing: border-box;
      padding: 9px 10px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
      font-size: 11px;
      line-height: 1.45;
      text-align: left;
      pointer-events: none;
    }
    .rt-info-icon:hover::before,
    .rt-info-icon:focus::before {
      content: '';
      position: absolute;
      z-index: 51;
      top: calc(100% + 2px);
      right: 4px;
      border: 5px solid transparent;
      border-bottom-color: var(--vscode-panel-border);
      pointer-events: none;
    }
    .rt-action {
      grid-column: 4;
      display: inline-flex;
      justify-content: flex-start;
    }
    .rt-action-button {
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 6px;
      height: 24px;
      min-width: 48px;
      padding: 0 8px;
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      cursor: pointer;
      font: inherit;
      transition: background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease, color 120ms ease, transform 120ms ease;
    }
    .rt-action-button.start {
      color: var(--vscode-testing-iconPassed);
    }
    .rt-action-button.stop {
      color: var(--vscode-testing-iconFailed);
    }
    .rt-action-button:hover:not(:disabled),
    .rt-action-button:focus-visible:not(:disabled) {
      background: color-mix(in srgb, var(--vscode-list-hoverBackground) 82%, var(--vscode-button-secondaryBackground, var(--vscode-button-background)));
      border-color: color-mix(in srgb, currentColor 52%, var(--vscode-focusBorder));
      box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 24%, transparent);
      transform: translateY(-1px);
      outline: none;
    }
    .rt-action-button.start:hover:not(:disabled),
    .rt-action-button.start:focus-visible:not(:disabled) {
      background: color-mix(in srgb, var(--vscode-testing-iconPassed) 18%, var(--vscode-button-secondaryBackground, var(--vscode-button-background)));
    }
    .rt-action-button.stop:hover:not(:disabled),
    .rt-action-button.stop:focus-visible:not(:disabled) {
      background: color-mix(in srgb, var(--vscode-testing-iconFailed) 16%, var(--vscode-button-secondaryBackground, var(--vscode-button-background)));
    }
    .rt-action-button:active:not(:disabled) {
      transform: translateY(0);
      box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 18%, transparent);
    }
    .rt-action-button:disabled {
      cursor: default;
      opacity: 0.6;
    }
    .rt-action-empty {
      color: var(--vscode-descriptionForeground);
      display: inline-flex;
      width: 48px;
      justify-content: center;
    }
    .actions {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: flex-start;
      align-items: center;
      justify-self: start;
      margin-top: 0;
    }
    button.action {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      border-radius: 6px;
      width: 30px;
      height: 30px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      line-height: 1;
      transition: background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
    }
    button.action:hover:not(:disabled) {
      background: color-mix(in srgb, var(--vscode-list-hoverBackground) 78%, var(--vscode-button-secondaryBackground, var(--vscode-button-background)));
      border-color: color-mix(in srgb, var(--vscode-focusBorder) 50%, transparent);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder) 18%, transparent);
      transform: translateY(-1px);
    }
    .action-icon {
      width: 14px;
      height: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: inherit;
      opacity: 0.96;
      flex: 0 0 auto;
      transition: transform 120ms ease, opacity 120ms ease;
    }
    button.action:hover:not(:disabled) .action-icon,
    .icon-button:hover:not(:disabled) .action-icon {
      opacity: 1;
      transform: scale(1.06);
    }
    .action-icon svg {
      width: 14px;
      height: 14px;
      display: block;
    }
    button.action.success .action-icon {
      color: var(--vscode-testing-iconPassed);
    }
    button.action.danger .action-icon {
      color: var(--vscode-testing-iconFailed);
    }
    button.action:disabled {
      cursor: default;
      opacity: 0.6;
    }
    .key-toolbar {
      display: flex;
      gap: 8px;
      padding: 12px 12px 12px;
    }
    .icon-button {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      border-radius: 6px;
      width: 30px;
      height: 30px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      line-height: 1;
      transition: background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
    }
    .icon-button:hover:not(:disabled) {
      background: color-mix(in srgb, var(--vscode-list-hoverBackground) 78%, var(--vscode-button-secondaryBackground, var(--vscode-button-background)));
      border-color: color-mix(in srgb, var(--vscode-focusBorder) 50%, transparent);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder) 18%, transparent);
      transform: translateY(-1px);
    }
    .icon-button.secondary {
      background: var(--vscode-button-secondaryBackground, var(--vscode-dropdown-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-dropdown-foreground));
    }
    .icon-button:disabled {
      cursor: default;
      opacity: 0.6;
    }
    .key-body {
      padding: 0 12px 12px;
    }
    .table-header, .table-row {
      width: 100%;
      display: grid;
      grid-template-columns: 36px minmax(124px, 180px) minmax(88px, 132px) minmax(96px, 148px);
      gap: 8px;
      align-items: center;
      box-sizing: border-box;
      padding: 8px 9px;
    }
    .table-header {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .table-row {
      border: 0;
      border-top: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, transparent);
      background: transparent;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .table-row:first-child { border-top: 0; }
    .table-row:hover { background: color-mix(in srgb, var(--vscode-list-hoverBackground) 88%, transparent); }
    .cell {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .table-row .state {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      line-height: 1;
    }
    .table-header .state {
      font-size: inherit;
      line-height: inherit;
      justify-content: flex-start;
    }
    .table-header .repo,
    .table-header .branch,
    .table-header .remote,
    .table-row .repo,
    .table-row .branch,
    .table-row .remote {
      justify-self: stretch;
      width: 100%;
      text-align: left;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      flex: 0 0 auto;
    }
    .empty {
      border: 1px dashed var(--vscode-panel-border);
      border-radius: 8px;
      padding: 12px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.45;
    }
    .detail-popover {
      position: fixed;
      display: none;
      width: min(340px, calc(100vw - 24px));
      max-height: min(240px, calc(100vh - 24px));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      overflow: hidden;
      background: var(--vscode-editor-background);
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.18);
      z-index: 30;
    }
    .detail-popover.open {
      display: grid;
      grid-template-rows: auto 1fr;
    }
    .detail-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .detail-title {
      font-size: 13px;
      font-weight: 600;
    }
    .detail-close {
      border: 0;
      background: transparent;
      color: var(--vscode-foreground);
      font-size: 18px;
      line-height: 1;
      padding: 4px 6px;
      cursor: pointer;
    }
    .detail-body {
      margin: 0;
      padding: 14px;
      overflow: auto;
      white-space: pre-wrap;
      user-select: text;
      -webkit-user-select: text;
      font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
      font-size: 12px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="stack">
    <section class="reverse-block">
      <div class="eyebrow reverse-title">Reverse Tunnel</div>
      <div class="panel reverse-panel">
        <div class="reverse-toolbar">${reverseActions}</div>
        ${reverseBody}
      </div>
    </section>
    <section class="key-block">
      <div class="eyebrow key-title">Pinned Projects</div>
      <section class="panel key-panel">
        <div class="key-toolbar">${keyToolbar}</div>
        <div class="key-body">${keyBody}</div>
      </section>
    </section>
  </div>
  <div id="detail-popover" class="detail-popover" aria-hidden="true">
    <div class="detail-head">
      <div id="detail-title" class="detail-title">Key Project Details</div>
      <button id="detail-close" class="detail-close" type="button" aria-label="Close">\u00D7</button>
    </div>
    <pre id="detail-body" class="detail-body"></pre>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('button.action[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.getAttribute('data-action');
        if (action) {
          vscode.postMessage({ type: 'action', action });
        }
      });
    });
    document.getElementById('refresh')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'action', action: 'keyRefresh' });
    });
    document.getElementById('key-settings')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'action', action: 'keySettings' });
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
      if (target instanceof HTMLElement && (target.closest('.table-row') || target.closest('#detail-popover'))) {
        return;
      }
      closeDetails();
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeDetails();
      }
    });
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message?.type !== 'detail' || !detailBody || !detailTitle || !detailPopover) {
        return;
      }
      const margin = 12;
      const width = Math.min(340, window.innerWidth - margin * 2);
      const height = Math.min(240, window.innerHeight - margin * 2);
      const left = Math.min(Math.max(Number(message.left ?? margin), margin), window.innerWidth - width - margin);
      const top = Math.min(Math.max(Number(message.top ?? margin), margin), window.innerHeight - height - margin);
      detailTitle.textContent = message.title || 'Key Project Details';
      detailBody.textContent = message.text || '';
      detailPopover.style.left = left + 'px';
      detailPopover.style.top = top + 'px';
      detailPopover.classList.add('open');
      detailPopover.setAttribute('aria-hidden', 'false');
    });
    document.querySelectorAll('.table-row').forEach((row) => {
      row.addEventListener('click', (event) => {
        const repoName = row.getAttribute('data-repo');
        if (repoName && detailBody && detailTitle && detailPopover) {
          const clientX = event instanceof MouseEvent ? event.clientX : 12;
          const clientY = event instanceof MouseEvent ? event.clientY : 12;
          const detail = keyDetailsByRepo[repoName];
          const margin = 12;
          const width = Math.min(340, window.innerWidth - margin * 2);
          const height = Math.min(240, window.innerHeight - margin * 2);
          const left = Math.min(Math.max(clientX + 8, margin), window.innerWidth - width - margin);
          const top = Math.min(Math.max(clientY + 8, margin), window.innerHeight - height - margin);
          detailTitle.textContent = detail?.title || 'Key Project Details';
          detailBody.textContent = detail?.text || 'Status not loaded. Click Refresh first.';
          detailPopover.style.left = left + 'px';
          detailPopover.style.top = top + 'px';
          detailPopover.classList.add('open');
          detailPopover.setAttribute('aria-hidden', 'false');
        }
      });
    });
  </script>
</body>
</html>`;
}

