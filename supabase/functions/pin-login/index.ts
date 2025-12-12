import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.87.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function base64UrlEncode(input: ArrayBuffer | string): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signJwtHS256(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const headerPart = base64UrlEncode(JSON.stringify(header));
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const data = `${headerPart}.${payloadPart}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${base64UrlEncode(signature)}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { pin?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const pin = (body.pin || "").trim();
  if (!/^\d{6}$/.test(pin)) {
    return new Response(JSON.stringify({ error: "Invalid PIN format" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET") || Deno.env.get("JWT_SECRET");

  if (!supabaseUrl || !serviceKey || !jwtSecret) {
    console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_JWT_SECRET");
    return new Response(JSON.stringify({ error: "Server not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await admin.rpc("auth_with_pin", { p_pin: pin });

  if (error) {
    console.error("auth_with_pin error:", error);
    return new Response(JSON.stringify({ error: "Invalid PIN" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const response = data as any;
  if (!response?.success || !response.user || !response.story) {
    return new Response(JSON.stringify({ error: response?.error || "Invalid PIN" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const iat = Math.floor(Date.now() / 1000);
  const expiresIn = 60 * 60 * 24 * 7; // 7 days
  const exp = iat + expiresIn;

  const claims = {
    aud: "authenticated",
    role: "authenticated",
    sub: response.user.id,
    app_role: response.user.role,
    story_id: response.story.id,
    iat,
    exp,
  };

  const accessToken = await signJwtHS256(claims, jwtSecret);

  return new Response(
    JSON.stringify({
      ...response,
      access_token: accessToken,
      token_type: "bearer",
      expires_in: expiresIn,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});

