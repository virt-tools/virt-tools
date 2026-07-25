---
name: cleanup-after-task
description: >
  Post-task context hygiene for Magic Context sessions. Tells the agent to call
  `ctx_reduce` to shed stale tool output and exploration chatter after finishing
  a unit of work, so the next task starts with a lean live window. Cache-aware —
  drops are queued and applied only at cache-safe moments, so this never causes a
  compaction pause or cache bust.
  Trigger: "cleanup after task", "reduce context", "shed tool output", "clean up",
  "post-task cleanup", or invoked after any completed feature/fix/refactor.
---

# Cleanup after task

After completing a unit of work (feature, fix, refactor, investigation), proactively shed the tool output and exploration chatter that task produced. This keeps the live context window lean for the next task without any compaction pause.

## Why

Magic Context's background historian auto-compacts when usage crosses the execute threshold (default 65%). But between those thresholds, stale tool output from a finished task sits in the live window consuming budget. `ctx_reduce` lets the agent mark that content for cache-aware removal — drops are **queued and applied only at cache-safe moments**, so there's no pause and no cache bust. Agent-controlled reduction is always on; this skill just makes the habit explicit.

## When to run

Run the cleanup step when **all** are true:
1. A discrete unit of work is complete (code shipped, tests pass, investigation answered, refactor merged).
2. The work produced non-trivial tool output — file reads, greps, bash runs, build/test output — that is no longer needed.
3. The user has acknowledged the task is done, OR you're about to transition to a new, unrelated task.

Do **not** run cleanup mid-task (the output may still be needed) or for trivial single-shot answers that produced little tool output.

## How

### Step 1 — Identify droppable tags

Scan the recent conversation for tool outputs that are no longer load-bearing:
- Large file reads whose content isn't being actively referenced.
- Exploratory greps/globs whose result has been acted on.
- Build/test/bash output that has been interpreted and isn't needed verbatim.
- Failed or superseded tool calls.

Each droppable item carries a `§N§` tag ID shown in the transcript. **Protected tags** (the most recent N, default 3) cannot be dropped immediately — they're deferred until they age out of the protected window. That's expected and safe.

### Step 2 — Call `ctx_reduce`

Call the `ctx_reduce` tool with a `drop` argument listing the tag IDs to shed:

```
ctx_reduce(drop="5,8,12-15")
```

Syntax: comma-separated IDs, ranges with hyphens (`3-5`), or a mix (`1,2,9-12`).

The tool returns a confirmation like:
```
Queued: drop §5§, §8§, deferred drop §12§. 2 requested tags were already queued and need no action.
```

- `drop` = applied immediately (cache-safe).
- `deferred drop` = queued, applied when the tag leaves the protected window.
- Already-queued/dropped tags are skipped harmlessly.

### Step 3 — Verify (optional)

If the user wants to see the effect, suggest `/ctx-status` (their command, not a tool) which shows tag counts, pending ops, and context breakdown. The agent cannot call slash commands — only the user types those.

## Rules

- **Never** call `ctx_reduce` on content you might still need this turn. If uncertain, leave it.
- **Never** call `ctx_reduce` to drop reasoning or assistant text — only tool output (`tool_result` parts). The tool enforces this; attempts on non-droppable content return an error.
- **One batch is enough.** Collect all droppable tag IDs from the finished task and call `ctx_reduce` once. Don't call it repeatedly for individual tags.
- **Don't drop the most recent ~3 tags** — they're protected anyway and will just be deferred. Focus on older, clearly-stale output.
- If `ctx_reduce` is unavailable (Magic Context not installed, DB not open, or `pluginConfig.enabled !== true`), skip silently — don't error or warn the user.

## What this is NOT

- Not a full compaction. The historian does that automatically at the execute threshold. `ctx_reduce` only sheds specific stale content.
- Not a slash command. The agent calls `ctx_reduce` as a tool; it cannot invoke `/ctx-wrapup`, `/ctx-flush`, or `/ctx-recomp` — those are user-typed slash commands with no agent-facing API.
- Not a memory operation. To persist durable project knowledge, use `ctx_memory(action="write", ...)`. `ctx_reduce` is ephemeral context cleanup.

## Example

User: "Add a password strength meter to the signup form."
[agent does the work: reads 4 files, greps for the form component, edits 2 files, runs the dev server, runs tests]
Agent: "Done — strength meter added, tests pass."
→ Now run cleanup: scan the transcript for the file-read and grep tag IDs that are no longer needed, call `ctx_reduce(drop="22,24,27-30")`, then report "Context cleaned up — shed N tags of stale tool output from this task."