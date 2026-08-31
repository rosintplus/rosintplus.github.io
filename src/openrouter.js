/**
 * OpenRouter AI Analytics Integration for Rosint+
 * Powered by high-capability free-tier LLMs with automatic fallback.
 */

function getApiKey() {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_OPENROUTER_KEY) {
    return import.meta.env.VITE_OPENROUTER_KEY;
  }
  if (typeof globalThis !== "undefined" && globalThis.process?.env?.VITE_OPENROUTER_KEY) {
    return globalThis.process.env.VITE_OPENROUTER_KEY;
  }
  if (typeof window !== "undefined" && window.localStorage) {
    const userKey = window.localStorage.getItem("rosint_openrouter_key");
    if (userKey) return userKey;
  }
  try {
    return atob("c2stb3ItdjEtOWZhZDY1ZjlhZDhhYzg2ZmMyZTY0ZTMzYjgzMWM0ODkyZDMxMjdhZDAyYzQxNDZiMWE1NjEwMTE1NDY4NDIyMQ==");
  } catch {
    return "";
  }
}

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

// Ordered list of active free-tier models with fallback support
export const FREE_MODELS = [
  "minimax/minimax-m3:free",
  "openrouter/free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3.5-lightning:free",
  "z-ai/glm-5.2:free"
];

const aiResponseCache = new Map();

/**
 * Format profile context for the LLM
 */
function buildAnalysisPrompt(username, stats = {}, posts = [], comments = []) {
  const topSubs = Object.entries(stats?.subredditCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .map(([sub, count]) => `r/${sub} (${count} items)`)
    .join(", ");

  const postSamples = (posts || [])
    .slice(0, 15)
    .map((p, i) => `[Post ${i + 1} in r/${p.subreddit || "unknown"}]: "${p.title || ""}" ${p.selftext ? `— ${p.selftext.slice(0, 200)}` : ""}`)
    .join("\n");

  const commentSamples = (comments || [])
    .slice(0, 25)
    .map((c, i) => `[Comment ${i + 1} in r/${c.subreddit || "unknown"}]: "${(c.body || "").slice(0, 300)}"`)
    .join("\n");

  return `You are a perceptive sociologist, political psychologist, and cultural discourse analyst.
Analyze the Reddit profile history of u/${username} to infer their underlying political, social, and cultural worldview.

COMMUNITY FOOTPRINT (Subreddits & Activity):
${topSubs || "None"}

POST SUBMISSIONS:
${postSamples || "None"}

COMMENT SAMPLES:
${commentSamples || "None"}

UNDERSTANDING IMPLICIT IDEOLOGY & SOCIAL CUES:
A user does NOT need to discuss explicit legislation or political parties to have a clear ideological compass. Political and cultural ideology is deeply expressed through everyday topics, social attitudes, lifestyle choices, humor, and community choices:
1. SOCIAL & CULTURAL VALUES (soc: -10.0 Progressive to +10.0 Traditional):
   - Progressive (-10 to -3): Secularism, LGBTQ+ support, gender egalitarianism, reproductive autonomy, progressive parenting, anti-dogmatism, inclusive social reform.
   - Traditional (+3 to +10): Religious conviction, traditional family/social roles, social conservatism, heritage preservation, cultural skepticism of modern trends.
   - Everyday signals: Gender dynamics (e.g. MensRights, TwoXChromosomes), relationship/dating attitudes, religion, moral opinions, parenting, and entertainment culture.

2. ECONOMIC PHILOSOPHY (econ: -10.0 Left/Labor to +10.0 Free Market):
   - Left / Labor (-10 to -3): Worker solidarity, frustration with corporate greed/landlords/wealth inequality, universal public services, mutual aid, anti-consumerism.
   - Market / Capitalist (+3 to +10): Entrepreneurship, stock trading, crypto, FIRE (Financial Independence), deregulation, personal fiscal responsibility, pro-business attitudes.
   - Everyday signals: Gripes about bosses/wages/rent, spending habits, investing, side hustles, and views on wealth.

3. CIVIL AUTHORITY & GOVERNANCE (gov: -10.0 Libertarian to +10.0 Authoritarian):
   - Civil Libertarian (-10 to -3): Skepticism of authority/censorship/corporate telemetry/police, emphasis on personal digital privacy, decentralization, DIY self-reliance, gun ownership as civil liberty.
   - Statist / Order (+3 to +10): Trust in institutional hierarchy, strict law enforcement, civic order, community regulation, public compliance.
   - Everyday signals: Tech privacy/telemetry, censorship, rules/regulations, personal autonomy.

CRITICAL GUIDELINES:
- ARCHETYPE: Use a concise 2 to 4 word standard label (e.g. "Libertarian Left (Lib-Left)", "Social Democrat", "Democratic Socialist", "Progressive Libertarian", "Centrist / Moderate", "Fiscal Conservative", "Libertarian Right", "Traditionalist / Auth-Right"). Never use long compound phrases.
- DIMENSION LABELS: Strictly 1 to 2 words per dimension label (e.g. "Free Market", "Mixed Left", "Socialist", "Progressive", "Moderate", "Traditional", "Libertarian", "Balanced", "Statist"). NEVER output long multi-clause descriptions, compound slashes, or parenthetical notes.
- SUMMARY: A detailed, perceptive 2-sentence overview capturing the user's core worldview, economic stance, and social philosophy.
- STANCES: Extract 2 to 4 specific worldview stances:
  * topic: 2 to 4 word topic title (e.g. "Platform Governance", "Digital Privacy", "Labor & Workplace").
  * stance: A clear, informative 1-2 sentence description of their viewpoint (15 to 25 words).
  * quote: Verbatim quote snippet from comments or posts.
- Sarcastic comments (e.g. '/s', ironic hyperbole) must have their meaning interpreted accurately (not literally).
- Set hasSignal: true whenever the user shows ANY identifiable social, cultural, economic, or governance attitudes in their community choices or comments.

Return ONLY a valid JSON object matching this schema:
{
  "hasSignal": true,
  "econ": -3.5,
  "soc": -4.0,
  "gov": -6.5,
  "archetype": "Libertarian Left (Lib-Left)",
  "confidence": "High (Inferred from community footprint and social commentary)",
  "summary": "Perceptive 2-sentence overview of user's core social, economic, and cultural outlook.",
  "dimensions": {
    "econ": { "score": -3.5, "label": "Mixed Left" },
    "soc": { "score": -4.0, "label": "Progressive" },
    "gov": { "score": -6.5, "label": "Libertarian" }
  },
  "stances": [
    {
      "topic": "Topic Name",
      "stance": "Clear description of their cultural or policy viewpoint",
      "polarity": "Left | Right | Progressive | Traditional | Libertarian | Statist",
      "quote": "Verbatim quote snippet from comments/posts"
    }
  ]
}`;
}

/**
 * Clean and parse LLM JSON responses (handles markdown code fences)
 */
function parseCleanJson(rawText) {
  if (!rawText) return null;
  let clean = rawText.trim();
  clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    return JSON.parse(clean);
  } catch {
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(clean.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Analyze a Reddit profile using OpenRouter's free models with fallback
 */
export async function analyzeProfileWithAI({
  username = '',
  stats = {},
  posts = [],
  comments = [],
  signal = null,
  bypassCache = false,
} = {}) {
  if (!username) throw new Error("Username required for AI analysis");

  const cacheKey = `${username.toLowerCase()}_${(posts?.length || 0)}_${(comments?.length || 0)}`;
  if (!bypassCache && aiResponseCache.has(cacheKey)) {
    return aiResponseCache.get(cacheKey);
  }
  if (bypassCache) {
    aiResponseCache.delete(cacheKey);
  }

  const prompt = buildAnalysisPrompt(username, stats, posts, comments);
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("OpenRouter API key is missing. Please set VITE_OPENROUTER_KEY.");
  }

  let lastError = null;

  for (const model of FREE_MODELS) {
    if (signal?.aborted) throw new Error("Aborted");

    const timeoutCtrl = new AbortController();
    const timeoutTimer = setTimeout(() => timeoutCtrl.abort(), 12000);
    const handleAbort = () => timeoutCtrl.abort();
    if (signal) signal.addEventListener("abort", handleAbort);

    try {
      const response = await fetch(OPENROUTER_ENDPOINT, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://rosintplus.github.io",
          "X-Title": "Rosint+ Reddit OSINT Intelligence",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: "You are an objective, evidence-based political scientist and discourse analyst. Always return valid, strictly formatted JSON with no markdown wrapping."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.0,
          max_tokens: 1200,
          response_format: { type: "json_object" }
        }),
        signal: timeoutCtrl.signal
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        console.warn(`OpenRouter model ${model} error (${response.status}):`, errBody);
        lastError = new Error(`OpenRouter HTTP ${response.status}`);
        continue; // Try next fallback model
      }

      const json = await response.json();
      const content = json.choices?.[0]?.message?.content;
      const parsed = parseCleanJson(content);

      if (parsed && typeof parsed === "object" && typeof parsed.econ === "number") {
        const result = {
          ...parsed,
          modelUsed: model,
          fetchedAt: Date.now(),
        };
        aiResponseCache.set(cacheKey, result);
        return result;
      } else {
        console.warn(`Model ${model} returned unparseable JSON:`, content);
        lastError = new Error("Invalid JSON structure from model");
      }
    } catch (err) {
      if (err?.name === "AbortError" || signal?.aborted) throw err;
      console.warn(`Fetch failure on model ${model}:`, err);
      lastError = err;
    } finally {
      clearTimeout(timeoutTimer);
      if (signal) signal.removeEventListener("abort", handleAbort);
    }
  }

  throw lastError || new Error("All OpenRouter models failed to respond");
}
