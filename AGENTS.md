# AGENTS.md

## Default Packaging Rule
- After every code change, build a VSIX package by default for user testing.
- Exception 1: skip packaging when the user explicitly requests not to package.
- Exception 2: skip packaging when there are no code changes.
- Exception 3: skip packaging when the only changed files are under `media/`.

## Emoji Safety Rule
- Do not rely on terminal encoding when writing emoji into source or test files.
- When code needs emoji literals, prefer Unicode escape sequences such as `\u2714\uFE0F`, `\u2757`, and `\u26A0` so packaged output stays correct.
- If the terminal shows `?` in place of emoji, treat that as a file-content corruption risk and fix the source before packaging.

## Escalated Edit Rule
- If a required code or test edit cannot be completed safely inside the sandbox, use escalated editing instead of forcing repeated partial edits.
- Before escalated edits, verify the target file and intended replacement range first.
- After escalated edits, immediately run the relevant validation steps, and if code changed, package the VSIX unless an existing exception applies.
