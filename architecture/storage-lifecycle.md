# IndexedDB write and schema lifecycle

Collection handles resolve the current persisted schema per operation. Schema upgrades use native
IndexedDB to add the requested object store and timestamp indexes without redeclaring other stores;
this preserves collections created by another browser context. Web Locks serialize schema/CRUD when
present; correctness without Web Locks relies on native version transactions and retries. An older
connection may block an upgrade for up to five seconds; the operation then returns an error without
forcing another client's connection closed. A late open is aborted or closed.

Multirow add/update/delete execute in one native readwrite transaction. Request, serialization, or
cursor callback failure aborts earlier writes. Document identity and creation timestamps cannot be
changed by ordinary update specs. Nested filters recurse and unknown/mixed operators fail
explicitly.

Subscriptions publish committed state and invalidate superseded asynchronous reads. BroadcastChannel
failures cannot change a committed write's result. Client disposal unregisters its subscriptions and
closes their channels.

Compatibility and rollback: existing database stores and index definitions are preserved. New
collections add stores and bump the native database version. Do not remove those stores during code
rollback. Close active clients before rollback; keep a backup of the browser profile. The new schema
can be reopened by the repaired client in any collection order. Compatibility with every older
application build and production backup/restore is still an acceptance item; no production rollout
is claimed here.
