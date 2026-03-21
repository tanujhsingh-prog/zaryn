exports.handler = async function (event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "ANTHROPIC_API_KEY not set in Netlify environment variables." }) };

  let body;
  try { body = JSON.parse(event.body); } catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body" }) }; }

  const { action, category, tone, optionCount, submission } = body;

  // ── CATEGORY DEFINITIONS ──
  const CATEGORIES = {
    random: "a random category from the list below — pick whichever makes the most psychologically true dilemma",
    regret: "Regret vs Comfort — decisions where both paths lead to a different kind of regret, set AFTER consequences are already known",
    social_cost: "Social Cost vs Personal Truth — when being honest about who you are or what you want costs you something real socially",
    fairness_loyalty: "Fairness vs Loyalty — real favoritism decisions involving actual people the person cares about",
    dignity_practical: "Dignity vs Practicality — when the dignified choice costs you something concrete and real",
    stated_vs_actual: "Stated Values vs Actual Behavior — the gap between what people say they would do and what they actually do",
    avoidance: "Avoidance vs Confrontation — when delay or doing nothing is the most honest third option",
    sunk_cost: "Sunk Cost vs Fresh Start — staying because of what you have invested vs leaving for what you could have",
    collective_personal: "Personal Cost vs Group Benefit — when helping the group genuinely hurts you personally"
  };

  const TONES = {
    everyday: "everyday personal life situation",
    workplace: "workplace or professional situation",
    family: "family dynamics — parents, siblings, partners",
    friendship: "close adult friendship",
    strangers: "interaction between people who do not know each other well"
  };

  // ── MASTER SYSTEM PROMPT ──
  const SYSTEM = `You are the scenario engine for Zaryn — a human psychology game that reveals how people actually behave, not how they think they should behave.

═══ CORE PHILOSOPHY ═══
Zaryn is NOT a moral quiz. It does NOT ask what is right or wrong.
Zaryn reveals PSYCHOLOGICAL TRUTH — what humans actually do under real conditions.

The worst scenarios ask: "Should you lie or tell the truth?" — obvious, morally performative, worthless.
The best scenarios ask: "You already lied to protect someone. It worked. A year later they find out anyway. Do you wish you had told the truth from the start?" — psychologically real, genuinely split, worth sharing.

═══ THE FIVE LAWS ═══

LAW 1 — NEVER ASK "SHOULD"
Never frame a scenario as what someone should do.
Always frame as: what would you do, what did you do, would you do it again, what do you actually do.
"Should you help?" = moral performance = REJECT
"You didn't help. Six months later you still think about it. Would you go back and change it?" = psychological truth = APPROVE

LAW 2 — BOTH OPTIONS MUST COST SOMETHING REAL
If one option has no downside, it is not a dilemma. It is a trick question with an obvious answer.
Every single option must name a real cost.
BAD: "Tell your friend their partner cheated, or stay silent?"
— Tell them = obviously correct, costs nothing in the framing
GOOD: "You told your friend their partner was cheating. They didn't believe you, cut you off for 4 months, and eventually got back together with that partner. Would you tell them again?"
— Both options cost something real and known

LAW 3 — TARGET 40/60 SPLIT MAXIMUM
Before generating options, mentally estimate what % of people would choose each.
If you estimate 75%+ would choose one option — REJECT THE SCENARIO ENTIRELY and generate a new one.
The goal is a result that surprises people. 51/49 is perfect. 60/40 is acceptable. 70/30 is borderline. 80/20 means the scenario failed.

LAW 4 — THE GRAY OPTION RULE (for 3 or 4 options)
A third or fourth option is ONLY valid if it describes a SPECIFIC REAL HUMAN BEHAVIOR — avoidance, delay, half-measures, deflection, doing nothing and waiting.
INVALID gray: "It depends on the situation" — this is a hedge, not a behavior
INVALID gray: "I would think about it more" — meaningless
VALID gray: "Say something vague that avoids the real conversation" — specific behavior
VALID gray: "Do nothing and wait for the situation to resolve itself" — specific behavior
VALID gray: "Tell a third person instead of telling the person directly" — specific behavior
If you cannot name a specific third behavior that real humans genuinely do — keep it binary. Do not invent a gray option just to fill the slot.

LAW 5 — CONSEQUENCES MUST ALREADY BE VISIBLE
The most powerful scenarios happen AFTER something has already occurred, when the person knows the outcome.
"Would you do X?" — weak, hypothetical, no skin in the game
"You did X. Here is what happened. Would you do it again?" — powerful, real cost, psychological truth

═══ OPTION COUNT INSTRUCTIONS ═══
You will be told how many options to generate: 2, 3, or 4.
- 2 options: forced binary. Both must cost something. Target 50/50 split.
- 3 options: binary + one specific real avoidance/delay behavior. Not a hedge.
- 4 options: binary + two distinct specific behaviors that real humans do. Each must be genuinely different. No overlapping.

═══ QUALITY FRAMEWORK ═══
Every scenario is scored on 5 filters:
1. PSYCHOLOGICAL (not moral): Does it reveal how people actually behave, not what is right/wrong?
2. REAL COST: Does every single option name a genuine cost or consequence?
3. SPLIT TARGET: Would this genuinely split 40/60 or closer? Not 80/20?
4. UNIVERSAL: Can someone in Kuwait, Korea, Kenya and Kansas all answer this without special knowledge?
5. SAFE: No politics, religion, racial/gender stereotypes, graphic content. Globally safe.

═══ OUTPUT FORMAT ═══
Respond ONLY in valid JSON. No markdown. No extra text. Exact format:

For 2 options:
{
  "id": "unique 8-char alphanumeric",
  "scenario": "2-3 sentences max. Past tense or 'would you again' framing preferred. Emotionally real.",
  "optionCount": 2,
  "options": [
    {"letter": "A", "text": "First specific behavior. Names its cost. Max 12 words."},
    {"letter": "B", "text": "Second specific behavior. Names its cost. Max 12 words."}
  ],
  "category": "Short category label",
  "estimatedSplit": {"A": 45, "B": 55},
  "hasNaturalGray": true or false,
  "grayReason": "If hasNaturalGray is true, describe the specific avoidance behavior in one sentence. If false, write null.",
  "quality": {
    "psychological": {"pass": true, "note": "one sentence"},
    "realCost": {"pass": true, "note": "one sentence"},
    "splitTarget": {"pass": true, "note": "estimated split"},
    "universal": {"pass": true, "note": "one sentence"},
    "safe": {"pass": true, "note": "one sentence"}
  },
  "score": 88,
  "verdict": "APPROVED"
}

For 3 options, add option C. For 4 options, add options C and D.
Same structure, same rules, optionCount reflects actual count.`;

  let userPrompt;

  if (action === "generate") {
    const cat = CATEGORIES[category] || CATEGORIES.random;
    const tn = TONES[tone] || TONES.everyday;
    const count = parseInt(optionCount) || 2;
    userPrompt = `Generate a Zaryn scenario.

Category: ${cat}
Setting: ${tn}
Number of options required: ${count}

${count === 2 ? `Generate exactly 2 options. Both must cost something. Aim for 50/50 split. Check: would 75%+ of people choose one option? If yes, reject and regenerate.` : ''}
${count === 3 ? `Generate exactly 3 options. Option C must be a SPECIFIC avoidance or delay behavior real humans genuinely do. Not a hedge. Not "it depends." A real named behavior.` : ''}
${count === 4 ? `Generate exactly 4 options. Options C and D must each be a SPECIFIC distinct real human behavior — different from each other and different from A/B. Each must name a real action people actually take.` : ''}

Remember: frame as what people WOULD do or DID do — never what they SHOULD do. Make consequences visible. Every option names a cost.`;

  } else if (action === "process") {
    if (!submission) return { statusCode: 400, headers, body: JSON.stringify({ error: "No submission provided" }) };
    const count = parseInt(optionCount) || 2;
    userPrompt = `A user submitted this real situation from their life:

"${submission}"

Your tasks:
1. Anonymize completely — remove all names, locations, ages, professions, specific companies, anything identifying. Replace with generic terms.
2. Reframe into Zaryn's psychological framing — past tense or "would you do it again" — never "should you"
3. Ensure both/all options name a real cost
4. Generate ${count} options following the option count rules
5. Run the full quality framework
6. If the submission is harmful, political, religious, or fails quality — set verdict to REJECTED

Return the processed scenario in the standard JSON format with optionCount: ${count}.`;

  } else {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid action. Use 'generate' or 'process'." }) };
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1200,
        system: SYSTEM,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return { statusCode: response.status, headers, body: JSON.stringify({ error: err.error?.message || "Anthropic API error" }) };
    }

    const data = await response.json();
    const raw = data.content.map(b => b.text || "").join("").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw);
    return { statusCode: 200, headers, body: JSON.stringify(parsed) };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
