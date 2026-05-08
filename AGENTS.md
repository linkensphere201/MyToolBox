# AGENTS.md

## Project Overview
- This repository is a VS Code extension named `code-ops-panel-extension` / `CodeOps Panel`.
- The extension runs as `extensionKind: ["ui"]`; SSH and Git helper processes should be treated as local UI-host processes unless the code explicitly shells into a remote target.
- The current user-facing CodeOps Panel webview contains three areas:
  - `Reverse Tunnel Proxies` for SSH reverse tunnels.
  - `Pinned Projects` for configured Git repository health checks.
  - `Favorite Workspaces` for saved `.code-workspace` files.

## Important Files
- `src/app.ts` wires activation, commands, status bars, config loading, process execution, and test-only commands.
- `src/reverseTunnel/config.ts` owns ToolBox config path resolution, reverse tunnel config parsing, default JSON content, and runtime config shaping.
- `src/reverseTunnel/service.ts` is the service wrapper around reverse tunnel dependencies.
- `src/pinnedProjects/gitStatus.ts` parses `git status --porcelain=v2 --branch` and formats sync labels.
- `src/pinnedProjects/remoteBatch.ts` builds SSH-side batch scripts for remote key project refreshes.
- `src/pinnedProjects/service.ts` is the service wrapper around pinned-project dependencies.
- `src/webview/render.ts` renders the ToolBox webview HTML/CSS/JS.
- `src/webview/toolBoxWebview.ts` owns webview registration, refresh, and message dispatch.
- `test/suite/extension.test.ts` covers VS Code command and integration behavior.
- `test/suite/pure.test.ts` covers pure helpers.
- `resources/mytoolbox.config.json` is the built-in unified ToolBox fallback template.

## Default Packaging Rule
- After every code change, build a VSIX package by default for user testing.
- Exception 1: skip packaging when the user explicitly requests not to package.
- Exception 2: skip packaging when there are no code changes.
- Exception 3: skip packaging when the only changed files are under `media/`.
- Documentation-only changes do not require a VSIX package.

## Validation
- For TypeScript/code changes, run `npm run compile` before finishing.
- For test changes or behavior changes, run `npm test` unless the user explicitly asks to skip tests or the environment blocks VS Code extension tests.
- `npm test` already runs `npm run compile` and `npm run compile-tests` through `pretest`.
- If packaging is required, use:

```bash
npm run package:vsix
```

- The packaging script reads `package.json` and writes `release-artifacts/code-ops-panel-extension-v<major>.<minor>.vsix`.
- If `vsce` is unavailable and packaging is required, use `npx @vscode/vsce package --out release-artifacts/code-ops-panel-extension-v0.1.vsix`.
- Do not package after documentation-only changes.

## Configuration Notes
- CodeOps Panel config is selected by the VS Code setting `myToolbox.configFile`.
- The default workspace-local CodeOps Panel config path is `.vscode/mytoolbox.config.json`; it should normally remain outside Git.
- A relative `myToolbox.configFile` resolves from the workspace in local windows, from the local home directory in remote-ssh windows, then falls back to `resources/mytoolbox.config.json` for loading.
- Reverse tunnel JSON must contain a top-level `ReverseTunnel` object.
- Pinned Projects config lives in the same `myToolbox.configFile` JSON as a top-level `keyProjects` object.
- Favorite Workspaces config lives in the same JSON as top-level `favoriteWorkspaces.workspaceFiles`.
- `keyProjects` uses `mode`, `rootDir`, `repoNames`, `sshTarget`, `sshPort`, `gitPath`, and `sshPath`.
- In `keyProjects.mode === "ssh"`, Git checks run through local `sshPath` against `sshTarget`; otherwise they run locally through `gitPath`.

## Process Safety
- Reverse tunnel start/stop behavior owns `ssh` child processes spawned by the extension. Do not add broad process-kill logic.
- External tunnel detection should remain conservative: tunnels not started by this extension may be shown as external but must not be stopped by the extension.
- When changing SSH command construction, preserve `ExitOnForwardFailure=yes`, server alive options, and identity-file handling unless the task explicitly requires otherwise.
- When changing Pinned Projects refresh behavior, preserve fetch warnings as non-fatal so status can still display when possible.

## Emoji Safety Rule
- Do not rely on terminal encoding when writing emoji into source or test files.
- When code needs emoji literals, prefer Unicode escape sequences such as `\u2714\uFE0F`, `\u2757`, and `\u26A0` so packaged output stays correct.
- If the terminal shows `?` in place of emoji, treat that as a file-content corruption risk and fix the source before packaging.

## Webview Guidance
- Keep CodeOps Panel UI text compact; this webview lives in the VS Code side bar.
- Prefer VS Code theme variables over hard-coded colors where practical.
- Keep command IDs and posted message action names stable because tests call command surfaces directly.
- Do not add external webview assets unless they are packaged and covered by the webview CSP.

## Escalated Edit Rule
- If a required code or test edit cannot be completed safely inside the sandbox, use escalated editing instead of forcing repeated partial edits.
- Before escalated edits, verify the target file and intended replacement range first.
- After escalated edits, immediately run the relevant validation steps, and if code changed, package the VSIX unless an existing exception applies.
