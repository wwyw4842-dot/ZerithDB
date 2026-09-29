import type { Table } from "dexie";

/**
 * Dexie bulkAdd and bulkPut swallow a failed request with preventDefault, so
 * earlier rows in that call still commit. These helpers keep one native
 * readwrite transaction and abort it when any request fails.
 */
async function nativeReadWrite(
  table: Table,
  run: (store: IDBObjectStore, fail: (err: unknown) => void) => void
): Promise<void> {
  await table.db.open();
  const database = table.db.backendDB();
  if (!database) {
    throw new Error("IndexedDB is not open");
  }

  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(table.name, "readwrite");
    let settled = false;
    let failure: unknown = null;

    const finishReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err ?? new DOMException("IndexedDB transaction aborted", "AbortError"));
    };

    const fail = (err: unknown) => {
      failure = failure ?? err;
      if (settled) return;
      try {
        tx.abort();
      } catch {
        finishReject(failure);
      }
    };

    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    tx.onabort = () => {
      finishReject(failure ?? tx.error);
    };
    tx.onerror = (event) => {
      failure = failure ?? tx.error ?? new Error("IndexedDB request failed");
      event.preventDefault();
      event.stopPropagation();
      fail(failure);
    };

    try {
      run(tx.objectStore(table.name), fail);
    } catch (err) {
      fail(err);
    }
  });
}

export async function atomicAddAll<T>(table: Table<T>, docs: readonly T[]): Promise<void> {
  await nativeReadWrite(table, (store) => {
    for (const doc of docs) {
      store.add(doc);
    }
  });
}

export async function atomicModify<T>(
  table: Table<T>,
  match: (doc: T) => boolean,
  apply: (doc: T) => T
): Promise<number> {
  let updated = 0;
  await nativeReadWrite(table, (store, fail) => {
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      try {
        if (match(cursor.value as T)) {
          cursor.update(apply(cursor.value as T));
          updated++;
        }
        cursor.continue();
      } catch (err) {
        fail(err);
      }
    };
  });
  return updated;
}

export async function atomicDelete<T>(
  table: Table<T>,
  match: (doc: T) => boolean
): Promise<number> {
  let deleted = 0;
  await nativeReadWrite(table, (store, fail) => {
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      try {
        if (match(cursor.value as T)) {
          cursor.delete();
          deleted++;
        }
        cursor.continue();
      } catch (err) {
        fail(err);
      }
    };
  });
  return deleted;
}
