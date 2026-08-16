export function getSupabasePublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return url && anonKey ? { url, anonKey } : null;
}

export function getSupabaseAdminConfig() {
  const publicConfig = getSupabasePublicConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return publicConfig && serviceRoleKey
    ? { url: publicConfig.url, serviceRoleKey }
    : null;
}

export function getSupabaseProjectIdentity() {
  const config = getSupabasePublicConfig();
  if (!config) return { hostname: null, projectRef: null };
  try {
    const hostname = new URL(config.url).hostname;
    return {
      hostname,
      projectRef: hostname.endsWith(".supabase.co")
        ? hostname.slice(0, -".supabase.co".length)
        : null,
    };
  } catch {
    return { hostname: null, projectRef: null };
  }
}

export function isSupabaseConfigured() {
  return getSupabasePublicConfig() !== null;
}
