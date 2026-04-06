---
name: make-commit
description: Analyze current project changes, propose a short Russian commit message, and choose the correct semver bump for `package.json`. Use when the user asks to prepare a commit, determine PATCH/MINOR/MAJOR, bump the project version before a release, or summarize staged/unstaged changes into commit metadata.
---

# Make Commit

Inspect the current project changes, decide the semver bump, update only `package.json.version`, and return a compact result the user can use for a commit.

Prefer `PATCH` when the change type is ambiguous.

## Workflow

1. Inspect the current changes.
Use `git status --short` and a focused diff summary to understand the main change.

2. Read the current version from `package.json`.
Update only the `version` field. Do not change other fields while applying the version bump.

3. Classify the bump strictly by semver.
- `MAJOR`: any breaking change
- `MINOR`: new functionality without breaking changes
- `PATCH`: bug fixes, minor refactors, small improvements without new functionality
- If unsure, choose `PATCH`

4. Write a short Russian commit message.
Reflect the main user-visible or engineering-relevant change. Keep it compact and specific.

5. Return the result in the required format.
Always use:

```text
Коммит: ...
Версия: old -> new
```

## Constraints

- Use a Russian commit message.
- Keep the message short.
- Base the bump on the actual change set, not on guesswork.
- If `package.json` is missing or has no `version`, state the blocker clearly instead of inventing a value.
- If the user asked only for analysis and not for edits, still report the intended version bump without silently changing files.

## Example Output

```text
Коммит: Исправить потерю первого клика при голосовании
Версия: 1.6.0 -> 1.6.1
```
