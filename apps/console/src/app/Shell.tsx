import { Link, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { currentSession, setSession } from "../lib/api";
import { useFunds } from "../lib/queries";
import "./shell.css";

const NAV = [
  { to: "/funds/$fundId", label: "Overview", exact: true },
  { to: "/funds/$fundId/events", label: "Capital events" },
  { to: "/funds/$fundId/side-letters", label: "Side letters" },
  { to: "/funds/$fundId/accounts", label: "Capital accounts" },
  { to: "/funds/$fundId/bank", label: "Bank" },
] as const;

export const Shell = () => {
  const session = currentSession();
  const params = useParams({ strict: false }) as { fundId?: string };
  const funds = useFunds();
  const navigate = useNavigate();
  const fundId = params.fundId ?? funds.data?.[0]?.id;

  return (
    <div className="shell">
      <aside className="rail" aria-label="Main">
        <Link to="/" className="rail__brand">
          <img src="/favicon.svg" alt="" width={22} height={22} />
          Capital events
        </Link>
        <label className="rail__fund">
          <span>Fund</span>
          <select
            value={fundId ?? ""}
            onChange={(e) => navigate({ to: "/funds/$fundId", params: { fundId: e.target.value } })}
            disabled={!funds.data?.length}
          >
            {funds.isPending ? <option>Loading…</option> : null}
            {funds.data?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        {fundId ? (
          <nav className="rail__nav">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                params={{ fundId }}
                activeOptions={{ exact: "exact" in n ? n.exact : false }}
                activeProps={{ "aria-current": "page" }}
              >
                {n.label}
              </Link>
            ))}
            <Link to="/audit" activeProps={{ "aria-current": "page" }}>
              Audit trail
            </Link>
          </nav>
        ) : null}
        <div className="rail__me">
          <strong>{session?.name}</strong>
          <span>{session?.roles.filter((r) => r !== "viewer").join(", ") || "viewer"}</span>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => {
              setSession(null);
              navigate({ to: "/sign-in" });
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
};
