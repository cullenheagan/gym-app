"use client";

export type Section = "home" | "train" | "nutrition";

const ICONS: Record<Section, string> = {
  home: '<path d="M3 11l9-8 9 8v10a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z"/>',
  train: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  nutrition: '<path d="M19 3v12h-5c-.023-3.681.184-7.406 5-12zM19 15v6h-1v-3M8 4v17M5 4v3a3 3 0 106 0V4"/>',
};
const LABELS: Record<Section, string> = { home: "Home", train: "Train", nutrition: "Nutrition" };

// The main navigation: Home, Train and Nutrition. Coach joins it in a later phase.
// Icons are outline-with-tint: soft blue fill when selected.
export default function BottomBar({
  selected,
  onSelect,
}: {
  selected: Section | null;
  onSelect: (s: Section) => void;
}) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-4 bottom-3 z-30 mx-auto flex max-w-md rounded-[30px] border border-line bg-card p-1.5 shadow-lg"
    >
      {(["home", "train", "nutrition"] as Section[]).map((s) => {
        const on = selected === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onSelect(s)}
            aria-current={on ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 rounded-3xl pb-1.5 pt-2 text-[11.5px] font-bold ${
              on ? "bg-tint text-accent" : "text-muted"
            }`}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill={on ? "var(--accent)" : "none"}
              fillOpacity={on ? 0.25 : undefined}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: ICONS[s] }}
            />
            {LABELS[s]}
          </button>
        );
      })}
    </nav>
  );
}
