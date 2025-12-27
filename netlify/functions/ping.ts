import type { Handler } from "@netlify/functions";

const handler: Handler = async () => {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({ ok: true, timestamp: new Date().toISOString() }),
  };
};

export { handler };
