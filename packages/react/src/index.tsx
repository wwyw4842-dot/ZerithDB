import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { createApp } from "zerithdb-sdk";
import type { ZerithDBApp, ZerithDBConfig, QueryFilter } from "zerithdb-sdk";

const ZerithContext = createContext<ZerithDBApp | null>(null);

export interface ZerithProviderProps {
  config: ZerithDBConfig;
  children: React.ReactNode;
}

/**
 * Global provider for ZerithDB.
 * Initializes the P2P client and makes it available via hooks.
 */
export const ZerithProvider: React.FC<ZerithProviderProps> = ({ config, children }) => {
  const client = useMemo(() => createApp(config), [JSON.stringify(config)]);
  const lifetime = useMemo(() => ({ client, mounts: 0, disposed: false }), [client]);
  useEffect(() => {
    lifetime.mounts++;
    return () => {
      lifetime.mounts--;
      // StrictMode immediately rehearses cleanup/setup using the same client.
      // Wait one microtask so that rehearsal cannot close a live provider.
      queueMicrotask(() => {
        if (!lifetime.mounts && !lifetime.disposed) {
          lifetime.disposed = true;
          void lifetime.client.dispose().catch(console.error);
        }
      });
    };
  }, [lifetime]);

  return <ZerithContext.Provider value={client}>{children}</ZerithContext.Provider>;
};

/**
 * Access the underlying ZerithDB client directly.
 */
export const useZerith = () => {
  const context = useContext(ZerithContext);
  if (!context) {
    throw new Error("useZerith must be used within a ZerithProvider");
  }
  return context;
};

/**
 * Reactive hook to query a collection.
 * Automatically updates when local or remote (P2P) changes occur.
 */
export function useQuery<T extends Record<string, any> = any>(collectionName: string) {
  const app = useZerith();
  const [state, setState] = useState<{
    app: ZerithDBApp;
    collectionName: string;
    data: T[];
    loading: boolean;
    error: Error | null;
  }>({ app, collectionName, data: [], loading: true, error: null });

  useEffect(() => {
    let mounted = true;

    const onError = (cause: unknown) => {
      if (mounted)
        setState({
          app,
          collectionName,
          data: [],
          loading: false,
          error: cause instanceof Error ? cause : new Error(String(cause)),
        });
    };
    let unsubscribe = () => {};
    try {
      const collection = app.db<T>(collectionName);
      unsubscribe = collection.subscribe((docs) => {
        if (mounted) setState({ app, collectionName, data: docs, loading: false, error: null });
      }, onError);
    } catch (cause) {
      onError(cause);
    }

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [app, collectionName]);

  const insert = async (item: Partial<T>) => {
    return app.db<T>(collectionName).insert(item as T);
  };

  const remove = async (id: string) => {
    // _id is stored metadata and need not be declared in the user's T.
    return app.db<T>(collectionName).delete({ _id: id } as unknown as QueryFilter<T>);
  };

  // A new owner must not render the previous collection while its first read
  // is pending. Late results are also rejected by the effect's mounted guard.
  const current = state.app === app && state.collectionName === collectionName;
  return {
    data: current ? state.data : [],
    loading: current ? state.loading : true,
    error: current ? state.error : null,
    insert,
    remove,
  };
}
