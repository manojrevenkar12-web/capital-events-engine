import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { routeTree } from "../src/app/router";
import { setSession } from "../src/lib/api";

export type Handler = (path: string, init: RequestInit) => unknown;

/** Renders the real route tree at a URL, with fetch answered by a handler that sees every request. */
export const renderAt = (url: string, handler: Handler, roles: string[] = ["preparer", "viewer"], sub = "alice@spreeblick.example") => {
  setSession({ token: "t", sub, name: sub, roles, tenantId: "T" });
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit = {}) => {
      calls.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      try {
        const body = await handler(path, init);
        return new Response(JSON.stringify(body), { status: 200 });
      } catch (e) {
        const p = e as { status?: number; code?: string; title?: string };
        return new Response(JSON.stringify({ status: p.status ?? 500, code: p.code ?? "X", title: p.title ?? "failed" }), {
          status: p.status ?? 500,
        });
      }
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({ routeTree, context: { queryClient }, history: createMemoryHistory({ initialEntries: [url] }) });
  const r = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...r, calls, router };
};
