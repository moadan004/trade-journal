import type { AccountCreateInput, AccountRead } from "@/types/account";
import type { ImportResult } from "@/types/importResult";
import type { CalendarStatsResponse } from "@/types/stats";
import type { RiskStatsResponse, SessionStatsResponse, SummaryStatsResponse } from "@/types/summary";
import type { TradeCreateInput, TradeRead, TradeUpdateInput } from "@/types/trade";
import type { UserRead } from "@/types/user";

// Same-origin: a Next.js rewrite (see next.config.ts) proxies /api/* to the
// backend. Requests therefore stay same-site, which is what allows the auth
// cookie to be SameSite=lax. Auth travels as an httpOnly cookie, so nothing
// here reads or attaches a token.
const API_BASE = "/api";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface TokenResponse {
  access_token: string;
  token_type: string;
}

async function extractError(res: Response): Promise<ApiError> {
  let message = res.statusText;
  try {
    const body = await res.json();
    if (typeof body.detail === "string") message = body.detail;
  } catch {
    // response had no JSON body; fall back to statusText
  }
  return new ApiError(res.status, message);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");

  // credentials: "include" is required for the auth cookie to be sent.
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!res.ok) throw await extractError(res);

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function register(email: string, password: string): Promise<TokenResponse> {
  return request<TokenResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function login(email: string, password: string): Promise<TokenResponse> {
  return request<TokenResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function googleAuth(idToken: string): Promise<TokenResponse> {
  return request<TokenResponse>("/auth/google", {
    method: "POST",
    body: JSON.stringify({ id_token: idToken }),
  });
}

export function logout(): Promise<void> {
  return request<void>("/auth/logout", { method: "POST" });
}

/** Resolves the signed-in user, or throws ApiError(401) when there's no session. */
export function getCurrentUser(): Promise<UserRead> {
  return request<UserRead>("/auth/me");
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") usp.set(key, String(value));
  });
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

interface CalendarStatsFilters {
  accountId?: number;
  tags?: string[];
}

export function getCalendarStats(
  month: string,
  filters: CalendarStatsFilters = {},
): Promise<CalendarStatsResponse> {
  const query = buildQuery({
    month,
    account_id: filters.accountId,
    tags: filters.tags && filters.tags.length > 0 ? filters.tags.join(",") : undefined,
  });
  return request<CalendarStatsResponse>(`/stats/calendar${query}`);
}

interface SummaryStatsFilters {
  start?: string;
  end?: string;
  accountId?: number;
  tags?: string[];
}

export function getSummaryStats(filters: SummaryStatsFilters = {}): Promise<SummaryStatsResponse> {
  const query = buildQuery({
    start: filters.start,
    end: filters.end,
    account_id: filters.accountId,
    tags: filters.tags && filters.tags.length > 0 ? filters.tags.join(",") : undefined,
  });
  return request<SummaryStatsResponse>(`/stats/summary${query}`);
}

// /risk and /sessions take exactly the same filters as /summary, so the three
// analytics panels always describe the same set of trades.
function statsQuery(filters: SummaryStatsFilters): string {
  return buildQuery({
    start: filters.start,
    end: filters.end,
    account_id: filters.accountId,
    tags: filters.tags && filters.tags.length > 0 ? filters.tags.join(",") : undefined,
  });
}

export function getRiskStats(filters: SummaryStatsFilters = {}): Promise<RiskStatsResponse> {
  return request<RiskStatsResponse>(`/stats/risk${statsQuery(filters)}`);
}

export function getSessionStats(filters: SummaryStatsFilters = {}): Promise<SessionStatsResponse> {
  return request<SessionStatsResponse>(`/stats/sessions${statsQuery(filters)}`);
}

export function listAccounts(): Promise<AccountRead[]> {
  return request<AccountRead[]>("/accounts");
}

export function createAccount(payload: AccountCreateInput): Promise<AccountRead> {
  return request<AccountRead>("/accounts", { method: "POST", body: JSON.stringify(payload) });
}

export function listTradesByDate(date: string): Promise<TradeRead[]> {
  return request<TradeRead[]>(`/trades?date=${date}`);
}

export function createTrade(payload: TradeCreateInput): Promise<TradeRead> {
  return request<TradeRead>("/trades", { method: "POST", body: JSON.stringify(payload) });
}

export function updateTrade(id: number, payload: TradeUpdateInput): Promise<TradeRead> {
  return request<TradeRead>(`/trades/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteTrade(id: number): Promise<void> {
  return request<void>(`/trades/${id}`, { method: "DELETE" });
}

export async function importTradesCsv(
  file: File,
  accountId: number,
  tag: string | null,
): Promise<ImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("account_id", String(accountId));
  if (tag) formData.append("tag", tag);

  // Not routed through request(): FormData must set its own multipart
  // Content-Type boundary. credentials: "include" still required for the cookie.
  const res = await fetch(`${API_BASE}/trades/import`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!res.ok) throw await extractError(res);

  return (await res.json()) as ImportResult;
}
