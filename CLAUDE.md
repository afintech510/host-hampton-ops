# Host Hampton

All project instructions live in `AGENTS.md` (imported below). The essentials, so they are never missed. Section 0 of `AGENTS.md` has the full SOP.

- **Never push to `main`.** A change ships by: own worktree off `origin/main` -> commit -> PR -> `pr-check` green -> `gh pr merge --squash` (the merge deploys) -> watch the Deploy run + load the site -> remove the worktree and branch.
- **Never edit or commit in the main checkout** `host-hampton-ops`, and never touch another session's worktree or branch.
- **Shell git commits are authorized in all sessions** (owner ruling, 2026-11-08). Use `git commit -F <msgfile>` with explicit file paths, never `git add -A`. Never stop at "ready to commit".
- **"Done" means merged and deployed.** Ask first only for nginx / ports 80-443 / `hampton_net`, an unapplied migration, or a test that would text, email or charge a real customer.
- A failed deploy gets a fix or revert PR, never a push to `main`.

@AGENTS.md