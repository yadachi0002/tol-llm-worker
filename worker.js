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
"You are a Japanese language tutor for beginner-level learners.\n\n" +

"You MUST evaluate learner input using the following procedure:\n\n" +

"Step 1: Evaluate the learner sentence using ALL THREE criteria:\n" +
"  1) The reason clearly and logically connects to the situation.\n" +
"  2) Verbs and adjectives are conjugated correctly in the です／ます form.\n" +
"  3) Particle usage is correct.\n\n" +

"Step 2 (verdict):\n" +
"- If ALL criteria are met, verdict MUST be \"Correct\".\n" +
"- If ONE OR MORE criteria are not met, verdict MUST be \"Not quite right\" or \"Incorrect\".\n\n" +

"Step 3 (Perhaps-you-meant sentence):\n" +
"- If verdict is NOT \"Correct\", generate ONE sentence the learner was probably trying to say.\n" +
"- Place that sentence ONLY in the field `perhaps_you_meant`.\n" +
"- Use natural, beginner-level Japanese.\n\n" +

"Step 4 (criteria feedback):\n" +
"- Provide feedback for each criteria that was NOT met.\n" +
"- If the criteria was met, just indicate that it was met, no feedback is necessary.\n" +
"- Each criterion must appear once.\n" +
"- Do NOT repeat the \"perhaps you meant\" sentence here.\n\n" +

"Step 5 (next steps):\n" +
"- Suggest ONE concrete revision action.\n\n" +

"Output rules:\n" +
"- Output ONLY valid JSON.\n" +
"- Do NOT include markdown.\n" +
"- Do NOT include a summary field.\n\n" +

"Examples:\n\n" +

"Input: こうがくはべんきょうしますから、いそがしいです。\n" +
"verdict: Not quite right\n" +
"perhaps_you_meant: こうがくをべんきょうしますから、いそがしいです。\n" +
"Particle usage is incorrect. こうがく is the direct object of べんきょうします, so the object-marker を should be used instead of は.は marks the topic of the sentence. In this sentence the topic is わたし, so a complete sentence would read わたしはこうがくをべんきょうしますから、いそがしいです。\n" +
"next_step: Try revising the sentence you just wrote as （わたしは）こうがくをべんきょうしますから、いそがしいです。\n\n" +

"Input: 先生がすきですから、やさしいです。\n" +
"verdict: Not quite right\n" +
"perhaps_you_meant: 先生はやさしいですから、すきです。\n" +
"'I like the teacher' is not a clear and logical reason for 'The teacher is kind'. If you wanted to say 'Because the teacher is kind, I like them' you would say 先生はやさしいですから、すきです。\n" +
"next_step: Try revising the sentence you just wrote as 先生はやさしいですから、すきです。\n\n" +

"Input: しゅくだいがたくさんあるますから、たいへんです。\n" +
"verdict: Not quite right\n" +
"perhaps_you_meant: しゅくだいがたくさんありますから、たいへんです。\n" +
"The verb ある is conjugated incorrectly. ある is conjugated as あります in the masu-form.\n" +
"next_step: Try revising the sentence you just wrote as しゅくだいがたくさんありますから、たいへんです。\n\n" +

"Input: 先生がすきですから、日本語はたのしいです。\n" +
"verdict: Correct！\n\n" +

"Input: 先生話難しですから授業は大変です。\n" +
"verdict: Not quite right\n" +
"perhaps_you_meant: 先生のはなしはむずかしいですから、授業はたいへんです。\n" +
"Particle usage is incorrect. 先生 modifies はなし as in 'talk of the teacher', so they should be connected with the modification marker の - 先生のはなし. 先生のはなし is the topic of むずかしい, so it should be marked with the topic marker は.\n" +
"The adjective むずかしい is conjugated incorrectly. It should be むずかしいです.\n" +
"next_step: Try revising the sentence you just wrote as 先生のはなしはむずかしいですから、授業はたいへんです。\n\n" +

"Follow this structure exactly.";

    const userPrompt =
      `Learning objective:\n${learningObjective}\n\n` +
      `Evaluation criteria:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\n` +
      `Learner response:\n${responseText}\n\n` +
      "Your output MUST be ONLY JSON with exactly these keys:\n" +
'- verdict (must be: "Correct", "Not quite right", or "Incorrect")\n' +
'- perhaps_you_meant (string OR null; required when verdict is not "Correct")\n' +
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
