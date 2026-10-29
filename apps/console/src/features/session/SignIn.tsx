import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useState } from "react";
import { QueryView } from "../../components/QueryView";
import { Button, EmptyState, Skeleton } from "../../components/ui";
import { api, setSession } from "../../lib/api";
import { listReveal, reveal } from "../../theme/motion";
import "./session.css";

const PEOPLE = [
  {
    sub: "alice@spreeblick.example",
    name: "Alice Brandt",
    roles: ["preparer", "viewer"],
    does: "Prepares calls, closings and distributions; uploads side letters",
  },
  {
    sub: "bob@spreeblick.example",
    name: "Bob Okafor",
    roles: ["approver", "viewer"],
    does: "Approves calculated results and side-letter terms",
  },
  { sub: "vera@spreeblick.example", name: "Vera Lindqvist", roles: ["viewer"], does: "Reads everything, changes nothing" },
] as const;

export const SignIn = () => {
  const navigate = useNavigate();
  const tenants = useQuery({ queryKey: ["dev-tenants"], queryFn: () => api.get<Array<{ id: string; name: string }>>("/v1/dev/tenants") });
  const [tenant, setTenant] = useState<string>("");
  const signIn = useMutation({
    mutationFn: async (person: (typeof PEOPLE)[number]) => {
      const tid = tenant || tenants.data?.[0]?.id || "";
      const { token } = await api.post<{ token: string }>("/v1/dev/token", {
        sub: person.sub,
        name: person.name,
        tenantId: tid,
        roles: person.roles,
      });
      setSession({ token, sub: person.sub, name: person.name, roles: [...person.roles], tenantId: tid });
    },
    onSuccess: () => navigate({ to: "/" }),
  });

  return (
    <main className="signin">
      <motion.section className="signin__card" variants={listReveal} initial="hidden" animate="shown">
        <motion.h1 variants={reveal}>Capital events</motion.h1>
        <motion.p variants={reveal} className="signin__lede">
          Calls, closings and distributions for multi-vehicle funds. Every result is approved by a second person before it reaches an
          investor.
        </motion.p>
        <QueryView
          query={tenants}
          skeleton={<Skeleton h={36} />}
          isEmpty={(t) => t.length === 0}
          empty={
            <EmptyState title="No fund manager yet">
              Run <code>pnpm --filter @cee/api seed</code> to create the simulated manager, then reload.
            </EmptyState>
          }
        >
          {(list) => (
            <>
              {list.length > 1 ? (
                <label className="field">
                  Fund manager
                  <select value={tenant || list[0]?.id} onChange={(e) => setTenant(e.target.value)}>
                    {list.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <motion.ul className="signin__people" variants={listReveal}>
                {PEOPLE.map((p) => (
                  <motion.li key={p.sub} variants={reveal}>
                    <Button onClick={() => signIn.mutate(p)} disabled={signIn.isPending} aria-label={`Sign in as ${p.name}`}>
                      <span className="signin__name">{p.name}</span>
                      <span className="signin__does">{p.does}</span>
                    </Button>
                  </motion.li>
                ))}
              </motion.ul>
              {signIn.isError ? <p className="signin__error">Signing in failed: {(signIn.error as Error).message}</p> : null}
            </>
          )}
        </QueryView>
        <p className="signin__note">
          Local identity provider for the demo. In production the API verifies tokens from your identity provider.
        </p>
      </motion.section>
    </main>
  );
};
