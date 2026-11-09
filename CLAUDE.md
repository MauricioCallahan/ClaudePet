# ClaudePet

## Development workflow

### Planning
- Each milestone in ROADMAP.md has main bullets. Break every bullet into 5 tasks.
- Number tasks as M<milestone>-<bullet>.<task> (e.g. M1-3.2 = milestone 1, bullet 3, task 2).
- Task lists live in docs/milestone-<N>.md (ROADMAP.md has the overview). Tick tasks off as they land.

### Branching
- `production` is the default branch: released milestones only. `development` collects finished bullets.
- Start every bullet on a new branch from an up-to-date `development`, named `m<milestone>-<bullet>-<short-name>` (e.g. `m1-3-hotkey`). Never commit directly to `development` or `production`.
- Fold a fix for the current task into that task's commit (`git commit --amend`, or `git commit --fixup` + `git rebase -i --autosquash` before pushing). No separate "fix build" commits.
- When the bullet is reviewed and all findings are resolved, push the branch and open a PR into `development` titled `M1-3: <bullet summary>`. I merge it with **Squash and merge**; do not merge it yourself.
- At the end of a milestone, open a PR from `development` into `production` and tag the merge (e.g. `v0.1-m1`) after I merge it.

### Per task
1. Plan the implementation first: files touched, approach, how to verify it.
2. Implement only that task.
3. Verify: `npm test` passes (it also builds), plus `npm run lint` once it exists (M3-3.2), and the task's "done when" check works.
4. Commit once per task: `M1-3.2: <short summary>`.
5. Do NOT run /ponytail-review here. Go straight to the next task.

### After the bullet is complete (all 5 tasks committed)
1. Run /ponytail-review once, over the combined diff of that bullet's branch
   (`git diff development...HEAD`), and read every finding.
2. **Must fix** (bug, security, data loss, crash): do not ask. Plan the fix,
   implement it, and commit it as `M1-3 review: <finding>`.
3. **Should fix / Nice to have**, or anything that changes a later task: stop and
   ask me before doing it. List these findings with their numbers so I can
   answer "fix 2 and 5".
4. Once I've answered and the fixes are committed, open the PR (see Branching).
   Start the next bullet only after that PR is merged.

### Unclear requirements
If a task is ambiguous, suggest a default and ask before building.
