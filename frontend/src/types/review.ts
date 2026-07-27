export interface WeeklyReviewRead {
  /** Null when no review has been written for this week yet - the API returns a blank template rather than 404. */
  id: number | null;
  week_start_date: string;
  reflections: string;
  created_at: string | null;
  updated_at: string | null;
}
