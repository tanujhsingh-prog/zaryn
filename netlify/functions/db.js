const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// ── Supabase REST helper ──
async function sb(method, path, body = null, xheaders = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      ...xheaders,
    },
    body: body ? JSON.stringify(body) : null,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

function today() {
  return new Date().toISOString().split("T")[0];
}

function ok(data) {
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify(data) };
}
function err(msg, code = 400) {
  return { statusCode: code, headers: HEADERS, body: JSON.stringify({ error: msg }) };
}

// ── Count votes per option ──
function countVotes(votes) {
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  for (const v of (votes || [])) counts[v.option_letter] = (counts[v.option_letter] || 0) + 1;
  return counts;
}

// ── Build display totals (real + anchor) ──
function buildDisplay(slot, realCounts) {
  const anchor = slot.anchor_enabled ? {
    A: slot.anchor_a || 0,
    B: slot.anchor_b || 0,
    C: slot.anchor_c || 0,
    D: slot.anchor_d || 0,
  } : { A: 0, B: 0, C: 0, D: 0 };

  const display = {};
  let total = 0;
  for (const letter of ["A", "B", "C", "D"]) {
    display[letter] = (realCounts[letter] || 0) + (anchor[letter] || 0);
    total += display[letter];
  }
  const realTotal = Object.values(realCounts).reduce((a, b) => a + b, 0);
  return { display, total, realTotal, anchor, realCounts };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: HEADERS, body: "" };
  if (event.httpMethod !== "POST") return err("Method not allowed", 405);

  if (!SUPABASE_URL || !SUPABASE_KEY) return err("SUPABASE_URL or SUPABASE_SERVICE_KEY not set in Netlify environment variables.", 500);

  let body;
  try { body = JSON.parse(event.body); } catch { return err("Invalid request body"); }

  const { action } = body;

  try {

    // ════════════════════════════════════
    // USER ACTIONS
    // ════════════════════════════════════

    // Get today's 3 scenarios with vote counts
    if (action === "get_daily") {
      const date = body.date || today();
      const slots = await sb("GET", `daily_slots?slot_date=eq.${date}&order=slot_number.asc`);
      const result = [];

      for (const slot of (slots || [])) {
        let scenario = null;
        if (slot.scenario_id) {
          const rows = await sb("GET", `scenarios?id=eq.${slot.scenario_id}`);
          scenario = rows?.[0] || null;
        }
        let realCounts = { A: 0, B: 0, C: 0, D: 0 };
        if (slot.scenario_id) {
          const votes = await sb("GET", `votes?scenario_id=eq.${slot.scenario_id}&slot_date=eq.${date}`);
          realCounts = countVotes(votes);
        }
        const voteData = scenario ? buildDisplay(slot, realCounts) : null;
        result.push({ ...slot, scenario, voteData });
      }
      return ok({ slots: result, date });
    }

    // Record a vote
    if (action === "vote") {
      const { scenario_id, option_letter, player_id, slot_date } = body;
      if (!scenario_id || !option_letter || !player_id) return err("Missing vote fields");
      const date = slot_date || today();
      try {
        await sb("POST", "votes", { scenario_id, option_letter, player_id, slot_date: date }, {
          "Prefer": "resolution=ignore-duplicates,return=representation"
        });
      } catch (e) {
        // Duplicate vote — just return existing results
      }
      // Return updated results
      const votes = await sb("GET", `votes?scenario_id=eq.${scenario_id}&slot_date=eq.${date}`);
      const realCounts = countVotes(votes);
      const slots = await sb("GET", `daily_slots?slot_date=eq.${date}&scenario_id=eq.${scenario_id}`);
      const slot = slots?.[0] || { anchor_a: 620, anchor_b: 480, anchor_c: 0, anchor_d: 0, anchor_enabled: true };
      const voteData = buildDisplay(slot, realCounts);
      // Check if player already voted
      const myVote = votes?.find(v => v.player_id === player_id);
      return ok({ success: true, voteData, myVote: myVote?.option_letter });
    }

    // Save a user submission
    if (action === "save_submission") {
      const { id, situation, opt_a, opt_b } = body;
      if (!situation) return err("No situation provided");
      await sb("POST", "submissions", { id: id || `sub_${Date.now()}`, situation, opt_a, opt_b }, {
        "Prefer": "resolution=merge-duplicates"
      });
      return ok({ success: true });
    }

    // ════════════════════════════════════
    // ADMIN ACTIONS
    // ════════════════════════════════════

    // Save scenario to bank
    if (action === "save_scenario") {
      const s = body.scenario;
      if (!s || !s.id) return err("No scenario provided");
      await sb("POST", "scenarios", {
        id: s.id,
        scenario: s.scenario,
        option_count: s.optionCount || s.options?.length || 2,
        options: s.options,
        category: s.category || "General",
        category_key: s.categoryKey || "general",
        estimated_split: s.estimatedSplit,
        quality: s.quality,
        score: s.score || 0,
        verdict: s.verdict || "APPROVED",
        source: s.source || "generated",
      }, { "Prefer": "resolution=merge-duplicates" });
      return ok({ success: true });
    }

    // Get all banked scenarios
    if (action === "get_bank") {
      const rows = await sb("GET", "scenarios?order=banked_at.desc");
      return ok({ scenarios: rows || [] });
    }

    // Delete a scenario
    if (action === "delete_scenario") {
      if (!body.id) return err("No id");
      // Remove from slots first
      await sb("PATCH", `daily_slots?scenario_id=eq.${body.id}`, { scenario_id: null });
      await sb("DELETE", `scenarios?id=eq.${body.id}`);
      return ok({ success: true });
    }

    // Set a daily slot (upsert)
    if (action === "set_slot") {
      const { slot_date, slot_number, scenario_id, anchor_a, anchor_b, anchor_c, anchor_d, anchor_enabled } = body;
      if (!slot_date || !slot_number) return err("Missing slot_date or slot_number");
      const data = { slot_date, slot_number };
      if (scenario_id !== undefined) data.scenario_id = scenario_id;
      if (anchor_a !== undefined) data.anchor_a = parseInt(anchor_a) || 0;
      if (anchor_b !== undefined) data.anchor_b = parseInt(anchor_b) || 0;
      if (anchor_c !== undefined) data.anchor_c = parseInt(anchor_c) || 0;
      if (anchor_d !== undefined) data.anchor_d = parseInt(anchor_d) || 0;
      if (anchor_enabled !== undefined) data.anchor_enabled = anchor_enabled;
      await sb("POST", "daily_slots", data, { "Prefer": "resolution=merge-duplicates" });
      return ok({ success: true });
    }

    // Get scheduled slots
    if (action === "get_slots") {
      const from = body.from || today();
      const rows = await sb("GET", `daily_slots?slot_date=gte.${from}&order=slot_date.asc,slot_number.asc`);
      // Enrich with scenario data
      const enriched = [];
      for (const slot of (rows || [])) {
        let scenario = null;
        if (slot.scenario_id) {
          const s = await sb("GET", `scenarios?id=eq.${slot.scenario_id}`);
          scenario = s?.[0] || null;
        }
        // Get real vote counts
        let realCounts = { A: 0, B: 0, C: 0, D: 0 };
        if (slot.scenario_id) {
          const votes = await sb("GET", `votes?scenario_id=eq.${slot.scenario_id}&slot_date=eq.${slot.slot_date}`);
          realCounts = countVotes(votes);
        }
        enriched.push({ ...slot, scenario, realCounts });
      }
      return ok({ slots: enriched });
    }

    // Remove a slot assignment
    if (action === "remove_slot") {
      const { slot_date, slot_number } = body;
      if (!slot_date || !slot_number) return err("Missing fields");
      await sb("PATCH", `daily_slots?slot_date=eq.${slot_date}&slot_number=eq.${slot_number}`, {
        scenario_id: null
      });
      return ok({ success: true });
    }

    // Get submissions (admin)
    if (action === "get_submissions") {
      const rows = await sb("GET", "submissions?order=submitted_at.desc");
      return ok({ submissions: rows || [] });
    }

    // Update submission (after AI processing)
    if (action === "update_submission") {
      const { id, status, processed_scenario } = body;
      if (!id) return err("No id");
      await sb("PATCH", `submissions?id=eq.${id}`, { status, processed_scenario });
      return ok({ success: true });
    }

    // Delete submission
    if (action === "delete_submission") {
      if (!body.id) return err("No id");
      await sb("DELETE", `submissions?id=eq.${body.id}`);
      return ok({ success: true });
    }

    // Get settings
    if (action === "get_settings") {
      const rows = await sb("GET", "app_settings");
      const settings = {};
      for (const row of (rows || [])) settings[row.key] = row.value;
      return ok({ settings });
    }

    // Save settings
    if (action === "save_settings") {
      const { settings } = body;
      for (const [key, value] of Object.entries(settings || {})) {
        await sb("POST", "app_settings", { key, value, updated_at: new Date().toISOString() }, {
          "Prefer": "resolution=merge-duplicates"
        });
      }
      return ok({ success: true });
    }

    // Get runway info
    if (action === "get_runway") {
      const scenarios = await sb("GET", "scenarios?order=banked_at.desc");
      const slots = await sb("GET", `daily_slots?slot_date=gte.${today()}&order=slot_date.asc`);
      const scheduledIds = new Set((slots || []).filter(s => s.scenario_id).map(s => s.scenario_id));
      const unscheduled = (scenarios || []).filter(s => !scheduledIds.has(s.id));
      const settingsRows = await sb("GET", "app_settings");
      const settings = {};
      for (const row of (settingsRows || [])) settings[row.key] = row.value;
      const qpd = parseInt(settings.questions_per_day || "3");
      const runway = Math.floor(unscheduled.length / qpd);
      return ok({ total: (scenarios || []).length, unscheduled: unscheduled.length, runway, qpd });
    }

    // Auto-schedule: fill upcoming slots from bank
    if (action === "auto_schedule") {
      const { days = 7 } = body;
      const scenarios = await sb("GET", "scenarios?order=banked_at.desc");
      const existingSlots = await sb("GET", `daily_slots?slot_date=gte.${today()}&order=slot_date.asc`);
      const settingsRows = await sb("GET", "app_settings");
      const settings = {};
      for (const row of (settingsRows || [])) settings[row.key] = row.value;
      const qpd = Math.min(parseInt(settings.questions_per_day || "3"), 3);

      // Find used scenario IDs
      const usedIds = new Set((existingSlots || []).filter(s => s.scenario_id).map(s => s.scenario_id));
      const pool = (scenarios || []).filter(s => !usedIds.has(s.id));

      let poolIdx = 0;
      let scheduled = 0;
      const startDate = new Date();

      for (let d = 0; d < days; d++) {
        const dateStr = new Date(startDate.getTime() + d * 86400000).toISOString().split("T")[0];
        for (let slot = 1; slot <= qpd; slot++) {
          const existing = (existingSlots || []).find(s => s.slot_date === dateStr && s.slot_number === slot);
          if (existing?.scenario_id) continue; // already scheduled
          if (poolIdx >= pool.length) break;
          const scenario = pool[poolIdx++];
          await sb("POST", "daily_slots", {
            slot_date: dateStr,
            slot_number: slot,
            scenario_id: scenario.id,
            anchor_a: parseInt(settings.default_anchor_a || "620"),
            anchor_b: parseInt(settings.default_anchor_b || "480"),
            anchor_enabled: true
          }, { "Prefer": "resolution=merge-duplicates" });
          scheduled++;
        }
        if (poolIdx >= pool.length) break;
      }
      return ok({ success: true, scheduled });
    }

    return err("Unknown action");

  } catch (e) {
    console.error("DB function error:", e.message);
    return err(e.message, 500);
  }
};
