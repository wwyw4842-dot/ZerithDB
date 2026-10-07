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
collections add stores and bump the native database version, with a minimum native version of 10
(the legacy client's Dexie version 1). A smaller version would cause the legacy client to run an
upgrade that deletes undeclared collections. The Chromium rollback regression loads the exact
`7606b61` client and verifies both old-created and new-created databases retain their documents and
second collection after a code rollback and return to the repaired client.

Close active clients before rollback and retain a backup of the browser profile. This test covers
that exact old client, not every historical app or production profile; production backup/restore and
registry publication remain separate acceptance items.

## React provider and query ownership

`zerithdb-react` uses the public SDK `app.db(name)` entry point, so subscription and insert/remove
share the same collection bridge. Remove passes an `_id` filter, preserving other documents. Query
snapshots belong to both app instance and collection name; owner changes show a loading state
immediately and cleanup rejects late read/error callbacks. Failed reads are exposed through the
hook's existing `error` field and successful committed refresh clears it.

Provider replacement/unmount drains SDK disposal. A mount count plus a one-time disposal flag delays
cleanup by one microtask, preserving the same client through React StrictMode's immediate effect
rehearsal while releasing replaced and unmounted clients. Real IndexedDB/Chromium regression also
reopens the previous app namespace and verifies its stored data. No storage schema or sync framing
changes.

The acceptance browser bundler uses simple-peer's published browser bundle to include its Node
shims. This does not prove every consumer bundler works without browser polyfills. Registry
publication, real cross-device transport and installed application observation remain separate.
