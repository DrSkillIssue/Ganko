---
description: generate changeset from recent commits
subtask: true
---

Generate a changeset file for the `.changeset/` directory based on recent git activity.

## Instructions

1. Review the git log, diff, and status below
2. Determine which packages were affected:
   - `packages/solid-shared/` → `"@solid-lint/shared"`
   - `packages/solid-lint/` → `"solid-lint"`
   - `packages/solid-lsp/` → `"@solid-lint/lsp"`
   - `packages/solid-vscode/` is private — never include it
3. Determine the bump type for each affected package:
   - `major` — breaking changes (removed exports, renamed APIs, changed behavior)
   - `minor` — new features (new rules, new exports, new CLI flags)
   - `patch` — bug fixes, performance improvements, internal refactors
4. Write a summary that explains WHY from the end user's perspective, not WHAT changed internally
5. Be specific — not "improved type safety" but "fix false positive in `no-unused-signals` when signal is passed to a component prop"
6. Write the changeset file to `.changeset/` with this exact format:

```markdown
---
"package-name": patch
---

Summary of what changed and why it matters to users.
```

Multiple packages in one changeset if they changed together:

```markdown
---
"@solid-lint/shared": minor
"solid-lint": minor
---

Summary here.
```

## GIT LOG (recent commits not yet in a changeset)

!`git log $(git describe --tags --abbrev=0 2>/dev/null || echo $(git rev-list --max-parents=0 HEAD))..HEAD --oneline --no-merges`

## GIT DIFF --stat (files changed)

!`git diff $(git describe --tags --abbrev=0 2>/dev/null || echo $(git rev-list --max-parents=0 HEAD))..HEAD --stat`

## EXISTING CHANGESETS

!`ls -la .changeset/*.md 2>/dev/null || echo "No changesets yet"`

## GIT STATUS --short

!`git status --short`
