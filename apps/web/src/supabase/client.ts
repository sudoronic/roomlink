import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configurationError =
  !url || !anonKey
    ? "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild RoomLink."
    : !/^https?:\/\//.test(url) || anonKey.startsWith("sb_secret_")
      ? "Use a valid Supabase URL and public publishable/anon key."
      : null;
// No fake endpoint: the configuration screen prevents app operations without a client.
export const supabase: SupabaseClient = configurationError
  ? null!
  : createClient(url, anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
let signingIn: Promise<void> | undefined;
export async function ensureAnonymousSession() {
  if (configurationError) throw new Error(configurationError);
  signingIn ??= (async () => {
    const existing = await supabase.auth.getSession();
    if (existing.error) throw existing.error;
    if (!existing.data.session) {
      const result = await supabase.auth.signInAnonymously();
      if (result.error)
        throw new Error(`Anonymous sign-in failed: ${result.error.message}`);
    }
  })().finally(() => {
    signingIn = undefined;
  });
  await signingIn;
}
