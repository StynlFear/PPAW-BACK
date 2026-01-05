import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

function requireSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is required");
  }

  if (!supabaseKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_ANON_KEY is required",
    );
  }

  cachedClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return cachedClient;
}

export async function uploadBufferToStorage(input: {
  bucket: string;
  objectPath: string;
  buffer: Buffer;
  contentType?: string;
}): Promise<{ objectPath: string }>
{
  const supabase = requireSupabaseClient();
  const { error } = await supabase.storage.from(input.bucket).upload(
    input.objectPath,
    input.buffer,
    {
      contentType: input.contentType,
      upsert: false,
    },
  );

  if (error) {
    throw new Error(`supabase storage upload failed: ${error.message}`);
  }

  return { objectPath: input.objectPath };
}

export function getPublicUrlForObject(input: {
  bucket: string;
  objectPath: string;
}): string {
  const supabase = requireSupabaseClient();
  const { data } = supabase.storage
    .from(input.bucket)
    .getPublicUrl(input.objectPath);

  return data.publicUrl;
}

export async function tryDeleteStorageObject(input: {
  bucket: string;
  objectPath: string | undefined;
}): Promise<void> {
  if (!input.objectPath) return;

  const supabase = requireSupabaseClient();

  try {
    await supabase.storage.from(input.bucket).remove([input.objectPath]);
  } catch {
    // ignore
  }
}
