"use client";

import { useEffect, useState } from "react";

// A number box that keeps what you are typing ("132." on the way to "132.5") instead of
// rewriting it on every key press.
export default function NumField({
  value,
  onChange,
  ariaLabel,
  integer = false,
  max,
  placeholder,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  ariaLabel: string;
  integer?: boolean;
  max?: number;
  placeholder?: string;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));

  useEffect(() => {
    const parsed = integer ? parseInt(text, 10) : parseFloat(text);
    const same = value == null ? text === "" || Number.isNaN(parsed) : parsed === value;
    if (!same) setText(value == null ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      inputMode={integer ? "numeric" : "decimal"}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        let v = integer ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
        if (Number.isNaN(v)) return onChange(null);
        if (max != null) v = Math.min(max, v);
        onChange(v);
      }}
      className="h-11 w-full rounded-xl border-2 border-transparent bg-field text-center text-[17px] font-bold outline-none focus:border-accent"
    />
  );
}
