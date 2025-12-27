import type { Handler, HandlerEvent } from "@netlify/functions";

const SUPABASE_URL = "https://pnnteiwvfyltusrrcmbf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBubnRlaXd2ZnlsdHVzcnJjbWJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUzNDU4NDcsImV4cCI6MjA4MDkyMTg0N30.p0FqSUu_u4OBg5rfy5iJvvU77kWWLcs-3FgAbKNfGYI";

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
