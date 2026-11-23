# Board: participant context and project positions

## Behavior contract before implementation

The user requested further Board optimization on `erp-989`.

The executor-card flow is `TasksController.getByExecutor ->
TasksService.getPersonalTasks`, called through the existing client Board API for
production resource queues. The SQL access checks, selected page and location
context remain canonical. The response keeps the same tasks, pagination,
permissions, metadata and parent labels. `displayContext.users` contains only
users referenced by that task's controllers, responsible users, assignments or
participant-valued custom attributes. Their order remains the order returned by
the existing batched User query. Parent lookup keeps the same absent-parent
behavior. The ordinary personal list does not load display users.

The project-position flow is `ProjectsController.create/update ->
ProjectsService.getNextMemberOrders`. A newly added membership receives one more
than that user's largest existing order, with zero as the lower bound/default.
Historical memberships, including memberships of archived projects, remain in
that calculation. The lookup stays in the caller's existing transaction. It does
not write rows or invoke write hooks. Project saves, membership bulk inserts,
commit/rollback, validation and audit/realtime behavior are unchanged.

Existing implementations searched and traced: task personal/executor SQL and
display-context interfaces, project creation/update/reorder, project access,
member models, project and task tests, client Board API/project mapper and MCP
consumers. The existing methods are extended rather than creating another API or
alternative permission path.

## Changes

- Index task references by participant once; traverse the batched user result
  once, preserving its ordering while distributing users to their tasks.
- Deduplicate requested parent IDs and use a map for parent lookup.
- Calculate MAX(COALESCE(order, 0)) per user in PostgreSQL rather than transferring
  every membership row. Keep the existing default map and transaction.
- Compare old/new results and timings; test exact per-task user visibility/order,
  duplicate references, absent users/parents, ordinary personal lists, and project
  order boundaries. Run application build/typecheck and relevant tests.

## Other measured candidate

Project list/detail queries join participants and tags, multiplying rows. A
prototype reduced a four-project list with 40 members and 30 tags per project
from about 73 ms to 8 ms. Separating all associations adds round trips on small
projects; a two-query prefetch variant also changed the incidental tag ordering.
Those prototypes were not retained. Project list/detail serialization and tag
ordering are outside this change.

## Results

Baseline: `6d4ee30` on `erp-989`. Local measurements compare identical inputs and
assert old/new result equality; they do not measure production API latency.

| Workload | Before | After |
| --- | ---: | ---: |
| Prepare context for 1 card, 3 referenced users | 0.048 ms | 0.046 ms |
| Prepare context for 50 cards, 5 referenced users per card | 1.290 ms | 0.139 ms |
| Prepare context for 100 cards, 50 referenced users per card | 99.227 ms | 2.023 ms |
| Position lookup, one member with 2,000 memberships | 7.119 ms / 2,000 rows | 1.573 ms / 1 row |
| Position lookup, ten members with 20,000 memberships | 39.544 ms / 20,000 rows | 3.659 ms / 10 rows |

The card measurements isolate preparation and joining of already selected data;
database reads are stubbed equally on both implementations. Position measurements
use real PostgreSQL with 200,000 synthetic rows. Empty lookup remained below 1 ms
in both versions (0.506 vs 0.627 ms); no speedup is claimed there. Explicit NULL,
negative, zero and absent-membership cases also returned exactly the old values.

Validation:

- 71 PostgreSQL integration tests passed across activity feed, executor/Gantt,
  project settings and project-member order suites. These cover permission
  boundaries, archived membership positions and transaction rollback/read scope.
- Nine focused unit tests passed, including exact user ordering, no cross-task
  user disclosure, missing users/parents, ordinary personal lists and avoiding
  repeated custom-attribute scans.
- Full unit run: 294 passed, 241 skipped and the same three pre-existing failures
  in history/time-entry access-call argument expectations. A final added
  custom-attribute complexity regression passed in the focused run.
- Build, application TypeScript check, changed-file ESLint, formatting and diff
  checks passed. Full test-inclusive TypeScript still reports existing errors in
  untouched test files; changed files introduce no remaining diagnostics.

No client design, interaction, DTO, task/project ordering or API payload was
changed. Task and project writes, hooks, events, job creation, transaction
boundaries and authorization remain unchanged. No production data or migrations
were touched. New edits are local on `erp-989`.

Reproducible benchmark scripts, fixtures and logs are in workspace directory
`output/board-performance-2026-11-23`.
