# Storage rollback follow-up

PR #1 merged as `a497f40aad30b1a6f90e5f2d5e134628b6ba42a6`; its exact merge CI run `36603195082`
passed all seven jobs. Installing the generated DB/core tarballs into a separate consumer exposed a
rollback gap: a database newly created with the native schema writer had a version below 10. Opening
the first collection with the exact `7606b61` client upgraded its old schema and silently removed a
second collection. A database originally created by the old client was unaffected.

The native schema writer now upgrades to at least native version 10, matching legacy Dexie
version 1. The same Chromium rollback cases now retain both collections. The regression is included
in `pnpm test:browser` so normal CI checks both cross-context concurrency and rollback. No user
database was opened.

Registry publication remains blocked by missing NPM authentication and absent release secrets. Local
tarball installation is evidence only for the tested build.
