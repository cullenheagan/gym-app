export type Unit = "lb" | "kg";

const LB_PER_KG = 2.20462262;

// Weights are stored in kilograms; these convert for display and input.
export function toDisplay(kg: number, unit: Unit): number {
  const v = unit === "kg" ? kg : kg * LB_PER_KG;
  return Math.round(v * 100) / 100;
}

export function fromDisplay(value: number, unit: Unit): number {
  return unit === "kg" ? value : value / LB_PER_KG;
}

export function formatWeight(kg: number, unit: Unit): string {
  return String(toDisplay(kg, unit));
}
