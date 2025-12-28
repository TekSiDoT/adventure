import type { Handler, HandlerEvent } from "@netlify/functions";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://tbibfauxuqdhjyiptran.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiaWJmYXV4dXFkaGp5aXB0cmFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY4NjA0MjUsImV4cCI6MjA4MjQzNjQyNX0.pzJN0XOEYVVmT4yidd1RAodIH4hNJ3m_2FaTXI7jpuU";

interface ProxyRequest {
  endpoint: string;
  method?: string;
  body?: any;
}

const handler: Handler = async (event: HandlerEvent) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
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

  let request: ProxyRequest;
  try {
    request = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  const { endpoint, method = "GET", body } = request;

  if (!endpoint || typeof endpoint !== "string") {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing endpoint" }),
    };
  }

  // Get auth token from request header (passed through from client)
  const authToken = event.headers.authorization?.replace("Bearer ", "") || SUPABASE_ANON_KEY;

  try {
    const url = `${SUPABASE_URL}${endpoint}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${authToken}`,
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body && (method === "POST" || method === "PATCH" || method === "PUT")) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);
    const data = await response.json();

    return {
      statusCode: response.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(data),
    };
  } catch (error: any) {
    console.error("Proxy error:", error);
    return {
      statusCode: 502,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Failed to reach Supabase" }),
    };
  }
};

export { handler };
