import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";

interface ChoicePayload {
  fromNode: string;
  fromTitle: string;
  choiceId: string;
  choiceText: string;
  toNode: string;
  timestamp: string;
}

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // Parse the request body
  let payload: ChoicePayload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  const { fromNode, fromTitle, choiceText, toNode, timestamp } = payload;

  // Check for required env vars
  const resendApiKey = process.env.RESEND_API_KEY;
  const notifyEmail = process.env.NOTIFY_EMAIL;

  if (!resendApiKey || !notifyEmail) {
    console.error("Missing RESEND_API_KEY or NOTIFY_EMAIL environment variable");
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Email not configured",
        hasApiKey: !!resendApiKey,
        hasEmail: !!notifyEmail
      }),
    };
  }

  // Format the timestamp nicely
  const date = new Date(timestamp);
  const formattedTime = date.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  // Send email via Resend
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Adventure <onboarding@resend.dev>",
        to: [notifyEmail],
        subject: `Adventure Choice: "${choiceText}"`,
        html: `
          <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5e6d3; border-radius: 10px;">
            <h1 style="color: #5d3a1a; font-size: 24px; margin-bottom: 20px;">A choice has been made!</h1>

            <div style="background: #fff; padding: 20px; border-radius: 8px; border: 2px solid #8b4513; margin-bottom: 20px;">
              <p style="margin: 0 0 10px; color: #666; font-size: 14px;">${formattedTime}</p>

              <p style="margin: 0 0 15px; color: #3d2a1a; font-size: 16px;">
                <strong>From:</strong> ${fromTitle || fromNode}
              </p>

              <p style="margin: 0 0 15px; color: #228b22; font-size: 20px; font-weight: bold;">
                "${choiceText}"
              </p>

              <p style="margin: 0; color: #3d2a1a; font-size: 16px;">
                <strong>Going to:</strong> ${toNode}
              </p>
            </div>

            <p style="color: #7d5a3a; font-size: 14px; font-style: italic;">
              Time to write the next part of the adventure!
            </p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Resend API error:", error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Failed to send email", details: error }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error("Error sending email:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to send email" }),
    };
  }
};

export { handler };
