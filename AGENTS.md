# AGENTS.md

## Default Packaging Rule
- After every code change, build a VSIX package by default for user testing.
- Exception 1: skip packaging when the user explicitly requests not to package.
- Exception 2: skip packaging when there are no code changes.
