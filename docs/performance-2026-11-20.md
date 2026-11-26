# Board performance: activity feed and task hierarchy

## Behavior contract before implementation

Requested by the user: optimize Board and remove inefficient algorithms after the
observability analysis found long activity feed/count/read requests. The report
does not prove that all production delays originate in SQL.

The existing canonical flow is `TaskActivityController -> TaskActivityService`.
The ERP client calls it through `api/board.ts`, `stores/task-activity.ts` and
`useTaskActivityConnection`. Both personal and general feed return the same event
payload, historical task labels, current task location, actor, read state and
accessible project IDs. Initial/older pages are descending; incremental pages are
ascending, with limit + 1 determining the cursor. Both the original event project
and the task's current project must remain accessible and not deleted. Archived
tasks, columns and boards remain included as before. A recipient is not a grant
of access. No permissions are cached.

Feed and counts do not write anything. `markRead` changes only this user's unread
recipient rows for the selected task/project through the supplied event boundary,
returns the maximum changed event ID, and emits the existing read-state realtime
event once after successful SQL. Task mutation, history creation, recipients,
transactions and afterCommit delivery in `ActivityEventsService` stay unchanged.
Neither raw read SQL nor the existing recipient update invokes model hooks.

Column filtering runs through `TasksService.getByColumn ->
findFilteredRootTaskIds -> findRootTaskId`. Filters still apply to the same task
before mapping matching descendants to roots. A missing ancestor remains its own
root; a cyclic chain returns the originally requested task ID. Flat subtasks keep
their own IDs. Pagination, counts, archive rules, ordering and task hydration are
unchanged. The root-resolution cache is local to one filter call.

Existing solutions searched: all activity feed/count/read DTOs, interfaces,
controller/service/models/tests, activity event writes and recipients, project
access, migrations/indexes, task filtering/pagination, client API/store/realtime.
The implementation extends these canonical methods and retains the existing
event and recipient indexes. No parallel API,
client bypass, persistent cache or new business rule is introduced.

## Implementation and validation

- General feed: add an uncorrelated access-existence check, allowing PostgreSQL
  to skip the event/actor/task plan entirely when there are no readable projects.
  Existing source/destination checks still run for nonempty access. Personal feed
  retains its existing plan.
- Counts and mark-read retain their existing SQL; an additional unread predicate
  did not measurably reduce work in the benchmark, so it was not retained.
- Task hierarchy: memoize resolved ancestors per request, including a separate
  marker for paths ending in cycles, instead of repeatedly walking each chain.
- Validate using real PostgreSQL integration tests for permissions, relocation,
  archives, before/after cursors, snapshots, read boundaries and rollback;
  additional inaccessible-candidate and deep/cyclic hierarchy regressions;
  compare old/new query outputs and EXPLAIN ANALYZE on a dedicated synthetic DB;
  run unit tests, lint and build.

## Measured results

PostgreSQL 18.2, dedicated synthetic database: 600,000 events, 60,000 tasks,
1,000 users. Final median SQL execution times over three EXPLAIN ANALYZE runs:

| General feed reader | Before | After |
| --- | ---: | ---: |
| Limited project access | 2.716 ms | 2.426 ms |
| Broad project access | 1.666 ms | 1.686 ms |
| No readable projects | 2691.929 ms | 0.384 ms |

For the empty-access case the original query touched about 1.98 million shared
buffers and read about 104,000 blocks; the final query touched 46 buffers and
did not read event rows. A real PostgreSQL regression test checks that every
activity_events plan node has zero executed loops, without a flaky time limit.
The broad-access timings are effectively unchanged; no general speedup is claimed
for the normal personal/general feed or counters.

Root resolution for all 5,000 nodes of a shared chain: 769.25 ms before versus
1.67 ms after in the local comparison. The regression test bounds ancestor
lookups to linear work and covers cycles, incoming paths, missing parents and
request-local cache invalidation.

Validation completed:

- 294 non-database tests passed in 42 suites; database-dependent suites are
  separately opt-in and were skipped by this run.
- 21 PostgreSQL HTTP integration tests passed, including the new no-scan test,
  inaccessible destination candidates and both directions of general pagination.
- Exact old/new results matched for 48 feed combinations, three counters,
  four relocated-task access cases and two mark-read cases (including recipient
  state and websocket emission count).
- Nest/SWC build, application TypeScript check (`tsc -p tsconfig.build.json
  --noEmit --incremental false`), changed-file ESLint, Prettier and diff checks
  passed. Bun could not read the sandbox cwd, so equivalent installed Node
  entry points were used for these commands.
- Full `tsc --noEmit` also includes tests and reports existing errors in untouched
  environment-cookies, archive, task-comments and task-gantt test files. No new
  diagnostics refer to the changed files.

The final change touches only server query execution and in-request hierarchy
resolution. Client design, layout, interaction, DTOs, payloads, permissions,
archive behavior, read-state writes, realtime events, transactions and audit
history remain unchanged. No migration, production mutation or deployment was
performed. Production latency improvements require a deployed measurement;
these local results do not establish the cause of the report's 48-second tails.

Full plans, old/new query captures, comparison results and standalone local
benchmark fixtures are in the workspace sibling directory
`output/board-performance-2026-11-20`.

## Publication validation on current main

Before pushing `erp-989`, the change was rebased without conflicts onto
`origin/main` at `9b83106` (ERP-972). Build, application typecheck, changed-file
lint and all 21 activity integration tests passed again. The full suite on this
base reports 291 passed, 239 skipped and three failed expectations in unchanged
`tasks-history.service.spec.ts` and `tasks-time-entries.service.spec.ts`:
the updated access-check call supplies a fourth `undefined` argument while those
tests expect three arguments. The affected access-check implementation comes
from main; this change only alters activity feed selection and ancestor walking.
