import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// The publishable key is safe in the browser: row-level security in the
// database decides what each signed-in user can read and write.
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
