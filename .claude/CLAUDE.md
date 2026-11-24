# ClaudePet

## Canary

At the beginning of each new session, include the phrase "Project context verified: BeanBeans-27" in your first response.

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
- Attribution goes in once. Task and review commits carry **no** `Co-Authored-By` line (squash merge would repeat it once per commit). The PR description ends with one note naming Claude and the current model, in the usual trailer form (`Co-Authored-By: Claude <model> <noreply@anthropic.com>`), and nothing else for attribution. The squash message uses the PR title and description, so it lands once at the bottom.
- PR description format: one line per commit, `- M1-3.2: <what it does, one short sentence>` (the review commit gets one line plus its findings), then a blank line, then the single Claude/model note last.
- At the end of a milestone, open a PR from `development` into `production` and tag the merge (e.g. `v0.1-m1`) after I merge it.

### Per task
1. Plan it (see Plan).
2. Implement only that task.
3. Verify (see Check): `npm test` passes (it also builds), plus `npm run lint` once it exists (M3-3.2), and the task's "done when" check works.
4. Commit once per task: `M1-3.2: <short summary>`. The summary is the concise definition of the task; no `Co-Authored-By` trailer (see Branching).
5. Do NOT run /ponytail-review here. Go straight to the next task.



### After the bullet is complete (all 5 tasks committed)
1. Run `npm run e2e` (once it exists) and `npm run e2e:real` (the app against the real Claude Code; spends a little usage) and make sure both pass, then run /ponytail-review once, over the combined diff of that bullet's branch
   (`git diff development...HEAD`), and read every finding.
2. **Must fix** (bug, security, data loss, crash): do not ask. Plan the fix and implement it.
3. **Should fix / Nice to have**, or anything that changes a later task: stop and
   ask me before doing it. List these findings with their numbers so I can
   answer "fix 2 and 5".
4. Once I've answered, put every review fix (must fix and the ones I chose) in
   **one** commit, `M1-3 review: <short summary>`, with the findings listed in its
   body. Not one commit per finding. Then open the PR (see Branching).
   Start the next bullet only after that PR is merged.

## Answer rules

Follow these in order. They apply to code changes and to written answers. If they conflict with the workflow above, these rules win.

### Plan

1. **Read first.** Read the request and the code or text it touches before you propose anything. Do not answer from assumptions about a file you have not opened.
2. **State the goal in one sentence.** If you cannot, the request is unclear: suggest a default and ask before building.
3. **List everything the change must reach:** callers, tests, fixtures, config, exports, docs. That list is the scope. Extra features are not in scope.
4. **Check what could break:** data that would be lost or exposed, callers that would stop working, behavior users rely on.
5. **Pick the smallest complete solution.** Take the first of these that fully works:
   1. Do nothing, because it is not needed. Say so.
   2. Reuse something already in the codebase, the way the surrounding code uses it.
   3. Use the standard library or a platform feature.
   4. Use a dependency that is already installed. Do not add one for a few lines.
   5. Write the minimum new code.
6. **Decide how you will verify it** before you write it: which test, command, or observable behavior proves it works.
7. **Follow this file and the existing conventions of the code.** They override your defaults.
8. **Ask only when the answer changes what you do.** For a choice with a normal default, pick it, say so, and continue.

### Check

1. **Run it.** Build, run the tests, run the linter. Reading the code is not verification.
2. **Check the "done when" behavior itself,** not only that tests pass.
3. **Re-read your diff as a reviewer.** Look for: wrong logic on edge cases (empty, null, zero, very large, duplicate, concurrent), missing error handling, leftover debug code, and changes outside the scope.
4. **Check every item on the scope list from Plan rule 3.** Each one is either updated or confirmed unaffected.
5. **Never cut these:** validation of outside input, error handling that prevents data loss, security, accessibility, anything the user asked for.
6. **New non-trivial logic gets a test** (a branch, a loop, a parser, anything about money or security). Trivial changes do not need one.
7. **Check facts you state.** If you name a file, function, flag, or version, confirm it exists. If you are not sure, look it up or say you are not sure.
8. **Compare the result to the request word by word.** Every part asked for is done, and nothing unrequested was added.

### Fix

1. **Reproduce the problem first.** Read the actual error or failing output. Do not guess.
2. **Find the root cause.** Before editing, search for every caller of the function you will touch. Fix the cause once, in the shared code, not the symptom in each caller.
3. **Make the smallest fix that is correct.** Do not refactor nearby code while fixing.
4. **Keep safety code.** Code you move or merge keeps its validation and error handling.
5. **Re-run the check that failed, then the full checks.** A fix is not done until the original failure is gone and nothing else broke.
6. **If the same fix fails twice, stop and rethink** the diagnosis instead of trying variations.
7. **Fold the fix into the commit it belongs to** (see Branching).
8. **Severity decides who decides.** Bugs, security holes, data loss, and crashes: fix without asking. Style or optional improvements: list them and ask.

### Report

1. **Lead with the result:** what changed or what the answer is.
2. **Report outcomes truthfully.** If a test fails, show the output. If you skipped a step, say so. If it is verified, say it plainly.
3. **End with what you did not check** and any risk the user must know.
4. **Confirm before any action that is hard to undo or visible to others** (delete, force-push, publish, send). Approval for one action does not cover the next.
