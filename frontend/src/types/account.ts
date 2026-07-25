export interface AccountRead {
  id: number;
  user_id: number;
  name: string;
  broker: string | null;
  currency: string;
  created_at: string;
}

export interface AccountCreateInput {
  name: string;
  broker?: string | null;
  currency?: string;
}
