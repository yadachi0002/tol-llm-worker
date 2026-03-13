// worker.js (cleaned up essentials)

// CORS: list the one origin that may call this worker from a browser
function isAllowedOrigin(origin) {
  if (!origin) return null;

  // Allow local dev (optional)
  if (/^http:\/\/localhost:\d+$/.test(origin)) return origin;

  // ✅ Add your GitHub Pages origin here
  if (origin === "https://yadachi0002.github.io") return origin;

  return null;
}

function corsHeaders(origin) {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = isAllowedOrigin(origin);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    if (!allowedOrigin) {
      return new Response(JSON.stringify({ error: "Origin not allowed", origin }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse request
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) },
      });
    }

    const responseText     = String(body.response_text || "").trim();
    const learningObjective = String(body.learning_objective || "").trim();
    const criteria          = Array.isArray(body.criteria) ? body.criteria : [];

    if (responseText.length < 10 || responseText.length > 2000) {
      return new Response(JSON.stringify({ error: "Response length out of range" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) },
      });
    }
    if (!learningObjective) {
      return new Response(JSON.stringify({ error: "Missing learning_objective" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) },
      });
    }
    if (!env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) },
      });
    }

    // ----- PROMPTS (edit these to your course needs) -----
    const systemPrompt =
      "You are a Japanese language tutor for beginner-level learners. " +
      "Be supportive and correct mistakes gently. Return ONLY valid JSON (no markdown).";

    const userPrompt =
      `Learning objective:\n${learningObjective}\n\n` +
      `Evaluation criteria:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\n` +
      `Learner response:\n${responseText}\n\n` +
      "Your output MUST be ONLY JSON with exactly these keys:\n" +
      '- verdict (must be: "Correct", "Not quite right", or "Incorrect")\n' +
      "- summary (1–3 sentences, must reference the objective or criteria)\n" +
      '- criteria_feedback (array of objects: { "criterion": string, "met": boolean, "comment": string })\n' +
      '- next_step (one concrete improvement suggestion)\n';

    // ----- OpenAI Responses API call -----
    const openaiResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        // The Responses API supports an array "input". Here we keep it simple:
        input: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt   },
        ],
        // Ask for strict JSON output
        text: { format: { type: "json_object" } },
      }),
    });

    if (!openaiResp.ok) {
      const err = await openaiResp.text();
      return new Response(JSON.stringify({ error: "OpenAI error", detail: err.slice(0, 300) }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) },
      });
    }

    const data = await openaiResp.json();

    // Try to read JSON string from Responses API payload
    const jsonText = extractTextFromResponsesOutput(data);
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return new Response(
        JSON.stringify({
          error: "Model returned non-JSON",
          raw: (jsonText || "").slice(0, 400),
        }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) } }
      );
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(allowedOrigin) },
    });
  },
};

function extractTextFromResponsesOutput(d) {
  try {
    if (typeof d.output_text === "string" && d.output_text.trim()) return d.output_text.trim();
    const out = Array.isArray(d.output) ? d.output : [];
    for (const item of out) {
      const content = Array.isArray(item.content) ? item.content : [];
      for (const c of content) {
        if (c && typeof c.text === "string" && c.text.trim()) return c.text.trim();
      }
    }
    return "";
  } catch {
    return "";
  }
}
