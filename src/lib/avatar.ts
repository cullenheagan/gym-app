// Profile photo helpers: a small square JPEG, kept on the phone as a data URL so it shows instantly
// (and offline), plus the pending sign-up details held until the first sign-in.

export type Avatar = { blob: Blob; dataUrl: string };

// Center-crop to a square and shrink to 320px.
export async function compressAvatar(file: File): Promise<Avatar> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(320, side);
  canvas
    .getContext("2d")
    ?.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read that photo."))), "image/jpeg", 0.85),
  );
  return { blob, dataUrl: canvas.toDataURL("image/jpeg", 0.85) };
}

export function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const [head, body] = dataUrl.split(",");
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: /data:([^;]+)/.exec(head)?.[1] ?? "image/jpeg" });
  } catch {
    return null;
  }
}

export const avatarKey = (userId: string) => `avatar:${userId}`;
export const avatarPath = (userId: string) => `${userId}/avatar.jpg`;
export const pendingKey = (email: string) => `pending-profile:${email.trim().toLowerCase()}`;

export type PendingProfile = { name: string; avatar: string | null };

export function savePending(email: string, p: PendingProfile) {
  try {
    localStorage.setItem(pendingKey(email), JSON.stringify(p));
  } catch {}
}

export function takePending(email: string): PendingProfile | null {
  try {
    const raw = localStorage.getItem(pendingKey(email));
    return raw ? (JSON.parse(raw) as PendingProfile) : null;
  } catch {
    return null;
  }
}

export function clearPending(email: string) {
  try {
    localStorage.removeItem(pendingKey(email));
  } catch {}
}

export function initial(name: string, email: string): string {
  return (name.trim()[0] ?? email.trim()[0] ?? "?").toUpperCase();
}
