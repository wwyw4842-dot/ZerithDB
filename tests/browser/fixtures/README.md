# Legacy rollback fixture

`db-client-7606b61.ts.txt` is the exact `packages/db/src/db-client.ts` from commit
`7606b61ac94e1bb0e237662f4d8ea02e6eef528b` before the storage repair. The browser regression bundles
it unchanged and loads old/new clients in separate documents, sharing only the browser origin and
IndexedDB data. Keep the fixture unchanged.

The test creates each database with both generations, adds a second collection with the repaired
client, reopens only the first with the legacy client, then checks both collections after returning
to the repaired client.
