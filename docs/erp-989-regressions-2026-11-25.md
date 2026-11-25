# Task activity historical-ID repair

User reported that ERP-989's concurrent task lookup index fails on non-integer
or int32-overflow IDs, leaving an invalid index. Inspected all feed/count/read
queries, event writers, migration runner, concurrent-index repair pattern and
existing PostgreSQL/HTTP regressions before edits. Current writers use integer
task IDs, but historic rows must not prevent startup. No real dev/production
rows were inspected or repaired.

Use one immutable, strict safe conversion function for both the index and the
existing task join. It executes PostgreSQL's own integer cast (preserving
leading zeroes, signs and whitespace) and returns NULL only for invalid text or
integer overflow, neither of which can identify an integer-keyed task. The
inner join therefore omits those orphan history records. All valid rows,
permissions, ordering, archive behavior, cursors, count/read boundaries, recipient
updates and websocket semantics remain unchanged. Other failures propagate.

The integer-specific PL/pgSQL wrapper uses pg_input_is_valid (PostgreSQL 16+, covered
by Board's PostgreSQL 17 deployment image) before casting. Its fixed integer
conversion is immutable and parallel-safe; it avoids per-row exception blocks
and their subtransactions in parallel queries/index builds.

The original migration creates the safe index on first deployment and recovers
an invalid or old unsafe definition with concurrent drop/build. A replay migration
also repairs databases where the original migration is already recorded.
The replay's down does not restore the unsafe definition; the original down
removes the performance index but retains the conversion used by live reads.
No history/recipient data is deleted or backfilled. Changing this query is
necessary so the repaired expression index still serves task lookups, and so
the same malformed historical IDs cannot break ordinary reads after deployment.

Verification on an isolated local PostgreSQL database: original migration
reproduced 22P02 and an invalid index. Repair/replay and repeated up/down succeed
on invalid and overflowing IDs, preserve existing rows, match 18 native integer
conversion cases, replace both invalid and valid unsafe indexes, and use the
repaired index for task lookup. All 25 authenticated activity PostgreSQL/HTTP
tests passed, including unread boundaries, access, pagination, rollback and
unchanged orphan recipient pointers. Nest/SWC build, application and strict
types, targeted ESLint and formatting passed. No dev/production data changed.
