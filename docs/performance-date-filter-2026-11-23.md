# ERP-989: prepare column-task date bounds once

## Checkpoint before this iteration

At the user's request, validated and pushed the preceding batch before any new
optimization edits: Board 39a26f1, ERP fe898c1b9. Remote branch tips matched and
both working trees were clean. Board build/strict type contracts, 17 focused
unit tests and 104 PostgreSQL/HTTP tests passed; ERP shared/server builds/type
contracts and 49 focused tests passed. ERP pre-push lint passed; the pre-commit
suite's previously reproduced 21 main-baseline failures were not rerun.

## Behavior contract before implementation

The user authorizes optimization with no existing business-rule changes.
The canonical flow is client Board API -> GET /columns/:id/tasks ->
TasksController -> TasksService.getByColumn -> findFilteredRootTaskIds.
TaskListQueryDto validates the optional ISO date strings. Existing code checks
access and inverted ranges before filtering. No new API/helper path is added.

Search covered matchesTaskDateRange and its only two call sites, the date query
DTO, column endpoint and client query builder, filter candidates, hierarchy
resolution and existing date/filter tests. Only bound parsing moves from the
per-task predicate to four request-local timestamps. Reuse the existing private
predicate with numeric bounds; do not add a date cache or runtime validation.

Preserve inclusive from/to comparisons, absent/empty bounds, NaN handling,
missing/invalid candidate dates, timestamps equal to zero and dates before the
epoch. Both date groups still participate in the same AND/short-circuit chain
with creator, priority, assignee and tag filters. SQL/options, selected candidate
attributes, authorization, archives, ancestor mapping, ordering, pagination,
errors and response fields stay unchanged. Do not interpret a numeric zero as
an absent filter. Invalid parsed bounds continue to match no valid dates.

These methods perform reads only: no writes, ORM hooks, transaction scopes,
afterCommit notifications, audit records or queue behavior are changed.
Dates remain Date model fields; types remain checked without new assertions.

Validate exact old/new full-helper results and repository calls, boundary and
epoch regressions, constant bound-parse count, small/large CPU timings, related
HTTP/PostgreSQL scenarios, types, build and lint. Publish only after checks.

## Results

The existing predicate now takes numeric bounds, with explicit undefined checks
so epoch zero remains an active bound. Four strings are parsed once per helper
call instead of up to four times per candidate. SQL, hydration and all business
conditions are unchanged. No type assertions or additional runtime validation.

500 deterministic full-helper comparisons against 39a26f1 matched result IDs and
repository arguments exactly. Cases include missing/invalid dates, missing/empty/
invalid bounds, negative/zero/positive timestamps, timezone offsets, both date
groups, creator/priority/association filters and root resolution.

Synthetic full-helper CPU medians, after warmup and 21 alternating batches:

| Candidates | Date bounds | Before, ms | After, ms |
| --- | --- | ---: | ---: |
| 50 | four | 0.0276 | 0.0076 |
| 10,000 | four | 5.7558 | 1.5220 |
| 50 | none | 0.0109 | 0.0072 |
| 10,000 | none | 1.6403 | 1.5318 |

No separate speedup is claimed for unfiltered/tiny workloads. Candidate reads
are stubbed identically; these are local CPU results, not production API latency.

Validation passed:

- 314 unit tests; 252 opt-in database tests skipped in this run.
- 130 PostgreSQL/HTTP task-date and Gantt/executor integration tests, including
  two new column-endpoint regressions for inclusive epoch bounds and rejection
  of invalid/inverted ranges without changing task state.
- Twelve new date-filter unit cases cover inclusive/exclusive adjacent values,
  epoch, negative timestamps, missing/invalid dates, empty/invalid bounds, roots
  and a constant count of four Date.parse calls.
- Strict type contracts, application typecheck, Nest build, changed-file ESLint,
  Prettier and git whitespace checks.

Artifacts in output/publish-erp-989: compare-task-date-filters.cjs,
task-date-filter-results.json, date-filter-unit.log, date-filter-integration.log.
The verified change is published on erp-989 at the end of this iteration; no
production writes, deployment, client/UI or database schema changes are involved.
