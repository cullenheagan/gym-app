"use client";

import { initial } from "@/lib/avatar";

// A round profile photo, or the first letter of the name on the accent color when there is none.
export default function Avatar({
  src,
  name,
  email,
  size,
}: {
  src: string | null;
  name: string;
  email: string;
  size: number;
}) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      aria-hidden="true"
      className="flex items-center justify-center rounded-full bg-accent font-extrabold text-on-accent"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initial(name, email)}
    </span>
  );
}
