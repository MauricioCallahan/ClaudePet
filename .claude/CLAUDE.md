# ClaudePet

### Planning
- When asked to plan a GitHub issue, write the plan to docs/issues/issue-<number>-<short-name>.md (e.g. `issue-24-concise-deny.md`). 

### Git branch Architecture
- 'production' is main branch, only released milestone are merged to this branch.
- 'development' is the working branch where implementation occurs.
- When implementing tasks only branch of the development branch.
- Limit PR description format: one line per commit.

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
