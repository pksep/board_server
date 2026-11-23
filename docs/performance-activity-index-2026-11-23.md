# ERP-989: task activity lookup index

## Evidence and behavior contract before implementation

The supplied 13–20 November observability export reports paired activity feed
and count delays up to 48 seconds and a read request lasting 26 seconds. It does
not contain SQL/pool waits sufficient to attribute those tails to PostgreSQL.
The user authorizes improving these paths with existing business rules intact.

Canonical flow: client `stores/task-activity.ts` calls `api/board.ts` for
`PATCH /activity/task-feed/read`; `TaskActivityController` takes the session user
and validated `ReadTaskActivityDto`, then invokes `TaskActivityService.markRead`.
`TaskActivityReadResult` supplies the maximum changed event ID, or zero.
The feed and counts observe those same recipient rows.

Invariants:

- Application SQL, DTOs, returned fields, validation and ordering stay unchanged.
- Both the historical and current task projects must still be accessible and
  undeleted. Ownership/membership, archives and recipient rules stay unchanged.
- Only this user's unread recipient rows for the selected task/project through
  the same snapshot boundary may receive CURRENT_TIMESTAMP. Already-read
  timestamps and other recipients remain unchanged.
- Preserve the single SQL statement/snapshot, zero-result behavior, errors and
  the existing realtime emission after success, including its error handling.
- Preserve model hooks, task writes, event creation, audit history, transaction
  ownership/afterCommit and queue jobs. The index adds none of these operations.

Repository-wide search found all production task-event writers in
`TasksService` using `String(id)` of integer task IDs via `ActivityEventsService`.
The recipient/event models and July/October migrations already supply event-ID,
project and text-entity indexes. None indexes the existing `entity_id::integer`
join expression. Replacing that comparison with text equality would change
matching for numeric strings such as `001`, so it is deliberately retained.

Only a partial expression index on task events will be added; non-task entity
IDs are excluded. Numeric string matching (including leading zeroes) stays the
same. As with the existing task-feed cast, task entity IDs must be valid int32
values; no data repair or normalization is included.

The existing November Board index migration is the canonical deployment pattern:
build/drop CONCURRENTLY outside a transaction, use IF NOT EXISTS, and remove an
invalid index left by an interrupted build before retrying. Reuse that pattern
with a distinct named index and a symmetric down. No deployment is requested;
run the migration only on dedicated local test databases during this task.

## Candidate selection

On a dedicated synthetic database with 600,000 events, both a direct UPDATE FROM
rewrite and an extra unread predicate sped up a mostly-read project, but worsened
the all-unread project from about 70 ms to 330–370 ms. Neither SQL change is kept.

An expression-index prototype with the original SQL improves individual-task
reads without that rewrite. Verify the final migration with before/after SQL
plans, exact changed-recipient comparisons, the authenticated activity regression
suite, up/down/retry and interrupted-build recovery tests. Compare feed/counts
and original read timestamps as well; do not equate local timings with a fix for
the report's network-visible 26–48 second tails.

## Results

Only the new index migration and regression tests are retained. Service SQL,
models, client code, business rules and event delivery are unchanged.

PostgreSQL 18.2, 600,000 synthetic events / 60,000 tasks, original read SQL:

| Read scenario | Before, ms | With index, ms | Changed recipient rows |
| --- | ---: | ---: | ---: |
| Task, sparse recipient history | 11.070 | 7.598 | 9 |
| Task, large mostly-read history | 62.158 | 1.710 | 8 |
| Task, large unread history | 63.635 | 8.653 | 10 |
| Task, no readable projects | 0.149 | 0.100 | 0 |

Medians of three measured EXPLAIN ANALYZE executions after warmup, with rollback
and recipient VACUUM/ANALYZE outside each measured statement. All eight tested
task/project workloads changed exactly the same recipient IDs before and after
the index. Project-read buffer counts were effectively unchanged; no project-read
speedup is claimed from those timings. The new index is about 12.9 MiB for
600,000 events. Inserting 1,000 events with 1 KiB metadata measured 7.526 ms
without it and 7.761 ms with it (roughly 3% added work in that fixture).

Twelve exact feed/count comparisons across sparse, mostly-read, unread and
empty-access users matched. Feed timings remained in the same low-millisecond
range. Counts remain a separate candidate: extended recipient statistics and
pre-grouping events did not provide a robust enough improvement across workloads
and were not retained. No pool-size/concurrency/retry changes were made.

Validation:

- All 24 authenticated PostgreSQL/HTTP activity integration tests passed with
  the index installed, including source/destination permission changes, snapshot
  boundaries, archives, transaction rollback and afterCommit notifications.
- Three new regressions verify legacy numeric IDs, non-task text IDs, old read
  timestamps, other recipients, unchanged feed/count results across up/down,
  repeated migration execution and recovery of an invalid concurrent index.
- Nest/SWC build, application TypeScript check, changed-test ESLint, migration
  JavaScript syntax, formatting and diff checks passed.

The migration uses CREATE/DROP INDEX CONCURRENTLY and does not run in a
transaction. It is intended for the existing integer task-ID invariant; corrupt
task entity IDs outside int32 would prevent its creation, just as they are
incompatible with the existing task-feed cast. It neither repairs rows nor
changes the API's validation. Deployment and production measurements remain
outstanding; this local change does not establish the cause of the report's
48-second tail, the 5xx responses or the UI errors whose stacks were not exported.

Artifacts: workspace `output/board-performance-2026-11-23/` files
`activity-index-probe.json`, `activity-index-surface.json`,
`activity-index-integration.log` and their `probe-activity-*.cjs` scripts.
Rejected experiments are also saved there for reproducibility. Changes remain
local on `erp-989` pending the next requested publication.
