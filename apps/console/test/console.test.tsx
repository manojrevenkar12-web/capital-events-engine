import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { setSession } from "../src/lib/api";
import type { CapitalEvent, Line, SideLetter } from "../src/lib/types";
import { renderAt } from "./render";

const HASH = "2f2b6d05572ee999663927dbd913ebad491818cb925951b377b6ed257f5670f1";
const FUND = {
  id: "F1",
  name: "Growth Fund III",
  kind: "master",
  default_notice_days: 10,
  fee_rate_bps: 200,
  carry_bps: 2000,
  hurdle_bps: 800,
  investment_period_end: "2031-01-15",
};

const event = (over: Partial<CapitalEvent> = {}): CapitalEvent => ({
  id: "E1",
  fund_id: "F1",
  kind: "call",
  reference: "CALL-2026-03",
  status: "calculated",
  issue_date: "2026-11-02",
  created_by: "alice@spreeblick.example",
  created_at: "2026-10-29T10:00:00Z",
  issued_at: null,
  result_hash: HASH,
  input: { components: [{ kind: "investment", deal: "Brandenburg Robotics", amount: "3100000000", sectors: [] }] },
  error: null,
  approvals: [],
  ...over,
});

const line = (name: string, total: string): Line => ({
  investor_id: name,
  investor_name: name,
  components: [total],
  total,
  paid: "0",
  due_date: "2026-11-16",
  status: "open",
  end_to_end_id: `DRAFT-${name}`,
  detail: {},
});

const api =
  (ev: CapitalEvent, lines: Line[] = [line("Nordlicht", "51593576"), line("Aarhus", "103187152")]) =>
  (path: string) => {
    if (path === "/v1/funds") return [FUND];
    if (path === "/v1/events/E1") return ev;
    if (path === "/v1/events/E1/lines") return lines;
    if (path.endsWith("/approve")) return { ...ev, status: "approved" };
    throw { status: 404, code: "NOT_FOUND", title: `no ${path}` };
  };

describe("event detail", () => {
  it("shows the lines with the call's own column and exact totals", async () => {
    renderAt("/events/E1", api(event()));
    expect(await screen.findByRole("heading", { name: /Capital call CALL-2026-03/ })).toBeTruthy();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Brandenburg Robotics")).toBeTruthy();
    expect(within(table).getByText("2 investors")).toBeTruthy();
    expect(within(table).getAllByText("€1,547,807.28").length).toBe(2); // the tfoot sums component and total
  });

  it("an approver signs the exact result hash shown on the page", async () => {
    const { calls } = renderAt("/events/E1", api(event()), ["approver", "viewer"], "bob@spreeblick.example");
    const approve = await screen.findByRole("button", { name: "Approve result 2f2b 6d05" });
    await userEvent.click(approve);
    await waitFor(() => expect(calls.some((c) => c.path === "/v1/events/E1/approve")).toBe(true));
    expect(calls.find((c) => c.path === "/v1/events/E1/approve")?.body).toEqual({ resultHash: HASH });
  });

  it("the person who prepared an event cannot approve it, even with the approver role", async () => {
    renderAt("/events/E1", api(event()), ["approver", "preparer"], "alice@spreeblick.example");
    const approve = await screen.findByRole("button", { name: /Approve result/ });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
  });

  it("a viewer gets no actions", async () => {
    renderAt("/events/E1", api(event()), ["viewer"], "vera@spreeblick.example");
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: /Approve|Calculate|Issue|Cancel/ })).toBeNull();
  });

  it("a void approval is shown as void and the result needs a new one", async () => {
    const ev = event({
      approvals: [{ user_id: "bob@spreeblick.example", result_hash: "9".repeat(64), decided_at: "2026-10-29T11:00:00Z", current: false }],
    });
    renderAt("/events/E1", api(ev));
    expect(await screen.findByText("Approval void")).toBeTruthy();
    expect(screen.getByText(/needs a new approval/)).toBeTruthy();
  });

  it("explains a stopped calculation and shows no lines for a draft", async () => {
    const ev = event({
      status: "draft",
      result_hash: null,
      error: { code: "INSUFFICIENT_UNFUNDED", message: "not enough unfunded commitment", ids: ["a", "b"] },
    });
    renderAt("/events/E1", api(ev));
    expect(await screen.findByText("The calculation stopped")).toBeTruthy();
    expect(screen.getByText(/2 investors affected/)).toBeTruthy();
    expect(screen.getByText("No lines until the event is calculated")).toBeTruthy();
  });

  it("offers a retry when the event cannot be loaded, and recovers", async () => {
    let fail = true;
    renderAt("/events/E1", (path) => {
      if (path === "/v1/events/E1" && fail) throw { status: 503, code: "UNAVAILABLE", title: "database unavailable" };
      return api(event())(path);
    });
    expect(await screen.findByText("This could not be loaded")).toBeTruthy();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: /CALL-2026-03/ })).toBeTruthy();
  });
});

describe("side letter reader", () => {
  it("marks each term's source sentence in the letter", async () => {
    const body = "Dear Fund,\n\n(a) You shall be excused from tobacco.\n\n(b) Fifteen Business Days' notice.\n";
    const q1 = "(a) You shall be excused from tobacco.";
    const q2 = "(b) Fifteen Business Days' notice.";
    const prov = (id: string, type: string, quote: string, params: Record<string, unknown>) => ({
      id,
      investor_id: "I",
      side_letter_id: "L1",
      source: "side_letter" as const,
      type,
      params,
      category: "ECONOMIC",
      quote,
      quote_start: body.indexOf(quote),
      quote_end: body.indexOf(quote) + quote.length,
      extractor: "rules-v1",
      status: "proposed" as const,
      decided_by: null,
    });
    const letter: SideLetter = {
      id: "L1",
      fund_id: "F1",
      title: "Nordlicht side letter",
      status: "in_review",
      investor_id: "I",
      investor_name: "Nordlicht",
      created_at: "2026-10-29T10:00:00Z",
      uploaded_by: "alice@spreeblick.example",
      body,
      provisions: [prov("P1", "EXCUSE_RIGHT", q1, { sectors: ["tobacco"] }), prov("P2", "NOTICE_PERIOD", q2, { days: 15 })],
    };
    const { container } = renderAt(
      "/side-letters/L1",
      (p) => (p === "/v1/side-letters/L1" ? letter : [FUND]),
      ["approver", "viewer"],
      "bob@spreeblick.example",
    );
    expect(await screen.findByText("Excused from tobacco")).toBeTruthy();
    const marks = [...container.querySelectorAll("mark")].map((m) => m.textContent);
    expect(marks).toEqual([q1, q2]);
    expect(screen.getAllByRole("button", { name: "Approve term" })).toHaveLength(2);
  });
});

describe("new capital call", () => {
  it("says what is missing and sends nothing until the form is complete", async () => {
    const { calls } = renderAt("/funds/F1/events/new", (p) => (p === "/v1/funds" ? [FUND] : []));
    await userEvent.click(await screen.findByRole("button", { name: "Create and calculate" }));
    expect(await screen.findByText(/The reference uses capitals/)).toBeTruthy();
    expect(screen.getByText(/Name the investment/)).toBeTruthy();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("creates the call with amounts in cents and opens it calculated", async () => {
    const { calls, router } = renderAt("/funds/F1/events/new", (p, init) => {
      if (p === "/v1/funds") return [FUND];
      if (init.method === "POST") return event({ id: "E9" });
      return event({ id: "E9" });
    });
    await userEvent.type(await screen.findByLabelText("Reference"), "call-2026-05");
    await userEvent.type(screen.getByLabelText("Deal"), "Kontor Logistics");
    await userEvent.type(screen.getByLabelText("Amount in euros"), "12,500,000.50");
    await userEvent.click(screen.getByRole("button", { name: "Create and calculate" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/events/E9"));
    const create = calls.find((c) => c.path === "/v1/funds/F1/calls");
    expect(create?.body).toMatchObject({
      reference: "CALL-2026-05",
      components: [{ kind: "investment", deal: "Kontor Logistics", amount: "1250000050", sectors: [] }],
    });
    expect(calls.some((c) => c.path === "/v1/events/E9/calculate")).toBe(true);
  });
});

describe("session", () => {
  it("sends a visitor without a session to sign-in", async () => {
    const r = renderAt("/funds/F1", (p) => (p === "/v1/dev/tenants" ? [{ id: "T", name: "Spreeblick Capital" }] : []));
    setSession(null);
    await r.router.navigate({ to: "/audit" });
    await waitFor(() => expect(r.router.state.location.pathname).toBe("/sign-in"));
    expect(await screen.findByRole("button", { name: "Sign in as Bob Okafor" })).toBeTruthy();
  });
});
