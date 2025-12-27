import type { Handler, HandlerEvent } from "@netlify/functions";

const SUPABASE_URL = "https://pnnteiwvfyltusrrcmbf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBubnRlaXd2ZnlsdHVzcnJjbWJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUzNDU4NDcsImV4cCI6MjA4MDkyMTg0N30.p0FqSUu_u4OBg5rfy5iJvvU77kWWLcs-3FgAbKNfGYI";

const handler: Handler = async (event: HandlerEvent) => {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  let body: { pin?: string };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  const pin = body.pin;
  if (!pin || typeof pin !== "string") {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "PIN required" }),
    };
  }

  // Forward request to Supabase edge function
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/pin-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        // Forward client IP for rate limiting
        "X-Forwarded-For": event.headers["x-forwarded-for"] || event.headers["client-ip"] || "unknown",
      },
      body: JSON.stringify({ pin }),
    });

    const data = await response.json();

    return {
      statusCode: response.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.error("Proxy error:", error);
    return {
      statusCode: 502,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Failed to reach authentication server" }),
    };
  }
};

export { handler };
