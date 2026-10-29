import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type {
  AuditRecord,
  BankEntry,
  CapitalAccounts,
  CapitalEvent,
  FeederPlanRow,
  Fund,
  Investor,
  Line,
  Provision,
  SideLetter,
  SideLetterSummary,
} from "./types";

export const keys = {
  funds: ["funds"] as const,
  events: (fundId: string) => ["events", fundId] as const,
  event: (id: string) => ["event", id] as const,
  lines: (id: string) => ["lines", id] as const,
  accounts: (fundId: string) => ["accounts", fundId] as const,
  letters: (fundId: string) => ["letters", fundId] as const,
  letter: (id: string) => ["letter", id] as const,
  provisions: (fundId: string, status?: string) => ["provisions", fundId, status ?? "all"] as const,
  bank: (fundId: string, status?: string) => ["bank", fundId, status ?? "all"] as const,
  audit: ["audit"] as const,
  auditVerify: ["audit-verify"] as const,
  ledger: (fundId: string) => ["ledger", fundId] as const,
  feederPlan: (id: string) => ["feeder-plan", id] as const,
};

export const useFunds = () => useQuery({ queryKey: keys.funds, queryFn: () => api.get<Fund[]>("/v1/funds") });
export const useEvents = (fundId: string) =>
  useQuery({ queryKey: keys.events(fundId), queryFn: () => api.get<CapitalEvent[]>(`/v1/funds/${fundId}/events`) });
export const useEvent = (id: string) => useQuery({ queryKey: keys.event(id), queryFn: () => api.get<CapitalEvent>(`/v1/events/${id}`) });
export const useLines = (id: string, enabled = true) =>
  useQuery({ queryKey: keys.lines(id), queryFn: () => api.get<Line[]>(`/v1/events/${id}/lines`), enabled });
export const useAccounts = (fundId: string) =>
  useQuery({ queryKey: keys.accounts(fundId), queryFn: () => api.get<CapitalAccounts>(`/v1/funds/${fundId}/capital-accounts`) });
export const useLetters = (fundId: string) =>
  useQuery({ queryKey: keys.letters(fundId), queryFn: () => api.get<SideLetterSummary[]>(`/v1/funds/${fundId}/side-letters`) });
export const useLetter = (id: string) =>
  useQuery({
    queryKey: keys.letter(id),
    queryFn: () => api.get<SideLetter>(`/v1/side-letters/${id}`),
    refetchInterval: (q) => (q.state.data?.status === "extracting" ? 1000 : false),
  });
export const useProvisions = (fundId: string, status?: string) =>
  useQuery({
    queryKey: keys.provisions(fundId, status),
    queryFn: () => api.get<Provision[]>(`/v1/funds/${fundId}/provisions${status ? `?status=${status}` : ""}`),
  });
export const useBank = (fundId: string, status?: string) =>
  useQuery({
    queryKey: keys.bank(fundId, status),
    queryFn: () => api.get<BankEntry[]>(`/v1/funds/${fundId}/bank/entries${status ? `?status=${status}` : ""}`),
  });
export const useAudit = () => useQuery({ queryKey: keys.audit, queryFn: () => api.get<AuditRecord[]>("/v1/audit") });
export const useAuditVerify = () =>
  useQuery({ queryKey: keys.auditVerify, queryFn: () => api.get<{ ok: boolean; records: number; brokenAt?: number }>("/v1/audit/verify") });
export const useLedgerVerify = (fundId: string) =>
  useQuery({
    queryKey: keys.ledger(fundId),
    queryFn: () => api.get<{ ok: boolean; accounts: number; trialBalance: string }>(`/v1/funds/${fundId}/ledger/verify`),
  });
export const useFeederPlan = (id: string, enabled: boolean) =>
  useQuery({ queryKey: keys.feederPlan(id), enabled, queryFn: () => api.get<FeederPlanRow[]>(`/v1/events/${id}/feeder-plan`) });
export const useInvestors = () => useQuery({ queryKey: ["investors"], queryFn: () => api.get<Investor[]>("/v1/investors") });
