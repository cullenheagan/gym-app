// Free weights and bodyweight work anywhere; machines and cables belong to one gym.
export const EQUIPMENT = [
  { value: "free_weight", label: "Free weight", anyGym: true },
  { value: "bodyweight", label: "Bodyweight", anyGym: true },
  { value: "pin_machine", label: "Pin-loaded machine", anyGym: false },
  { value: "plate_machine", label: "Plate-loaded machine", anyGym: false },
  { value: "cable", label: "Cable", anyGym: false },
] as const;

export const equipmentLabel = (v: string) => EQUIPMENT.find((e) => e.value === v)?.label ?? "Other";
