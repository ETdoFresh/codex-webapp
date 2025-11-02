---
description: Generate an imperative git commit subject from current changes and push it
argument-hint: "[optional subject hints]"
---

Review the working tree and staged changes to craft a git commit message automatically.

1. Run `git status --short` and summarize every file that changed.
2. Inspect the diff (`git diff --cached` and `git diff`) to understand the intent of each modification.
3. Produce a commit subject that:
   - Starts with one of **Add**, **Allow**, **Enhance**, **Fix**, **Improve**, **Refactor**, **Remove**, or **Update**.
   - Uses the imperative mood in Title Case, stays at or below 72 characters, and avoids unnecessary trailing punctuation.
   - Reflects the primary change set clearly.
4. When the diff warrants extra context, craft a commit body immediately after **one** blank line that lists 2–5 bullet points, each beginning with an imperative verb and mirroring our style (e.g., "- Introduce …", "- Update …"). Keep the bullet list contiguous (no blank lines between bullets). Capture the key technical details, major files, or impacts from the change. For tiny, self-explanatory commits, you may omit the bullet section entirely.
5. Confirm the subject and bullet list aloud, then stage everything with `git add -A`.
6. Commit using the generated subject, include the bullet list body when present, and avoid adding trailing signatures or co-author trailers.
7. Push to `origin/$(git rev-parse --abbrev-ref HEAD)`.
8. Report the exact commands executed and the final commit hash.

📌 **Style examples from this repo**

```text
Update Provider Model Filtering With Scoped Model Lists

- Add modelsByProvider map to backend metadata.
- Normalize models-by-provider payload in the client fetch/update flows.
- Filter the UI model dropdown based on the active provider selection.
```

```text
Refactor path truncation logic for improved display

- Introduce MAX_DISPLAY_LENGTH constant for predictable truncation.
- Normalize slash handling to preserve readable directory tails.
- Simplify the fallback path formatting in the chat header.
```

```text
Allow users to select a provider for AI interactions

- Add provider field to CodexMeta and propagate through the backend routes.
- Persist the user's provider choice via local storage hydrations.
- Render a provider dropdown in the composer and invalidate cached threads on change.
```

```text
Fix textarea focus outline
```

If the subject or bullet points cannot satisfy these rules, stop and ask for guidance before committing.
