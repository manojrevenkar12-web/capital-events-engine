import "@fontsource-variable/schibsted-grotesk";
import "./theme/tokens.css";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { makeRouter } from "./app/router";
import { ApiError } from "./lib/api";

const STALE_MS = 15_000;

// A 401 anywhere means the session ended: back to sign-in, keeping nothing.
const onError = (e: unknown) => {
  if (e instanceof ApiError && e.status === 401) void router.navigate({ to: "/sign-in" });
};
const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: { staleTime: STALE_MS, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 },
  },
});
const router = makeRouter(queryClient);

const el = document.getElementById("root");
if (!el) throw new Error("index.html has no #root");
createRoot(el).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MotionConfig>
  </StrictMode>,
);
