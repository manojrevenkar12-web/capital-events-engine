/** The API client: bearer token, RFC 9457 problems as typed errors, money as strings. */
const TOKEN_KEY = "cee.session";

export interface Session {
  token: string;
  sub: string;
  name: string;
  roles: string[];
  tenantId: string;
}

export const loadSession = (): Session | null => {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
};
export const saveSession = (s: Session | null) => {
  try {
    if (s) localStorage.setItem(TOKEN_KEY, JSON.stringify(s));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the session lives in memory only */
  }
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let session: Session | null = loadSession();
export const setSession = (s: Session | null) => {
  session = s;
  saveSession(s);
};
export const currentSession = () => session;
export const can = (...roles: string[]) => !!session && roles.some((r) => session?.roles.includes(r));

/** Raw bodies (camt.054 XML) go through the same error handling as JSON. */
export const postRaw = <T>(p: string, body: string, contentType: string) =>
  request<T>(p, { method: "POST", body, headers: { "content-type": contentType } });

/** A readable message for a failed request, including the problem's detail when there is one. */
export const problemText = (e: unknown) => {
  if (e instanceof ApiError) {
    const ids = Array.isArray(e.detail.ids) && e.detail.ids.length ? ` (${(e.detail.ids as string[]).length} investors affected)` : "";
    return `${e.message}${ids}`;
  }
  return e instanceof Error ? e.message : String(e);
};

export const request = async <T>(path: string, init: RequestInit & { json?: unknown; idempotencyKey?: string } = {}): Promise<T> => {
  const headers = new Headers(init.headers);
  if (session) headers.set("authorization", `Bearer ${session.token}`);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  if (init.idempotencyKey) headers.set("idempotency-key", init.idempotencyKey);
  const res = await fetch(path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    if (res.status === 401) setSession(null);
    throw new ApiError(res.status, String(body.code ?? "HTTP_ERROR"), String(body.title ?? res.statusText), body);
  }
  return body as T;
};

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, json: unknown = {}, idempotencyKey?: string) =>
    request<T>(p, { method: "POST", json, ...(idempotencyKey ? { idempotencyKey } : {}) }),
};
