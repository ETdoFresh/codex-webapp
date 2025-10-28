---
description: Generate an imperative git commit subject from current changes and push it
argument-hint: "[optional subject hints]"
---

Review the working tree and staged changes to craft a git commit message automatically.

1. Run `git status --short` and summarize every file that changed.
2. Inspect the diff (`git diff --cached` and `git diff`) to understand the intent.
3. Produce a commit subject that:
   - Starts with one of **Add**, **Allow**, **Enhance**, **Fix**, **Improve**, **Refactor**, **Remove**, or **Update**.
   - Uses the imperative mood, in title case, ≤ 72 characters, and has **no trailing period**.
   - Reflects the primary change set clearly.
4. Confirm the subject aloud, then stage everything (`git add -A`).
5. Commit with the generated subject and include the fixed trailer: `Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>`.
6. Push to `origin/$(git rev-parse --abbrev-ref HEAD)`.
7. Report the exact commands you ran and the final commit hash.

If the subject cannot meet the rules, stop and ask for guidance instead of committing.
