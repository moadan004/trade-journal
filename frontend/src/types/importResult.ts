export interface ImportSkippedRow {
  row: number;
  reason: string;
}

export interface ImportResult {
  total_rows: number;
  imported: number;
  skipped: ImportSkippedRow[];
}
