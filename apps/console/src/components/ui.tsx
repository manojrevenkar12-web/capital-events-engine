import { motion } from "motion/react";
import type { ReactNode } from "react";
import { fingerprintCells, shortHash } from "../lib/fingerprint";
import { formatCents } from "../lib/money";
import { DURATION, EASE_OUT } from "../theme/motion";
import "./components.css";

export const Skeleton = ({ w = "100%", h = 14 }: { w?: number | string; h?: number }) => (
  <span className="skeleton" style={{ width: w, height: h }} aria-hidden="true" />
);

export const SkeletonRows = ({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) => (
  <div role="status" aria-label="Loading" style={{ display: "grid", gap: "var(--s-3)", padding: "var(--s-4)" }}>
    {Array.from({ length: rows }, (_, r) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
      <div key={`r${r}`} style={{ display: "grid", gridTemplateColumns: `2fr repeat(${cols - 1}, 1fr)`, gap: "var(--s-4)" }}>
        {Array.from({ length: cols }, (_, c) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholder cells have no identity
          <Skeleton key={`c${c}`} w={c === 0 ? "70%" : "60%"} />
        ))}
      </div>
    ))}
  </div>
);

export const ErrorState = ({ error, onRetry }: { error: unknown; onRetry?: () => void }) => {
  const e = error as { code?: string; message?: string; status?: number };
  const offline = e?.message === "Failed to fetch";
  return (
    <div className="state state--error" role="alert">
      <h3>{offline ? "The API cannot be reached" : "This could not be loaded"}</h3>
      <p>
        {offline ? "Check that the API is running, then try again." : e?.message}
        {e?.code && !offline ? (
          <>
            {" "}
            (<code>{e.code}</code>)
          </>
        ) : null}
      </p>
      {onRetry ? (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
};

export const EmptyState = ({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) => (
  <div className="state">
    <h3>{title}</h3>
    {children ? <p>{children}</p> : null}
    {action}
  </div>
);

export const Money = ({
  cents,
  flow,
  compact,
  sign,
}: {
  cents: string | bigint;
  flow?: "in" | "out";
  compact?: boolean;
  sign?: boolean;
}) => <span className={`money${flow ? ` money--${flow}` : ""}`}>{formatCents(cents, { compact, sign })}</span>;

const TONE: Record<string, string> = {
  draft: "",
  calculated: "pending",
  approved: "stamp",
  issued: "pending",
  settled: "credit",
  cancelled: "",
  open: "pending",
  partial: "pending",
  paid: "credit",
  overpaid: "debit",
  nothing_due: "",
  matched: "credit",
  unmatched: "debit",
  duplicate: "",
  resolved: "credit",
  proposed: "pending",
  rejected: "debit",
  in_review: "pending",
  reviewed: "credit",
  extracting: "",
};

const LABEL: Record<string, string> = { nothing_due: "nothing due", in_review: "in review" };

export const StatusPill = ({ status }: { status: string }) => (
  <span className={`pill${TONE[status] ? ` pill--${TONE[status]}` : ""}`}>{LABEL[status] ?? status}</span>
);

export const Fingerprint = ({ hash, label }: { hash: string; label?: string }) => (
  <motion.div
    key={hash}
    className="fingerprint"
    role="img"
    aria-label={label ?? `Result fingerprint ${shortHash(hash)}`}
    initial={{ opacity: 0, scale: 0.9 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ duration: DURATION.base, ease: EASE_OUT }}
  >
    {fingerprintCells(hash).map((on, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
      <span key={i} data-on={on} />
    ))}
  </motion.div>
);

export const Stamp = ({ who, when, hash, current }: { who: string; when: string; hash: string; current: boolean }) => (
  <motion.div
    className={`stamp${current ? "" : " stamp--void"}`}
    initial={{ opacity: 0, scale: 1.15, rotate: -6 }}
    animate={{ opacity: 1, scale: 1, rotate: current ? -1.5 : 0 }}
    transition={{ type: "spring", stiffness: 420, damping: 22 }}
  >
    <Fingerprint hash={hash} label={`Approved result ${shortHash(hash)}`} />
    <div>
      <strong>{current ? "Approved" : "Approval void"}</strong>
      <small>
        {who}, {new Date(when).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
      </small>
    </div>
  </motion.div>
);

export const Button = ({
  children,
  tone,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "stamp" | "quiet" }) => (
  <button type="button" className={`btn${tone ? ` btn--${tone}` : ""}`} {...rest}>
    {children}
  </button>
);
