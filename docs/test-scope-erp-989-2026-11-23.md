# ERP-989 test scope cleanup

User explicitly requested removing excessive specs and retaining tests of
important business behavior. Reviewed every spec added in current erp-989 and
existing pagination, date-endpoint, hierarchy, access and executor tests before
edits. No application code or business behavior changes in this batch.

Removed task-filter-candidates.spec.ts: public tasks-pagination.service.spec.ts
already covers creators, association intersection, nested roots, flat mode and
pagination. The extra includes-spy test only constrained Set implementation.
Removed task-date-filter-preparation.spec.ts: endpoint integration tests cover
inclusive epoch and invalid/inverted ranges; the private-helper cases and fixed
Date.parse count need not remain permanent specs.
Removed two task-display-context cases checking absence of reads/repeated
attribute access. Retained per-task participant isolation/order, missing user
handling, shared/missing parents, and all existing access/hierarchy/transaction
tests. This removes 18 cases across two files and two individual tests.

Validated: 33 retained pagination/filter DTO/context/hierarchy tests passed;
application TypeScript, strict type contracts, Nest/SWC build, changed-test
ESLint, formatting and diff checks passed. Client design and behavior are
unchanged. Related ERP typing audit is documented in the server repository's
docs/typing-and-test-scope-2026-11-23.md.
