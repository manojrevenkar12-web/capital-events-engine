import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, createRoute, createRouter, Link, Navigate, Outlet, redirect } from "@tanstack/react-router";
import { QueryView } from "../components/QueryView";
import { EmptyState, Skeleton } from "../components/ui";
import { CapitalAccounts } from "../features/accounts/CapitalAccounts";
import { AuditTrail } from "../features/audit/AuditTrail";
import { Bank } from "../features/bank/Bank";
import { EventDetail } from "../features/events/EventDetail";
import { EventsList } from "../features/events/EventsList";
import { NewCall } from "../features/events/NewCall";
import { LetterReader } from "../features/letters/LetterReader";
import { SideLetters } from "../features/letters/SideLetters";
import { Overview } from "../features/overview/Overview";
import { SignIn } from "../features/session/SignIn";
import { currentSession } from "../lib/api";
import { useFunds } from "../lib/queries";
import { Shell } from "./Shell";

const NotFound = () => (
  <EmptyState title="There is nothing at this address" action={<Link to="/">Go to the overview</Link>}>
    The link may be from another fund manager, or the record was cancelled.
  </EmptyState>
);

/** "/" opens the first fund the signed-in person can see. */
const Home = () => {
  const funds = useFunds();
  return (
    <QueryView
      query={funds}
      skeleton={<Skeleton w={320} h={28} />}
      isEmpty={(f) => f.length === 0}
      empty={<EmptyState title="No funds yet">Create a fund through the API, or run the seed to load the simulated manager.</EmptyState>}
    >
      {(f) => <Navigate to="/funds/$fundId" params={{ fundId: f[0]?.id ?? "" }} replace />}
    </QueryView>
  );
};

const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet, notFoundComponent: NotFound });

const signIn = createRoute({ getParentRoute: () => root, path: "/sign-in", component: SignIn });
const app = createRoute({
  getParentRoute: () => root,
  id: "app",
  beforeLoad: () => {
    if (!currentSession()) throw redirect({ to: "/sign-in" });
  },
  component: Shell,
});
const home = createRoute({ getParentRoute: () => app, path: "/", component: Home });
const fund = createRoute({ getParentRoute: () => app, path: "funds/$fundId", component: Outlet });
const overview = createRoute({ getParentRoute: () => fund, path: "/", component: Overview });
const events = createRoute({ getParentRoute: () => fund, path: "events", component: EventsList });
const newCall = createRoute({ getParentRoute: () => fund, path: "events/new", component: NewCall });
const letters = createRoute({ getParentRoute: () => fund, path: "side-letters", component: SideLetters });
const accounts = createRoute({ getParentRoute: () => fund, path: "accounts", component: CapitalAccounts });
const bank = createRoute({ getParentRoute: () => fund, path: "bank", component: Bank });
const event = createRoute({ getParentRoute: () => app, path: "events/$eventId", component: EventDetail });
const letter = createRoute({ getParentRoute: () => app, path: "side-letters/$letterId", component: LetterReader });
const audit = createRoute({ getParentRoute: () => app, path: "audit", component: AuditTrail });

export const routeTree = root.addChildren([
  signIn,
  app.addChildren([home, fund.addChildren([overview, events, newCall, letters, accounts, bank]), event, letter, audit]),
]);

export const makeRouter = (queryClient: QueryClient) =>
  createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent", scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
