import type { SupabaseClient } from "@supabase/supabase-js";

export const PHOTO_BUCKET = "equipment-photos";

// Guest demo accounts cannot store photos (the storage policy refuses them too, see migration 0022).
export const GUEST_NO_PHOTOS = "Photos aren't available in the guest demo.";

// Shrink a phone photo (often 4+ MB) to a ~1200px JPEG before uploading it.
export async function compressPhoto(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read that photo."))), "image/jpeg", 0.8),
  );
}

// Upload to the private bucket and return a short-lived link to show it.
export async function uploadPhoto(
  db: SupabaseClient,
  path: string,
  blob: Blob,
): Promise<{ url: string | null; error: string | null }> {
  const { data } = await db.auth.getSession();
  if (data.session?.user.is_anonymous) return { url: null, error: GUEST_NO_PHOTOS };
  const up = await db.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (up.error) return { url: null, error: up.error.message };
  const signed = await db.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
  return { url: signed.data?.signedUrl ?? null, error: null };
}
