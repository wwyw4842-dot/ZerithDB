import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZerithProvider, useQuery } from "./index.js";

const { makeApp } = vi.hoisted(() => ({ makeApp: vi.fn() }));
vi.mock("zerithdb-sdk", () => ({ createApp: makeApp }));

function fixture() {
  const callbacks: { next: (docs: any[]) => void; error: (cause: unknown) => void }[] = [];
  const unsubscribe = vi.fn();
  const collection = {
    subscribe: vi.fn((next, error) => {
      callbacks.push({ next, error });
      return unsubscribe;
    }),
    insert: vi.fn(async () => ({ id: "new-id" })),
    delete: vi.fn(async () => 1),
  };
  const app = { db: vi.fn(() => collection), dispose: vi.fn(async () => {}) };
  return { app, collection, callbacks, unsubscribe };
}

let root: Root;
let container: HTMLElement;
let query: ReturnType<typeof useQuery>;
let first: ReturnType<typeof fixture>;
let second: ReturnType<typeof fixture>;
function Probe({ name }: { name: string }) {
  query = useQuery(name);
  return React.createElement("pre", null, JSON.stringify(query.data));
}
async function render(appId = "first", name = "todos", strict = false) {
  await act(async () => {
    const tree = React.createElement(ZerithProvider, {
      config: { appId },
      children: React.createElement(Probe, { name }),
    });
    root.render(strict ? React.createElement(React.StrictMode, null, tree) : tree);
  });
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  first = fixture();
  second = fixture();
  makeApp
    .mockReset()
    .mockImplementation(({ appId }) => (appId === "first" ? first.app : second.app));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("React public SDK ownership and lifetime", () => {
  it("uses app.db and deletes only the requested identity", async () => {
    await render();
    await query.insert({ text: "new" });
    await query.remove("chosen-id");
    expect(first.app.db).toHaveBeenCalledWith("todos");
    expect(first.collection.insert).toHaveBeenCalledWith({ text: "new" });
    expect(first.collection.delete).toHaveBeenCalledWith({ _id: "chosen-id" });
  });
  it("rejects late reads and errors after collection ownership changes", async () => {
    await render();
    const stale = first.callbacks[0]!;
    await act(async () => stale.next([{ text: "old" }]));
    await render("first", "other");
    expect(query.data).toEqual([]);
    expect(query.loading).toBe(true);
    await act(async () => {
      stale.next([{ text: "late" }]);
      stale.error(Error("late error"));
    });
    expect(query.data).toEqual([]);
    expect(query.error).toBeNull();
    await act(async () => first.callbacks[1]!.next([{ text: "current" }]));
    expect(query.data).toEqual([{ text: "current" }]);
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
  });
  it("reports failed reads and clears the error when a committed refresh succeeds", async () => {
    await render();
    await act(async () => first.callbacks[0]!.error(Error("quota read")));
    expect(query.loading).toBe(false);
    expect(query.error?.message).toBe("quota read");
    await act(async () => first.callbacks[0]!.next([{ text: "recovered" }]));
    expect(query.error).toBeNull();
    expect(query.data).toEqual([{ text: "recovered" }]);
  });
  it("resets same-named collection state and releases replaced app", async () => {
    await render();
    const stale = first.callbacks[0]!;
    await act(async () => stale.next([{ text: "previous app" }]));
    await render("second");
    expect(first.app.dispose).toHaveBeenCalledTimes(1);
    expect(query.data).toEqual([]);
    expect(query.loading).toBe(true);
    await act(async () => stale.next([{ text: "late previous app" }]));
    expect(query.data).toEqual([]);
    await act(async () => second.callbacks[0]!.next([{ text: "new app" }]));
    expect(query.data).toEqual([{ text: "new app" }]);
  });
  it("keeps client alive through StrictMode rehearsal and disposes once at unmount", async () => {
    await render("first", "todos", true);
    expect(first.app.dispose).not.toHaveBeenCalled();
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    expect(first.app.dispose).toHaveBeenCalledTimes(1);
    expect(first.unsubscribe).toHaveBeenCalledTimes(2);
  });
});
