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

/**
 * Replace the complete contents of a collection in one native transaction.
 *
 * Sync hydration needs this operation because a remote snapshot can contain
 * both inserts/updates and deletes.  Doing those as separate Dexie calls can
 * expose a partially applied snapshot to readers (and a failed second call
 * would leave the local replica divergent), so all cursor mutations happen in
 * the same readwrite transaction and any request error aborts it.
 */
export async function atomicReplace<T extends { _id: string }>(
  table: Table<T>,
  documents: readonly T[]
): Promise<void> {
  const replacement = new Map(documents.map((document) => [document._id, document]));
  if (replacement.size !== documents.length) {
    throw new Error("Cannot replace a collection with duplicate document ids");
  }

  await nativeReadWrite(table, (store, fail) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        for (const document of replacement.values()) {
          try {
            store.put(document);
          } catch (error) {
            fail(error);
            return;
          }
        }
        return;
      }

      try {
        const id = String(cursor.primaryKey);
        const document = replacement.get(id);
        if (document) {
          cursor.update(document);
          replacement.delete(id);
        } else {
          cursor.delete();
        }
        cursor.continue();
      } catch (error) {
        fail(error);
      }
    };
    request.onerror = () => fail(request.error ?? new Error("Failed to read collection"));
  });
}
