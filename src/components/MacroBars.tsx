import type { Macros, Targets } from "@/lib/nutrition";

const ROWS: { key: "protein" | "carbs" | "fat"; label: string }[] = [
  { key: "protein", label: "Protein" },
  { key: "carbs", label: "Carbs" },
  { key: "fat", label: "Fat" },
];

// Protein, carbs and fat as bars against the daily targets (plain totals when no target is set).
export default function MacroBars({ totals, targets }: { totals: Macros; targets: Targets }) {
  return (
    <div className="flex flex-col gap-2">
      {ROWS.map((r) => {
        const goal = targets[r.key];
        const value = Math.round(totals[r.key]);
        const pct = goal && goal > 0 ? Math.min(100, (totals[r.key] / goal) * 100) : 0;
        return (
          <div key={r.key} className="grid grid-cols-[56px_1fr_88px] items-center gap-2 text-xs">
            <span className="font-semibold text-muted">{r.label}</span>
            <div className="h-2 overflow-hidden rounded-full bg-field" role="img" aria-label={`${r.label} ${value} g${goal ? ` of ${Math.round(goal)} g` : ""}`}>
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-right font-bold">{goal ? `${value} / ${Math.round(goal)} g` : `${value} g`}</span>
          </div>
        );
      })}
    </div>
  );
}
