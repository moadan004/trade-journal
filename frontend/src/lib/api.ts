import type { AccountCreateInput, AccountRead } from "@/types/account";
import type { ImportResult } from "@/types/importResult";
import type { CalendarStatsResponse } from "@/types/stats";
import type { SummaryStatsResponse } from "@/types/summary";
import type { TradeCreateInput, TradeRead, TradeUpdateInput } from "@/types/trade";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

async function request<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // response had no JSON body; fall back to statusText
    }
    throw new ApiError(res.status, message);
  }

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
  token: string,
  filters: CalendarStatsFilters = {},
): Promise<CalendarStatsResponse> {
  const query = buildQuery({
    month,
    account_id: filters.accountId,
    tags: filters.tags && filters.tags.length > 0 ? filters.tags.join(",") : undefined,
  });
  return request<CalendarStatsResponse>(`/stats/calendar${query}`, {}, token);
}

interface SummaryStatsFilters {
  start?: string;
  end?: string;
  accountId?: number;
  tags?: string[];
}

export function getSummaryStats(
  token: string,
  filters: SummaryStatsFilters = {},
): Promise<SummaryStatsResponse> {
  const query = buildQuery({
    start: filters.start,
    end: filters.end,
    account_id: filters.accountId,
    tags: filters.tags && filters.tags.length > 0 ? filters.tags.join(",") : undefined,
  });
  return request<SummaryStatsResponse>(`/stats/summary${query}`, {}, token);
}

export function listAccounts(token: string): Promise<AccountRead[]> {
  return request<AccountRead[]>("/accounts", {}, token);
}

export function createAccount(payload: AccountCreateInput, token: string): Promise<AccountRead> {
  return request<AccountRead>("/accounts", { method: "POST", body: JSON.stringify(payload) }, token);
}

export function listTradesByDate(date: string, token: string): Promise<TradeRead[]> {
  return request<TradeRead[]>(`/trades?date=${date}`, {}, token);
}

export function createTrade(payload: TradeCreateInput, token: string): Promise<TradeRead> {
  return request<TradeRead>("/trades", { method: "POST", body: JSON.stringify(payload) }, token);
}

export function updateTrade(id: number, payload: TradeUpdateInput, token: string): Promise<TradeRead> {
  return request<TradeRead>(`/trades/${id}`, { method: "PUT", body: JSON.stringify(payload) }, token);
}

export function deleteTrade(id: number, token: string): Promise<void> {
  return request<void>(`/trades/${id}`, { method: "DELETE" }, token);
}

export async function importTradesCsv(
  file: File,
  accountId: number,
  tag: string | null,
  token: string,
): Promise<ImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("account_id", String(accountId));
  if (tag) formData.append("tag", tag);

  const res = await fetch(`${API_URL}/trades/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // response had no JSON body; fall back to statusText
    }
    throw new ApiError(res.status, message);
  }

  return (await res.json()) as ImportResult;
}
