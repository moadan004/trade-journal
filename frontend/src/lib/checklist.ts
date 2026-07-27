/**
 * The four fixed pre-trade discipline questions. Fixed rather than
 * user-configurable per Phase 7's scope - configurable checklists are a
 * bigger feature (versioning old answers when items change, etc.) that
 * wasn't asked for here.
 */
export const CHECKLIST_ITEMS = [
  { key: "checked_news_calendar", label: "Checked news calendar" },
  { key: "risk_within_limit", label: "Risk within limit" },
  { key: "setup_matches_plan", label: "Setup matches plan" },
  { key: "no_revenge_trade", label: "No revenge trade" },
] as const;

export type ChecklistKey = (typeof CHECKLIST_ITEMS)[number]["key"];
export type ChecklistAnswers = Partial<Record<ChecklistKey, boolean>>;

export function emptyChecklist(): ChecklistAnswers {
  return Object.fromEntries(CHECKLIST_ITEMS.map((item) => [item.key, false])) as ChecklistAnswers;
}

/** How many of the four items were checked "yes" - used for the compact display in trade rows. */
export function checklistScore(checklist: ChecklistAnswers | null): { checked: number; total: number } {
  if (!checklist) return { checked: 0, total: CHECKLIST_ITEMS.length };
  const checked = CHECKLIST_ITEMS.filter((item) => checklist[item.key] === true).length;
  return { checked, total: CHECKLIST_ITEMS.length };
}
