import type { Handler, HandlerEvent } from "@netlify/functions";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://tbibfauxuqdhjyiptran.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiaWJmYXV4dXFkaGp5aXB0cmFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY4NjA0MjUsImV4cCI6MjA4MjQzNjQyNX0.pzJN0XOEYVVmT4yidd1RAodIH4hNJ3m_2FaTXI7jpuU";

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
