# ClaudePet

## Development workflow

### Planning
- Each milestone in ROADMAP.md has main bullets. Break every bullet into 5 tasks.
- Number tasks as M<milestone>-<bullet>.<task> (e.g. M1-3.2 = milestone 1, bullet 3, task 2).
- Task lists live in docs/milestone-<N>.md (ROADMAP.md has the overview). Tick tasks off as they land.

### Per task
1. Plan the implementation first: files touched, approach, how to verify it.
2. Implement only that task.
3. Verify: `npm test` passes (it also builds), plus `npm run lint` once it exists (M3-3.2), and the task's "done when" check works.
4. Commit once per task: `M1-3.2: <short summary>`.
5. Do NOT run /ponytail-review here. Go straight to the next task.

### After the bullet is complete (all 5 tasks committed)
1. Run /ponytail-review once, over the combined diff of that bullet's 5 commits
   (e.g. `git diff <commit before M1-3.1>..HEAD`), and read every finding.
2. **Must fix** (bug, security, data loss, crash): do not ask. Plan the fix,
   implement it, and commit it as `M1-3 review: <finding>`.
3. **Should fix / Nice to have**, or anything that changes a later task: stop and
   ask me before doing it. List these findings with their numbers so I can
   answer "fix 2 and 5".
4. Move on to the next bullet only after I've answered.

### Unclear requirements
If a task is ambiguous, suggest a default and ask before building.
