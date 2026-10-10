/* Local LLM Box Advisor — single-page app. Data: /api/data (or window.LLM_ADVISOR_SNAPSHOT for the offline file). */
"use strict";
let W, R; // workload (measured), research (sourced)
const S = {
  tab: (location.hash || "#overview").slice(1),
  est: { basis: "mean", ctx: 16000, out: 350, calls: 1.3, cache: 80 },
  calc: { model: "q38_flashnext", quant: "q4", ctxK: 32, conc: 4, kv8: false, offload: false },
  cost: { hw: "spark", plan: "pro+", months: 36, cents: null, busyH: 2, idleW: 15, hostUSD: 0 },
};
const $ = (q) => document.querySelector(q);
const fmt = (n, d = 0) => (n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
const usd = (n, d = 0) => (n == null || isNaN(n) ? "—" : (n < 0 ? "−$" : "$") + fmt(Math.abs(n), d));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const T = { m: '<span class="tag m">MEASURED</span>', e: '<span class="tag e">ESTIMATE</span>', s: '<span class="tag s">CITED</span>', u: '<span class="tag u">UNKNOWN</span>', bench: '<span class="tag bench">BENCH</span>' };
/* CITED = sourced quote with as-of (formerly SOURCED label). */
function src(id, label) {
  const s = R.sources[id];
  if (!s) return '<span class="src">[source missing]</span>';
  return `<span class="src">[<a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}">${esc(label || s.short || shortSrc(s.title))}</a>, as of ${esc(s.asOf)}]</span>`;
}

/* ---------- remaster helpers (Sat Oct 10) ---------- */
function countUp(el, target, ms = 850) {
  const end = Number(target);
  if (!el) return;
  if (!isFinite(end)) { el.textContent = "—"; return; }
  const t0 = performance.now(), decimals = Number(el.dataset.decimals || 0);
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    const eased = 1 - Math.pow(1 - p, 3);
    const v = end * eased;
    el.textContent = decimals ? fmt(v, decimals) : fmt(Math.round(v));
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = decimals ? fmt(end, decimals) : fmt(end);
  };
  requestAnimationFrame(step);
}
function animateKpis(root) {
  const qs = new URLSearchParams(location.search);
  const skip = qs.get("shot") === "1" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  (root || document).querySelectorAll("[data-count]").forEach((el) => {
    const v = Number(el.getAttribute("data-count"));
    const decimals = Number(el.dataset.decimals || 0);
    if (skip || !isFinite(v)) {
      el.textContent = !isFinite(v) ? "—" : (decimals ? fmt(v, decimals) : fmt(Math.round(v)));
      return;
    }
    countUp(el, v, 650 + Math.random() * 450);
  });
}
function weekStrip() {
  const el = document.getElementById("week");
  if (!el) return;
  const u = W && W.usage;
  if (!u || u.used_pct == null) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  const used = Number(u.used_pct), target = u.target_pct != null ? Number(u.target_pct) : null;
  const gap = u.gap_pts != null ? Number(u.gap_pts) : (target != null ? Math.round((target - used) * 10) / 10 : null);
  const behind = gap != null && gap > 0;
  const reset = String(u.reset_at || u.reset_date || "").replace("T", " ").slice(0, 16);
  const checked = String(u.checked_at || "").replace("T", " ").slice(0, 16);
  const barPct = Math.min(100, Math.max(0, used));
  const tgtPct = target != null ? Math.min(100, Math.max(0, target)) : null;
  el.innerHTML = `
    <div class="wk-label">This week</div>
    <div class="wk-body">
      <span>Grok Bot weekly: <b>${esc(used)}%</b> used ${T.m}</span>
      ${target != null ? `<span class="pace"><span>pace ~${esc(target)}%</span>
        <span class="pace-bar" title="used ${used}% · target ~${target}%">
          <i style="width:${barPct}%"></i>
          ${tgtPct != null ? `<span class="tgt" style="left:${tgtPct}%"></span>` : ""}
        </span></span>` : ""}
      ${gap != null ? `<span class="gap ${behind ? "behind" : "ok"}">${behind ? "behind " + esc(gap) + " pts" : "on/near pace"}</span>` : ""}
      <span class="mut tiny">reset ${esc(reset)} ET · Cursor Models ${esc(u.cursor_models_pct ?? "—")}% · Other ${esc(u.other_models_pct ?? "—")}%</span>
    </div>
    <div class="wk-meta">from <code>usage.json</code><br>checked ${esc(checked)} ET<br>never invent %</div>`;
}

function shortSrc(t) { const m = t.match(/\(([^)]+)\)\s*$/); return m ? m[1] : t.split(":")[0].slice(0, 28); }
const hwById = (id) => R.hardware.find((h) => h.id === id);
const modelById = (id) => R.models.find((m) => m.id === id);
const quantById = (id) => R.quants.find((q) => q.id === id);

/* ---------- token estimates (ESTIMATE layer on top of MEASURED step counts) ---------- */
function stepsPerDay() {
  const m = W.measured;
  return { mean: m.stepsPerDayMean, median: m.stepsPerDayMedian, p90: m.stepsPerDayP90, max: m.stepsPerDayMax }[S.est.basis];
}
function tokens() {
  const steps = stepsPerDay(), calls = steps * S.est.calls;
  const input = calls * S.est.ctx, uncached = input * (1 - S.est.cache / 100), cached = input - uncached, output = calls * S.est.out;
  return { steps, calls, input, uncached, cached, output, month: { input: input * 30.4, uncached: uncached * 30.4, cached: cached * 30.4, output: output * 30.4 } };
}
function apiMonthly(p, t = tokens()) { return (t.month.uncached * p.inPerM + t.month.cached * p.cachedPerM + t.month.output * p.outPerM) / 1e6; }

/* ---------- sizing ---------- */
function sizing(cfg = S.calc) {
  const m = modelById(cfg.model), q = quantById(cfg.quant);
  const params = m.totalB + (cfg.offload ? 0 : m.extraB || 0);
  const useFile = cfg.quant === "q4" && m.fileGB && !m.extraB;
  const weights = useFile ? m.fileGB : (params * q.bitsPerParam) / 8; // GB
  const kv = (m.kvKBperTok * 1024 * cfg.ctxK * 1000 * cfg.conc) / 1e9 * (cfg.kv8 ? 0.5 : 1);
  const overhead = 1.5 + 0.05 * weights;
  const total = weights + kv + overhead;
  const rows = R.hardware.map((h) => {
    const use = h.usableGB;
    const status = total <= use * 0.9 ? "fits" : total <= use ? "tight" : "no";
    const bench = R.benchmarks.filter((b) => b.hw === h.id && b.model === m.id && b.decode != null);
    const single = bench.filter((b) => !b.aggregate && !b.estimate);
    const agg = bench.filter((b) => b.aggregate);
    const estb = bench.filter((b) => b.estimate);
    const ceiling = h.bandwidthGBs ? h.bandwidthGBs / ((m.activeB * q.bitsPerParam) / 8) : null;
    return { h, status, single, agg, estb, ceiling };
  });
  return { m, q, weights, kv, overhead, total, rows, useFile };
}
function bestDecode(r) { if (r.single.length) return { v: Math.max(...r.single.map((b) => b.decode)), kind: "m", b: r.single.reduce((a, b) => (b.decode > a.decode ? b : a)) }; if (r.estb.length) return { v: r.estb[0].decode, kind: "e", b: r.estb[0] }; return r.ceiling ? { v: r.ceiling, kind: "c" } : null; }

/* ---------- small SVG chart helpers ---------- */
function barChart(vals, labels, { w = 900, h = 170, color = "#7dd3fc", hl = null, fmtv = (v) => fmt(v) } = {}) {
  const max = Math.max(...vals, 1), bw = w / vals.length;
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h + 22}" preserveAspectRatio="none">`;
  vals.forEach((v, i) => {
    const bh = (v / max) * (h - 14), x = i * bw + 2, y = h - bh;
    s += `<rect x="${x}" y="${y}" width="${bw - 4}" height="${bh}" rx="3" fill="${hl && hl(i) ? "#a78bfa" : color}" opacity="${v ? 0.95 : 0.25}"><title>${esc(labels[i])}: ${fmtv(v)}</title></rect>`;
    if (labels.length <= 31 || i % 2 === 0) s += `<text x="${x + (bw - 4) / 2}" y="${h + 15}" fill="#93a0c0" font-size="10" text-anchor="middle">${esc(labels[i])}</text>`;
  });
  return s + "</svg>";
}
function lineChart(series, { w = 900, h = 240, months = 36, breakEven = null } = {}) {
  const all = series.flatMap((s) => s.pts), max = Math.max(...all, 1);
  const X = (i) => 40 + (i / months) * (w - 60), Y = (v) => h - 24 - (v / max) * (h - 40);
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}">`;
  for (let k = 0; k <= 4; k++) { const v = (max * k) / 4; s += `<line x1="40" x2="${w - 20}" y1="${Y(v)}" y2="${Y(v)}" stroke="#243252"/><text x="34" y="${Y(v) + 4}" fill="#8fa0c2" font-size="10" text-anchor="end">$${fmt(v / 1000, 1)}k</text>`; }
  for (let mth = 0; mth <= months; mth += 6) s += `<text x="${X(mth)}" y="${h - 6}" fill="#8fa0c2" font-size="10" text-anchor="middle">${mth}mo</text>`;
  if (breakEven != null && breakEven > 0 && breakEven <= months) {
    s += `<line x1="${X(breakEven)}" x2="${X(breakEven)}" y1="16" y2="${h - 24}" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="4 4"/>`;
    s += `<text x="${X(breakEven) + 4}" y="14" fill="#fbbf24" font-size="10" font-weight="700">BE ${fmt(breakEven)} mo</text>`;
  }
  series.forEach((se) => {
    s += `<polyline fill="none" stroke="${se.color}" stroke-width="2.5" stroke-dasharray="${se.dash || ""}" points="${se.pts.map((v, i) => `${X(i)},${Y(v)}`).join(" ")}"/>`;
  });
  s += "</svg>";
  return s + `<div class="flex small" style="gap:18px;margin-top:4px">${series.map((se) => `<span><span class="swatch" style="background:${se.color}"></span>${esc(se.name)}: <b>${usd(se.pts[se.pts.length - 1])}</b> after ${months} mo</span>`).join("")}${breakEven != null && breakEven > 0 ? `<span class="be-callout">Break-even ≈ <b>${fmt(breakEven)}</b> months</span>` : ""}</div>`;
}

/* ---------- bot verdicts (judgment, grounded in the measured profile) ---------- */
const VERDICT = {
  "Boyd Family Times (archive)": ["go", "Batch summarization at 5 AM. Nobody waits on it, so speed barely matters. Heavy shell + calendar/Gmail reads, writes an HTML edition.", "Qwen3.8-27B or Flash-Next", "Medium (family calendar + email)"],
  "Boyd Family Times": ["go", "Same newspaper job, now producing output files daily ~5:16 AM.", "Qwen3.8-27B or Flash-Next", "Medium"],
  "Pods": ["go", "Podcast digest from RSS; summarization only. Local speech-to-text throughput was not researched (unknown).", "Qwen3.6-35B-A3B (fast MoE)", "Low"],
  "Brief": ["go", "Short structured morning brief (~2 min/run) from Calendar/Slack/Gmail. Ideal small-model job.", "Qwen3.6-35B-A3B", "Medium-high (work + family mail)"],
  "Ryan": ["go", "One weekly idea digest (~2 min). Trivial load.", "any 27B+", "Low"],
  "Kelly": ["go", "Barely active (5 steps logged). Trend reading is mostly tool work.", "any 27B+", "Low"],
  "Path": ["go", "Daily drill files for the high-schooler; templated generation.", "Qwen3.8-27B", "Medium (minor's school data)"],
  "Oscar": ["go", "Bills, Kia statement, cash snapshot: short runs (1–7 min) over Drive/Gmail. The most sensitive data in the fleet, so the strongest privacy case.", "Qwen3.8-27B / Flash-Next", "High (finances)"],
  "Jim": ["hy", "Daily podcast brief and interest note are digest work (local-friendly). X and web browsing for the Simmons pick needs reliable tool use and fresh info.", "Flash-Next for digests; cloud for research", "Low-medium"],
  "Char Tutor": ["hy", "Weeknight check-ins are short, but 112 browser steps plus 21 computer-use sessions need a strong vision/agentic model. Minors' data favors local.", "Qwen3.8-27B (VL); verify in harness", "High (minor)"],
  "Vic Tutor": ["hy", "Same pattern as Char: browser and computer-use heavy, kid-facing.", "Qwen3.8-27B (VL); verify in harness", "High (minor)"],
  "Pam": ["hy", "Calendar scan is local-friendly. Gmail (Miranda) triage plus computer use (~90 s sessions) is harder.", "Flash-Next + cloud fallback", "High (family + spouse mail)"],
  "Dr. EggBot": ["hy", "Healthcheck routines are simple shell checks (local OK). Designing new bots is frontier-model judgment.", "local for checks; cloud for design", "Low"],
  "Michael": ["no", "Chief of staff: 948 steps, 169 chats with Boyd, Slack-heavy, coordinates other bots. Orchestration and judgment are where frontier models still lead. Could hand subtasks to local helpers.", "Cloud frontier (+ local subagents)", "High"],
  "Dwight": ["no", "Agentic coding. Cloud frontier models plus Cursor's harness are the point; local coding works but is slower and weaker (MacStories).", "Cloud (Cursor Ultra)", "Low"],
  "TokenMax": ["no", "Big builds like this one: long agentic sessions that exist to use included cloud usage.", "Cloud", "Low"],
};

/* ---------- render ---------- */
function render() {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === S.tab));
  const f = { overview, workload, sizing: sizingView, hardware, cost, matrix, kpd, sources }[S.tab] || overview;
  $("#app").innerHTML = f();
  weekStrip();
  bind();
  animateKpis($("#app"));
  $("#foot").innerHTML = `Fleet data derived ${esc(W.generatedAt)} ET from Bot Island (read-only) · research as of ${esc(R.researchedAt)} (Oct 2026 citations on disk; remaster Sat Oct 10 did not invent benchmarks) · TokenMax · nothing here is purchase advice; verify prices before buying.`;
}

function overview() {
  const m = W.measured, rs = W.routineSummary, t = tokens();
  const flash = R.apiPrices[0], grok = R.apiPrices.find((p) => p.model.startsWith("Grok"));
  const apiFlash = apiMonthly(flash), apiGrok = apiMonthly(grok);
  const spark = hwById("spark"), strix = hwById("strix"), m5 = hwById("m5ultra256");
  const be = (price) => price / (200 - 60);
  const used = W.usage && W.usage.used_pct != null ? `${W.usage.used_pct}%` : "see This week strip";
  return `
  <section class="hero">
    <div class="card">
      <div class="mut small">MISSION BRIEF · THE SHORT ANSWER</div>
      <div class="verdict">Yes, <em>most of the fleet could run on one box under your desk</em>, but it won't save money. Buy one for privacy, control and learning. Don't buy one to cut the $200/mo plan.</div>
      <p class="mut" style="margin:0 0 10px">Your 16 bots made about <b>${fmt(m.stepsPerDayMean)}</b> agent steps a day ${T.m}, with at most ${m.maxConcurrentBots10min} bots active in the same 10 minutes and 2 routines overlapping. That's a light load: a 128 GB box running a mixture-of-experts model handles it with room to spare. The cost case is weak, though. At open-weight API prices the same work would cost about <b>${usd(apiFlash, 0)}/mo</b> ${T.e}, and you're using about ${used} of your Grok Bot weekly allowance ${T.m}. The orchestration and coding bots also still need frontier models.</p>
      <div class="grid g4">
        <div class="kpi"><div class="v" data-count="${m.stepsPerDayMean}" data-decimals="1">0</div><div class="l">agent steps/day (mean) ${T.m}<br>median ${fmt(m.stepsPerDayMedian)} · peak ${fmt(m.stepsPerDayMax)}</div></div>
        <div class="kpi"><div class="v" data-count="${rs.runsPerDay}" data-decimals="1">0</div><div class="l">scheduled runs/day ${T.m}<br>${rs.enabled} routines · ${fmt(rs.routineMinutesPerWeek / 7)} min/day</div></div>
        <div class="kpi"><div class="v">${m.peakHourET > 12 ? m.peakHourET - 12 + " PM" : m.peakHourET + " AM"}</div><div class="l">busiest hour (ET) ${T.m}<br>also 5 AM (newspaper) and 8 PM</div></div>
        <div class="kpi"><div class="v" data-count="${Math.round(t.month.input / 1e6)}">0</div><div class="l">~M input tokens/month ${T.e}<br>no token counts are logged locally</div></div>
      </div>
    </div>
    <div class="card">
      <h3>What people you bookmarked say</h3>
      ${R.quotes.map((q) => `<div class="quote">“${esc(q.text)}”<div class="who">${esc(q.who)} ${src(q.src)}</div></div>`).join("")}
    </div>
  </section>
  <div class="section-title"><h2>Headline recommendations</h2><span class="mut small">prices and speeds are sourced; break-even uses the Pro+ downgrade scenario</span></div>
  <div class="recs">
    <div class="rec"><b>Don't buy hardware to save money</b><p>Your plan has lots of unused room (you have used ${used} of your weekly Grok Bot usage). Even the cheapest capable box (${usd(strix.priceUSD)}) only breaks even after ~${fmt(be(strix.priceUSD))} months, and only if you drop Ultra to Pro+ ($60) and give up frontier headroom. ${src(strix.priceSrc)}</p></div>
    <div class="rec"><b>If you buy, get 128 GB of unified memory and run MoE models</b><p>Strix Halo (${usd(strix.priceUSD)}) does 55.6 tok/s on gpt-oss-120b ${src("specpicks_strix")}. DGX Spark (${usd(spark.priceUSD)}) does ~60 tok/s single-stream and 2,621 tok/s across 128 parallel requests ${src("certant_spark")}, and it's CUDA, so it doubles as a KPD pilot server.</p></div>
    <div class="rec"><b>Want the Viticci setup? M5 Ultra 256 GB + Qwen3.8-Flash-Next</b><p>${usd(m5.priceUSD)}: 108 tok/s, 2,887 tok/s prompt reading at 16K, and 3 concurrent sessions at 81.5 tok/s combined ${src("macstories")}. It's the only quiet box here that runs a 125B model at 4–5 bit in memory.</p></div>
    <div class="rec"><b>Move the digests first. Keep coding and orchestration in the cloud.</b><p>Family Times, Pods, Brief, Ryan, Path and Oscar are batch jobs where nobody's waiting, so they're the easy local wins. Michael, Dwight and TokenMax stay on frontier models. Tutors and Pam are hybrid. See the matrix.</p></div>
    <div class="rec"><b>KPD: pilot on-prem for confidential documents, but local isn't automatically compliant</b><p>ABA Formal Opinion 512 requires judging confidentiality risk and getting informed consent before client data goes into self-learning tools. Running on-prem removes vendor retention, but matter walls and access control are still on you. ${src("aba512", "ABA Op. 512")}</p></div>
  </div>
  <div class="grid g2">
    <div class="card"><h3>Agent steps per day ${T.m}</h3><div class="mut small">Logged tool calls, shell commands, page loads and computer-use sessions, ${esc(W.window.start)} → ${esc(W.window.end)} (the span with per-tool audit logs).</div>
      ${barChart(m.daily.map((d) => d.steps), m.daily.map((d) => d.date.slice(5)), { h: 150 })}</div>
    <div class="card"><h3>When the fleet works (ET, hour of day) ${T.m}</h3><div class="mut small">Total steps per hour over the window. 5 AM newspaper, 7–8 AM briefs and finances, 8 PM interest notes.</div>
      ${barChart(m.byHourET, [...Array(24).keys()].map((h) => (h % 12 || 12) + (h < 12 ? "a" : "p")), { h: 150, hl: (i) => i === m.peakHourET })}</div>
  </div>
  <div class="section-title"><h2>Three builds that fit this fleet, plus one to skip</h2>${T.s}</div>
  <div class="grid g4">
    ${[["Budget privacy box", "strix", "gpt-oss-120b (55.6 tok/s) or Qwen3.6-35B-A3B (62.6 tok/s), llama.cpp Vulkan", "specpicks_strix", "Runs every \"go local\" bot. Slow on dense 27B+ models (Qwen 32B ~8–12 tok/s)."],
       ["Sweet spot + KPD pilot", "spark", "Qwen3.6-35B-A3B NVFP4 (120 tok/s), gpt-oss-120b (~60 tok/s), vLLM", "certant_spark", "Batching turns it into a shared server (862–2,621 tok/s aggregate). CUDA, so the same stack as a firm deployment."],
       ["Dream desk box", "m5ultra256", "Qwen3.8-Flash-Next oQ4e (108 tok/s; 60–84 tok/s at 64–128K)", "macstories", "Quiet. Runs the strongest open model here at long context, with 3 sessions in parallel."],
       ["Skip for now", "rtx5090", "Qwen3.8-27B Q4 at 59 tok/s, the fastest single stream", "macstories", "The card alone costs ~$4.3k on the street (MSRP $1,999), and 32 GB caps model size. Spilling to RAM drops to 4.6 tok/s."]]
      .map(([t, id, mdl, sid, why]) => { const h = hwById(id); return `<div class="card"><div class="mut tiny">${esc(t).toUpperCase()}</div><div class="flex"><b><span class="swatch" style="background:${h.color}"></span>${esc(h.short)}</b><span class="right big" style="font-size:22px">${usd(h.priceUSD)}</span></div><div class="small" style="margin:6px 0">${esc(mdl)} ${src(sid)}</div><div class="small mut">${esc(why)}</div><div class="tiny mut" style="margin-top:4px">price ${src(h.priceSrc)}</div></div>`; }).join("")}
  </div>`;
}

function workload() {
  const m = W.measured, rs = W.routineSummary, t = tokens();
  const heatMax = Math.max(...m.byDowHourET.flat(), 1), days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const heat = `<div class="heat"><div></div>${[...Array(24).keys()].map((h) => `<div style="text-align:center">${h % 3 === 0 ? h : ""}</div>`).join("")}${m.byDowHourET.map((row, d) => `<div>${days[d]}</div>${row.map((v) => `<div class="c" title="${days[d]} ${v} steps" style="background:rgba(125,211,252,${v ? 0.12 + 0.88 * Math.sqrt(v / heatMax) : 0.04})"></div>`).join("")}`).join("")}</div>`;
  return `
  <div class="grid g2">
    <div class="card"><h3>Weekday × hour heatmap ${T.m}</h3>${heat}<div class="mut tiny" style="margin-top:6px">${fmt(m.stepsInWindow)} steps in ${W.window.days} days. Median tool-call latency ${fmt(m.toolLatencyMsMedian)} ms. Busiest single minute: ${m.peakMinuteSteps} steps (${esc(m.peakMinute)} ET). Most 10-minute windows have one bot working; the max was ${m.maxConcurrentBots10min} at once.</div>
      <h3 style="margin-top:14px">Steps per day ${T.m}</h3>${barChart(m.daily.map((d) => d.steps), m.daily.map((d) => d.date.slice(5)), { h: 110 })}
      <div class="mut tiny">By type: ${m.byType.map(([k, v]) => `${esc(k.replace(/_/g, " "))} ${fmt(v)}`).join(" · ")}</div></div>
    <div class="card"><h3>Token estimate ${T.e}</h3>
      <div class="note">No token counts are logged locally. These sliders turn <b>measured step counts</b> into token estimates. Each step is roughly one model call that re-reads the agent's context (system prompt, tools, memory, history). Change the assumptions and every tab updates.</div>
      <div class="controls" style="margin-top:10px">
        <label class="ctl">Step basis <select data-k="est.basis">${["mean", "median", "p90", "max"].map((v) => `<option ${S.est.basis === v ? "selected" : ""}>${v}</option>`).join("")}</select><span>${fmt(stepsPerDay())} steps/day ${T.m}</span></label>
        <label class="ctl">Context per call <b>${fmt(S.est.ctx)} tok</b><input type="range" min="2000" max="128000" step="1000" value="${S.est.ctx}" data-k="est.ctx"></label>
        <label class="ctl">Output per call <b>${fmt(S.est.out)} tok</b><input type="range" min="50" max="3000" step="50" value="${S.est.out}" data-k="est.out"></label>
        <label class="ctl">Prefix-cache hit <b>${S.est.cache}%</b><input type="range" min="0" max="95" step="5" value="${S.est.cache}" data-k="est.cache"></label>
        <label class="ctl">Model calls per step <b>${S.est.calls}</b><input type="range" min="1" max="3" step="0.1" value="${S.est.calls}" data-k="est.calls"></label>
      </div>
      <div class="grid g4" style="margin-top:12px">
        <div class="kpi"><div class="v" data-count="${Math.round(t.calls)}">0</div><div class="l">model calls/day ${T.e}</div></div>
        <div class="kpi"><div class="v" data-count="${t.input / 1e6}" data-decimals="1">0</div><div class="l">M input tok/day (${fmt(t.uncached / 1e6, 2)}M uncached) ${T.e}</div></div>
        <div class="kpi"><div class="v" data-count="${Math.round(t.output / 1e3)}">0</div><div class="l">k output tok/day ${T.e}</div></div>
        <div class="kpi"><div class="v" data-count="${Math.round(t.month.input / 1e6)}">0</div><div class="l">M input tok/month ${T.e}</div></div>
      </div>
    </div>
  </div>
  <div class="section-title"><h2>Per-bot activity</h2>${T.m}</div>
  <div class="card"><table><thead><tr><th>Bot</th><th>Role</th><th class="num">Steps (window)</th><th class="num">Steps / active day</th><th class="num">Runs / week</th><th class="num">Routine min / week</th><th>Top tools</th><th class="num">Peak hour</th></tr></thead><tbody>
  ${W.bots.map((b) => `<tr><td><b>${esc(b.name)}</b></td><td class="mut">${esc(b.title)}</td><td class="num">${fmt(b.stepsInWindow)}</td><td class="num">${fmt(b.stepsPerActiveDay, 1)}</td><td class="num">${b.runsPerWeek || "—"}</td><td class="num">${b.routineMinutesPerWeek || "—"}</td><td class="small">${b.topApps.slice(0, 4).map(([a, n]) => `${esc(a)} ${n}`).join(" · ") || '<span class="mut">output files only (after audit window)</span>'}</td><td class="num">${b.peakHourET == null ? "—" : (b.peakHourET % 12 || 12) + (b.peakHourET < 12 ? " AM" : " PM")}</td></tr>`).join("")}
  </tbody></table></div>
  <div class="section-title"><h2>Routine schedules</h2>${T.m}<span class="mut small">median/p90 run length from logged runs · ${rs.overlapCount} cross-bot overlaps observed, max ${rs.peakOverlappingRuns} at once</span></div>
  <div class="card"><table><thead><tr><th>Bot</th><th>Routine</th><th>Schedule</th><th class="num">Runs/wk</th><th class="num">Observed runs</th><th class="num">Median min</th><th class="num">p90 min</th></tr></thead><tbody>
  ${W.routines.filter((r) => r.enabled).sort((a, b) => a.cron.split(" ")[1] - b.cron.split(" ")[1]).map((r) => `<tr><td>${esc(r.bot)}</td><td>${esc(r.name)}</td><td class="mut">${esc(r.schedule)}</td><td class="num">${r.runsPerWeek}</td><td class="num">${r.observedRuns} (${r.okRuns} ok)</td><td class="num">${fmt(r.medianMinutes, 1)}</td><td class="num">${fmt(r.p90Minutes, 1)}</td></tr>`).join("")}
  </tbody></table><div class="mut tiny" style="margin-top:6px">Overlaps: ${rs.overlapExamples.map(esc).join(" · ")}</div></div>`;
}

function sizingView() {
  const z = sizing(), t = tokens(), c = S.calc;
  const peakHourSteps = Math.max(...W.measured.byHourET) / W.window.days * S.est.calls;
  const rows = z.rows.map((r) => {
    const pct = Math.min(100, (z.total / r.h.usableGB) * 100);
    const d = bestDecode(r);
    const pre = r.single.find((b) => b.prefill)?.prefill;
    const busyMin = d && d.kind === "m" && r.status !== "no" ? (t.output / d.v + (pre ? t.uncached / pre : 0)) / 60 : null;
    const col = r.status === "fits" ? "#34d399" : r.status === "tight" ? "#fbbf24" : "#f87171";
    const dTxt = !d ? `${T.u}` : d.kind === "m" ? `<b>${fmt(d.v, 1)}</b> tok/s ${T.bench} ${src(d.b.src)}` : d.kind === "e" ? `~${fmt(d.v)} tok/s ${T.e} ${src(d.b.src)}` : `≤${fmt(d.v)} tok/s <span class="tag u">CEILING</span>`;
    const agg = r.agg.length ? `<div class="tiny mut">${r.agg.map((a) => `${fmt(a.decode)} tok/s aggregate @${a.concurrency} concurrent ${src(a.src)}`).join("<br>")}</div>` : "";
    return `<div class="fit"><div class="name"><span class="swatch" style="background:${r.h.color}"></span>${esc(r.h.short)}<div class="tiny mut">${r.h.usableGB} GB usable · ${usd(r.h.priceUSD)}</div></div>
      <div><div class="meter"><i style="width:${pct}%;background:${col}"></i><span>${fmt(z.total)} / ${r.h.usableGB} GB</span></div><div class="tiny" style="margin-top:3px">${dTxt}${agg}</div></div>
      <div class="res ${r.status === "fits" ? "ok" : r.status === "tight" ? "warn" : "bad"}"><b>${r.status === "fits" ? "Fits" : r.status === "tight" ? "Tight" : "Doesn't fit"}</b><div class="tiny mut">${busyMin != null ? `fleet day ≈ ${fmt(busyMin)} busy min` : r.status !== "no" ? "no benchmark for this model" : ""}</div></div></div>`;
  }).join("");
  const fits = z.rows.filter((r) => r.status !== "no").sort((a, b) => a.h.priceUSD - b.h.priceUSD);
  const presets = [
    { id: "digest", label: "Digest bot", model: "q36_35b", quant: "q4", ctxK: 16, conc: 2, kv8: false, offload: false },
    { id: "fleet", label: "Fleet peak", model: "q38_flashnext", quant: "q4", ctxK: 32, conc: Math.max(4, W.measured.maxConcurrentBots10min), kv8: false, offload: false },
    { id: "long", label: "Long context", model: "q38_flashnext", quant: "q4", ctxK: 128, conc: 1, kv8: true, offload: true },
    { id: "big", label: "gpt-oss-120b", model: "gptoss120", quant: "q4", ctxK: 32, conc: 2, kv8: false, offload: false },
  ];
  return `
  <div class="card"><h3>Pick a model, quantization, context and concurrency</h3>
    <div class="presets">${presets.map((p) => `<button type="button" data-preset="${p.id}" class="${c.model===p.model && c.ctxK===p.ctxK && c.conc===p.conc ? "on" : ""}">${esc(p.label)}</button>`).join("")}</div>
    <div class="mut tiny" style="margin-bottom:8px">Presets set model/quant/context/concurrency from measured fleet concurrency (max ${W.measured.maxConcurrentBots10min} bots / 10 min) ${T.m}. Adjust sliders after.</div>
    <div class="controls">
      <label class="ctl">Model<select data-k="calc.model">${R.models.map((m) => `<option value="${m.id}" ${c.model === m.id ? "selected" : ""}>${esc(m.name)}: ${m.activeB === m.totalB ? m.totalB + "B dense" : m.totalB + "B MoE / " + m.activeB + "B active"}</option>`).join("")}</select></label>
      <label class="ctl">Quantization<select data-k="calc.quant">${R.quants.map((q) => `<option value="${q.id}" ${c.quant === q.id ? "selected" : ""}>${esc(q.label)}</option>`).join("")}</select></label>
      <label class="ctl">Context per session <b>${c.ctxK}K tokens</b><input type="range" min="4" max="256" step="4" value="${c.ctxK}" data-k="calc.ctxK"></label>
      <label class="ctl">Concurrent sessions <b>${c.conc}</b> <span class="tiny">measured fleet max: ${W.measured.maxConcurrentBots10min} bots / 10 min</span><input type="range" min="1" max="16" step="1" value="${c.conc}" data-k="calc.conc"></label>
    </div>
    <label class="small mut" style="display:block;margin-top:8px"><input type="checkbox" data-k="calc.kv8" ${c.kv8 ? "checked" : ""}> 8-bit KV cache (halves KV memory; MacStories used this to fit 256K on the 5090)</label>
    ${z.m.extraB ? `<label class="small mut" style="display:block;margin-top:4px"><input type="checkbox" data-k="calc.offload" ${c.offload ? "checked" : ""}> Offload the ${z.m.extraB}B n-gram embedding tables to host RAM/SSD (Qwen: the table "can be offloaded to host memory" ${src("qwen38_flashnext")}; the RTX PRO 6000 runs did this ${src("llamaperf_pro6000")}; MacStories ran 6/8-bit with tables on SSD ${src("macstories")})</label>` : ""}
  </div>
  <div class="grid g4" style="margin:14px 0">
    <div class="kpi"><div class="v" data-count="${z.weights}" data-decimals="1">0</div><div class="l">GB weights ${z.useFile ? T.s + " " + src(z.m.src) : T.e}${z.m.extraB ? (c.offload ? `<br>${z.m.extraB}B n-gram tables offloaded` : `<br>incl. ${z.m.extraB}B n-gram tables`) : ""}</div></div>
    <div class="kpi"><div class="v" data-count="${z.kv}" data-decimals="1">0</div><div class="l">GB KV cache: ${c.ctxK}K × ${c.conc} sessions × ${z.m.kvKBperTok} KB/token ${T.e}</div></div>
    <div class="kpi"><div class="v" data-count="${z.overhead}" data-decimals="1">0</div><div class="l">GB runtime overhead (1.5 GB + 5%) ${T.e}</div></div>
    <div class="kpi" style="border-color:#67e8f955"><div class="v" data-count="${z.total}" data-decimals="1">0</div><div class="l">GB total memory needed ${T.e}${z.m.measuredFootprintGB ? `<br>cited footprint: oQ4e peaked at ${z.m.measuredFootprintGB["4-bit"]} GB on M5 Ultra ${src(z.m.footprintSrc)}` : ""}</div></div>
  </div>
  <div class="grid" style="grid-template-columns:2fr 1fr">
    <div class="card"><h3>Does it fit, and how fast is it? <span class="mut small">· decode tok/s for ${esc(z.m.name)} (benchmark where one exists, otherwise bandwidth ÷ active-weight bytes as a ceiling)</span></h3>${rows}
      <div class="mut tiny" style="margin-top:8px">"Fleet day" = today's estimated output tokens ÷ decode speed, plus uncached input ÷ prompt-reading speed when measured (${fmt(t.output / 1000)}k out, ${fmt(t.uncached / 1e6, 2)}M uncached in, from the Workload sliders). Benchmarks may use a different quant or engine than you picked; hover the source. KV note: ${esc(z.m.kvNote)}</div></div>
    <div class="card"><h3>Candidate builds for this config</h3>
      ${fits.length ? fits.map((r, i) => { const d = bestDecode(r); return `<div style="padding:8px 0;border-bottom:1px dashed var(--line)"><div class="flex"><b>${i + 1}. ${esc(r.h.short)}</b><span class="right">${usd(r.h.priceUSD)}</span></div><div class="tiny mut">${esc(r.h.priceNote)} ${src(r.h.priceSrc)}</div><div class="small">${d ? (d.kind === "m" ? `${fmt(d.v, 1)} tok/s measured` : d.kind === "e" ? `~${fmt(d.v)} tok/s estimated` : `≤${fmt(d.v)} tok/s ceiling, no benchmark`) : "speed unknown"} · ${r.status}</div></div>`; }).join("") : '<div class="bad">Nothing in the catalog fits. Lower the quant, context or concurrency.</div>'}
      <div class="note" style="margin-top:10px">Peak-hour load ${T.m}: about ${fmt(peakHourSteps, 1)} model calls in the busiest hour on an average day. At ${S.est.ctx / 1000}K context with ${S.est.cache}% cache hits, any box here that fits the model clears that hour in minutes. Capacity isn't the problem; model quality is.</div>
    </div>
  </div>`;
}

function hardware() {
  return `
  <div class="grid g3">${R.hardware.map((h) => `<div class="card hwcard"><div class="flex"><span class="swatch" style="background:${h.color}"></span><b>${esc(h.name)}</b></div>
    <div class="price">${usd(h.priceUSD)} <span class="tag s">SOURCED</span></div><div class="tiny mut">${esc(h.priceNote)} ${src(h.priceSrc)}</div>
    <div class="spec"><span>${h.memoryGB} GB ${esc(h.family.includes("unified") ? "unified" : "VRAM")}</span><span>${h.bandwidthGBs ? fmt(h.bandwidthGBs) + " GB/s" : '<span class="tag u">BW UNKNOWN</span>'}${h.bandwidthSrc ? " " + src(h.bandwidthSrc) : ""}</span><span>${h.watts ? h.watts + " W " + src(h.wattsSrc) : '<span class="tag u">POWER UNKNOWN</span>'}</span></div>
    <div class="small">${esc(h.notes)}</div><div class="tiny mut">Engine: ${esc(h.engine)} · usable for models ≈ ${h.usableGB} GB (${esc(h.usableNote)})</div></div>`).join("")}</div>
  <div class="note" style="margin-bottom:12px">Hardware prices and benchmarks below are <b>Oct 2026 research already on disk</b> in <code>data/research.json</code> (researched ${esc(R.researchedAt)}). This remaster did not invent or refresh public prices/specs. Gaps stay ${T.u} rather than fabricated.</div>
  <div class="section-title"><h2>Benchmarks</h2>${T.s}<span class="mut small">single-request decode unless marked aggregate. Cited quotes, not TokenMax measurements.</span></div>
  <div class="card"><table><thead><tr><th>Hardware</th><th>Model</th><th>Quant</th><th>Engine</th><th>Context</th><th class="num">Decode tok/s</th><th class="num">Prefill tok/s</th><th>Notes</th><th>Source</th></tr></thead><tbody>
  ${R.benchmarks.map((b) => `<tr><td>${esc(hwById(b.hw).short)}</td><td>${esc(modelById(b.model).name)}</td><td class="small">${esc(b.quant)}</td><td class="small mut">${esc(b.engine)}</td><td class="small">${esc(b.ctx)}</td><td class="num">${b.decode == null ? T.u : `<b>${fmt(b.decode, 1)}</b>${b.aggregate ? ' <span class="tiny mut">aggregate</span>' : ""}${b.estimate ? " " + T.e : ""}`}</td><td class="num">${b.prefill ? fmt(b.prefill) : '<span class="mut">n/r</span>'}</td><td class="small mut">${esc(b.note)}</td><td>${src(b.src)}</td></tr>`).join("")}
  </tbody></table>
  <div class="mut tiny" style="margin-top:8px">n/r = not reported by the source. Bonsai 27B, used RTX 4090, M5 Ultra 96 GB and Strix Halo power draw have no reliable 2026 numbers in the sources read, so they're shown as unknown. Rule of thumb from @TheAhmadOsman's guide ${src("ahmad_bible")}: <i>VRAM determines fit, bandwidth determines decode speed, compute determines prefill.</i></div></div>
  <div class="section-title"><h2>Models</h2></div>
  <div class="card"><table><thead><tr><th>Model</th><th>Maker / license</th><th>Size</th><th>Architecture</th><th class="num">Context</th><th>Good for</th><th>Source</th></tr></thead><tbody>
  ${R.models.map((m) => `<tr><td><b>${esc(m.name)}</b></td><td class="small">${esc(m.maker)} · ${esc(m.license)}</td><td class="small">${m.totalB}B${m.activeB !== m.totalB ? ` / ${m.activeB}B active` : ""}${m.extraB ? ` + ${m.extraB}B n-gram` : ""}${m.fileGB ? `<div class="tiny mut">file ≈ ${m.fileGB} GB${m.fileNote ? " (" + esc(m.fileNote) + ")" : ""}</div>` : ""}</td><td class="small mut">${esc(m.arch)}</td><td class="num">${m.ctxK}K</td><td class="small">${esc(m.good)}${m.quality ? `<div class="tiny mut">${esc(m.quality)}</div>` : ""}</td><td>${src(m.src)}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function costModel() {
  const c = S.cost, h = hwById(c.hw), cents = c.cents ?? R.electricity.centsPerKWh;
  const planUSD = { keep: 200, "pro+": 60, pro: 20, none: 0 }[c.plan];
  const capex = h.priceUSD + Number(c.hostUSD || 0);
  const watts = h.watts;
  const kwhMonth = ((watts || 0) * c.busyH + c.idleW * (24 - c.busyH)) * 30.4 / 1000;
  const power = (kwhMonth * cents) / 100;
  const saving = 200 - planUSD - power;
  const beMonths = saving > 0 ? capex / saving : null;
  const flash = apiMonthly(R.apiPrices[0]);
  const N = c.months, pts = (f) => [...Array(N + 1).keys()].map(f);
  return { h, cents, planUSD, capex, power, kwhMonth, saving, beMonths, flash, watts,
    series: [
      { name: "Status quo: Ultra", color: "#a78bfa", pts: pts((i) => 200 * i) },
      { name: `${h.short} + ${{ keep: "Ultra", "pro+": "Pro+", pro: "Pro", none: "no plan" }[c.plan]}`, color: "#34d399", pts: pts((i) => capex + (planUSD + power) * i) },
      { name: `Pro+ + hosted Flash API`, color: "#fbbf24", dash: "6 5", pts: pts((i) => (60 + flash) * i) },
    ] };
}
function cost() {
  const c = S.cost, k = costModel(), t = tokens();
  return `
  <div class="note"><b>Be honest about what $200/mo buys.</b> Cursor Ultra ${src("cursor_pricing")} covers two monthly pools: Cursor Models (Grok 4.7 and others) and third-party frontier models at API price ${src("cursor_models")}. Your dashboard also shows the Grok Bot weekly pool your bots run on, which is ${W.usage ? W.usage.used_pct + "% used" : "lightly used"} this week ${T.m}. A local box can take over <i>routine</i> work, but it can't stand in for frontier models on coding, orchestration and hard judgment calls. So the realistic saving is a <b>downgrade</b>, not a cancellation. Whether Grok Bot can point a bot at a local model endpoint is ${T.u}. Today, going local means moving those jobs to an open harness (Hermes Agent, OpenClaw and similar) with your own connectors.</div>
  <div class="grid" style="grid-template-columns:1fr 2fr;margin-top:14px">
    <div class="card"><h3>Scenario</h3>
      <div class="grid" style="gap:10px">
        <label class="ctl">Box<select data-k="cost.hw">${R.hardware.map((h) => `<option value="${h.id}" ${c.hw === h.id ? "selected" : ""}>${esc(h.short)}: ${usd(h.priceUSD)}</option>`).join("")}</select></label>
        ${k.h.family.startsWith("Discrete") ? `<label class="ctl">Host PC cost (not priced; your estimate) ${T.u}<input type="number" min="0" step="100" value="${c.hostUSD}" data-k="cost.hostUSD"></label>` : ""}
        <label class="ctl">Cursor plan after going local<select data-k="cost.plan"><option value="keep" ${c.plan === "keep" ? "selected" : ""}>Keep Ultra ($200)</option><option value="pro+" ${c.plan === "pro+" ? "selected" : ""}>Downgrade to Pro+ ($60)</option><option value="pro" ${c.plan === "pro" ? "selected" : ""}>Downgrade to Pro ($20)</option><option value="none" ${c.plan === "none" ? "selected" : ""}>Cancel ($0, unrealistic)</option></select></label>
        <label class="ctl">Busy hours/day at load <b>${c.busyH} h</b> ${T.e}<input type="range" min="0.5" max="24" step="0.5" value="${c.busyH}" data-k="cost.busyH"></label>
        <label class="ctl">Idle draw <b>${c.idleW} W</b> ${T.e}<input type="range" min="0" max="120" step="5" value="${c.idleW}" data-k="cost.idleW"></label>
        <label class="ctl">Electricity ¢/kWh ${src(R.electricity.src, "EIA via Energy Factbook")}<input type="number" step="0.01" value="${k.cents}" data-k="cost.cents"><span class="tiny">${esc(R.electricity.region)}. ${esc(R.electricity.assumption)}</span></label>
      </div></div>
    <div class="card"><h3>Cumulative cost over ${c.months} months</h3>${lineChart(k.series, { months: c.months, breakEven: k.beMonths })}
      <div class="grid g4" style="margin-top:8px">
        <div class="kpi"><div class="v" data-count="${k.capex}">0</div><div class="l">up-front $ ${T.s}</div></div>
        <div class="kpi"><div class="v">${k.watts ? usd(k.power, 2) : T.u}</div><div class="l">power/month (${fmt(k.kwhMonth, 1)} kWh)${k.watts ? "" : " · load watts unknown, idle only"}</div></div>
        <div class="kpi"><div class="v" data-count="${Math.round(k.saving)}">0</div><div class="l">monthly saving vs Ultra ($)</div></div>
        <div class="kpi" style="border-color:${k.beMonths && k.beMonths < 36 ? "#34d39966" : "#f8717166"}"><div class="v">${k.beMonths ? `<span data-count="${Math.round(k.beMonths)}">0</span> mo` : "never"}</div><div class="l">break-even (${k.beMonths ? fmt(k.beMonths / 12, 1) + " yrs" : "saving ≤ 0"})</div></div>
      </div></div>
  </div>
  <div class="section-title"><h2>What the same fleet work would cost on metered APIs</h2>${T.e}<span class="mut small">estimated tokens (Workload sliders) × sourced list prices</span></div>
  <div class="card"><table><thead><tr><th>Model / price list</th><th class="num">$/M input</th><th class="num">$/M cached</th><th class="num">$/M output</th><th class="num">Est. $/month for the fleet</th><th>Source</th></tr></thead><tbody>
    ${R.apiPrices.map((p) => `<tr><td>${esc(p.model)}<div class="tiny mut">${esc(p.note)}</div></td><td class="num">${p.inPerM}</td><td class="num">${p.cachedPerM}</td><td class="num">${p.outPerM}</td><td class="num"><b>${usd(apiMonthly(p, t), 2)}</b></td><td>${src(p.src)}</td></tr>`).join("")}
  </tbody></table>
  <div class="mut tiny" style="margin-top:6px">Based on ${fmt(t.month.input / 1e6)}M input (${fmt(t.month.uncached / 1e6, 1)}M uncached) and ${fmt(t.month.output / 1e6, 2)}M output tokens a month, all estimates. The open-weight API rows are the honest benchmark for local hardware: if your privacy rules allow a hosted API, routine bots cost a few dollars a month there. Local only wins on privacy, control and offline use, not on cost.</div></div>
  <div class="grid g3" style="margin-top:14px">${["strix", "spark", "m5ultra256"].map((id) => { const h = hwById(id), pw = (((h.watts || 0) * 2 + 15 * 22) * 30.4 / 1000) * R.electricity.centsPerKWh / 100, sv = 140 - pw; return `<div class="card"><b>${esc(h.short)}</b> · ${usd(h.priceUSD)}<div class="big">${sv > 0 ? fmt(h.priceUSD / sv) : "∞"} <span class="small mut">months to break even</span></div><div class="tiny mut">Ultra→Pro+ saves $140/mo, minus ~${usd(pw, 2)}/mo power (2 h/day at load, 15 W idle${h.watts ? "" : "; load watts unknown, idle only"}). ${src(h.priceSrc)}</div></div>`; }).join("")}</div>`;
}

function matrix() {
  const byName = Object.fromEntries(W.bots.map((b) => [b.name, b]));
  const order = ["go", "hy", "no"], lab = { go: "Go local", hy: "Hybrid", no: "Keep cloud" };
  const rows = Object.entries(VERDICT).sort((a, b) => order.indexOf(a[1][0]) - order.indexOf(b[1][0]));
  const cnt = (v) => rows.filter((r) => r[1][0] === v).length;
  return `
  <div class="grid g3">
    <div class="kpi"><div class="v ok"><span data-count="${cnt("go")}">0</span> bots</div><div class="l"><span class="pill go">Go local</span> batch digests and short structured jobs where nobody's waiting</div></div>
    <div class="kpi"><div class="v warn"><span data-count="${cnt("hy")}">0</span> bots</div><div class="l"><span class="pill hy">Hybrid</span> local model for the routine part, cloud fallback for browsing, computer use or judgment</div></div>
    <div class="kpi"><div class="v" style="color:#fbcfe8"><span data-count="${cnt("no")}">0</span> bots</div><div class="l"><span class="pill no">Keep cloud</span> orchestration and agentic coding, where frontier models still lead</div></div>
  </div>
  <div class="card" style="margin-top:14px">
  <div class="matrix-legend"><span><span class="pill go">Go local</span> batch / quiet</span><span><span class="pill hy">Hybrid</span> local + cloud fallback</span><span><span class="pill no">Keep cloud</span> frontier / orchestration</span></div>
  <table><thead><tr><th>Bot</th><th>Verdict</th><th class="num">Steps ${T.m}</th><th class="num">Runs/wk ${T.m}</th><th>Interactive load ${T.m}</th><th>Why</th><th>Suggested local model</th><th>Data sensitivity</th></tr></thead><tbody>
  ${rows.map(([name, [v, why, model, sens]]) => { const b = byName[name] || {}; return `<tr class="row-${v}"><td><b>${esc(name)}</b><div class="tiny mut">${esc(b.title || "")}</div></td><td><span class="pill ${v}">${lab[v]}</span></td><td class="num">${b.stepsInWindow ? fmt(b.stepsInWindow) : `<span class="tiny mut">outputs only${b.artifactWrites30d ? ": " + b.artifactWrites30d + " files/30d" : ""}${b.observedRhythm && b.observedRhythm[0] ? ", ~" + ((b.observedRhythm[0].hour % 12) || 12) + ":" + String(b.observedRhythm[0].minute).padStart(2, "0") + (b.observedRhythm[0].hour < 12 ? " AM" : " PM") + " daily" : ""}</span>`}</td><td class="num">${b.runsPerWeek || "—"}</td><td class="small">${b.boydMessages ? b.boydMessages + " msgs from Boyd" : "—"}${b.computerUse ? ` · ${b.computerUse} computer-use` : ""}${b.browser ? ` · ${b.browser} pages` : ""}</td><td class="small">${esc(why)}</td><td class="small">${esc(model)}</td><td class="small">${esc(sens)}</td></tr>`; }).join("")}
  </tbody></table>
  <div class="mut tiny" style="margin-top:8px">Verdicts are TokenMax's judgment, based on the measured profile (tools used, run length, how interactive each bot is) and the sourced model capabilities. Qwen3.8-27B's vendor scores (SWE-bench Pro 61.7, OSWorld-Verified 84.3 ${src("qwen38_27b")}) are self-reported and not checked in your harness. Run any local candidate in shadow mode next to the cloud bot for a week before switching.</div></div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h3>Suggested migration order</h3><ol class="tight small">
      <li><b>Shadow week:</b> run Brief and the Family Times on a local model in parallel. Compare outputs side by side; nothing gets sent.</li>
      <li><b>Privacy wins:</b> Oscar (finances), then Path (school data).</li>
      <li><b>Digests:</b> Pods, Ryan, Kelly, and Jim's podcast brief and interest note.</li>
      <li><b>Hybrid trial:</b> the tutors and Pam, with cloud fallback for computer use.</li>
      <li><b>Leave alone:</b> Michael, Dwight, TokenMax. Maybe give Michael local helper subagents.</li></ol></div>
    <div class="card"><h3>What "local" covers by bot type</h3><ul class="tight small">
      <li>About ${fmt(W.bots.filter((b) => (VERDICT[b.name] || [])[0] === "go").reduce((a, b) => a + b.stepsInWindow, 0) / W.measured.stepsInWindow * 100)}% of logged steps come from "go local" bots ${T.m}. The Family Times archive alone accounts for ${fmt(byName["Boyd Family Times (archive)"]?.stepsInWindow)}.</li>
      <li>"Keep cloud" bots account for ${fmt(W.bots.filter((b) => (VERDICT[b.name] || [])[0] === "no").reduce((a, b) => a + b.stepsInWindow, 0) / W.measured.stepsInWindow * 100)}% of logged steps, mostly Michael. TokenMax and Dwight sessions are under-counted because they ran after the audit window.</li>
      <li>@Da7_Tech's split ${src("da7")}: a local model (Bonsai) for sensitive tasks and cloud for everything else. That's the hybrid pattern this matrix recommends.</li></ul></div>
  </div>`;
}

function kpd() {
  const spark = hwById("spark"), pro = hwById("pro6000");
  return `
  <div class="note">This tab is about <b>internal operations</b> at KPD Law Group (where you're Technology Director). It isn't a product pitch, and nothing here targets other law firms. It's general information, not legal or ethics advice. Confirm with firm counsel and your state bar's guidance.</div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h3>Why on-prem appeals to a law firm</h3><ul class="tight small">
      <li><b>Confidential data stays inside the firm.</b> Prompts and documents never reach a vendor, so vendor retention and training-on-inputs questions go away.</li>
      <li><b>ABA Formal Opinion 512</b> ${src("aba512", "ABA Op. 512, Jul 29 2024")} asks lawyers to assess the risk of disclosing client information, understand a tool's terms, and get <i>informed</i> client consent before putting confidential information into self-learning tools. Boilerplate engagement-letter consent isn't enough ${src("aba512_small", "commentary")}.</li>
      <li><b>Predictable cost:</b> a fixed capex instead of metered tokens. Batch jobs like OCR, summarization and classification can run overnight.</li>
      <li><b>Works offline</b> and inside existing network controls, logging and backups.</li></ul></div>
    <div class="card"><h3>What local doesn't fix</h3><ul class="tight small">
      <li>Running locally <b>doesn't remove</b> confidentiality duties. A shared model, vector index or memory can leak across matters, so you still need matter-level access control and ethical walls ${src("aba512_small", "commentary")}.</li>
      <li>@TheAhmadOsman's guide warns that MLX-LM's server "is not recommended for production," and that serving a team calls for vLLM or SGLang with real security and observability ${src("ahmad_bible")}.</li>
      <li>Open-weight models still trail frontier models on hard reasoning. Keep a human reviewer on anything that goes to a client or the court.</li>
      <li>Someone has to own patching, model updates, backups and monitoring. That's staff time this page doesn't price ${T.u}.</li></ul></div>
  </div>
  <div class="grid g3" style="margin-top:14px">
    <div class="card"><h3>Pilot box: DGX Spark</h3><div class="big">${usd(spark.priceUSD)}</div><div class="small">128 GB, CUDA, ~160 W. Batched serving reaches 862–2,621 tok/s aggregate across many requests ${src("gpuwerk_spark")} ${src("certant_spark")}, so a handful of staff can share it through vLLM. Good for a 60-day pilot.</div></div>
    <div class="card"><h3>Production workstation: RTX PRO 6000</h3><div class="big">${usd(pro.priceUSD)}<span class="small mut"> card only</span></div><div class="small">96 GB ECC with 1.79 TB/s bandwidth. gpt-oss-120b at 163 tok/s ${src("androidhire_pro6000")}. Only worth it once a pilot proves the demand. The price has nearly doubled since launch ${src("engadget_pro6000")}.</div></div>
    <div class="card"><h3>Pilot workflows (internal)</h3><ul class="tight small">
      <li>Summarize and index internal policies and firm knowledge</li><li>OCR and extraction on scanned PDFs (Viticci used olmOCR locally ${src("macstories")})</li><li>Redact or pseudonymize text <i>before</i> it goes to any cloud model</li><li>Draft first-pass internal emails and memos, with a human reviewing</li><li>IT and help-desk triage from ticket text</li></ul></div>
  </div>
  <div class="card" style="margin-top:14px"><h3>60-day pilot checklist</h3><ol class="tight small">
    <li>Write a one-page AI-use policy that maps to Op. 512: which data classes may use which tool, and when consent is needed.</li>
    <li>Pick 2 internal workflows that have no client-facing output at first. Measure time saved and error rate.</li>
    <li>Serve the model with vLLM behind SSO, log every prompt, and isolate it per matter. Don't share memory across matters.</li>
    <li>Compare the same tasks on the local box and on your current cloud tool (with redacted data). Decide on the numbers.</li>
    <li>Budget for operations: patching, model updates and backups (unknown staff cost; estimate it internally).</li></ol></div>`;
}

function sources() {
  return `<div class="card"><table><thead><tr><th>#</th><th>Source</th><th>Kind</th><th>As of</th><th>Used for</th></tr></thead><tbody>
  ${Object.entries(R.sources).map(([id, s], i) => { const used = [...R.hardware.filter((h) => [h.priceSrc, h.wattsSrc, h.bandwidthSrc, h.usableSrc].includes(id)).map((h) => h.short), ...new Set(R.benchmarks.filter((b) => b.src === id).map((b) => hwById(b.hw).short + " bench")), ...R.apiPrices.filter((p) => p.src === id).map((p) => p.model.split(" (")[0] + " price")]; return `<tr><td class="mut">${i + 1}</td><td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>${s.via ? `<div class="tiny mut">via ${esc(s.via)}</div>` : ""}</td><td class="small mut">${esc(s.kind)}</td><td class="small">${esc(s.asOf)}</td><td class="small mut">${esc([...new Set(used)].slice(0, 5).join(", "))}</td></tr>`; }).join("")}
  </tbody></table>
  <div class="mut tiny" style="margin-top:8px">${esc(R.asOfRule || "")} ${esc(R.researchedBy)} Fleet workload: ${esc(W.source)} (Bot Island collector, read-only), window ${esc(W.window.start)} → ${esc(W.window.end)}. ${esc(W.window.note)}</div></div>
  <div class="card" style="margin-top:14px"><h3>Known gaps ${T.u}</h3><ul class="tight small">
    <li>No token counts are logged locally. Every token and $ figure for the fleet is an estimate built on measured step counts.</li>
    <li>Unknown whether Grok Bot can route a bot to a self-hosted model endpoint.</li>
    <li>No 2026 tok/s found for Bonsai 27B, a used RTX 4090 on current models, or the M5 Ultra 96 GB bin. No load power figures for Strix Halo or used GPUs. M5 Ultra 512 GB pricing hasn't been announced.</li>
    <li>KV-cache sizes for the Qwen3.8 hybrid models are derived estimates, since exact attention-layer KV isn't in the sources read.</li>
    <li>Prices are volatile in 2026 (GDDR7 and memory shortage). The RTX 5090 is $1,999 MSRP but ~$4,300 on the street. Check before buying.</li>
    <li>Host-PC cost for the discrete GPUs isn't priced. Staff time for running a local stack isn't priced.</li></ul></div>`;
}

/* ---------- events ---------- */
function setPath(path, val) { const [a, b] = path.split("."); const cur = S[a][b]; S[a][b] = typeof cur === "number" || (cur === null && b === "cents") ? Number(val) : typeof cur === "boolean" ? !!val : val; }
function bind() {
  document.querySelectorAll("[data-k]").forEach((el) => {
    const ev = el.type === "range" ? "input" : "change";
    el.addEventListener(ev, () => { setPath(el.dataset.k, el.type === "checkbox" ? el.checked : el.value); const y = scrollY; render(); scrollTo(0, y); });
  });
  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const map = {
        digest: { model: "q36_35b", quant: "q4", ctxK: 16, conc: 2, kv8: false, offload: false },
        fleet: { model: "q38_flashnext", quant: "q4", ctxK: 32, conc: Math.max(4, W.measured.maxConcurrentBots10min), kv8: false, offload: false },
        long: { model: "q38_flashnext", quant: "q4", ctxK: 128, conc: 1, kv8: true, offload: true },
        big: { model: "gptoss120", quant: "q4", ctxK: 32, conc: 2, kv8: false, offload: false },
      };
      const p = map[btn.dataset.preset];
      if (!p) return;
      Object.assign(S.calc, p);
      const y = scrollY; render(); scrollTo(0, y);
    });
  });
}
document.getElementById("tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.tab = b.dataset.tab; history.replaceState(null, "", "#" + S.tab); render(); scrollTo(0, 0); });
window.addEventListener("hashchange", () => { S.tab = location.hash.slice(1) || "overview"; render(); });

(async function boot() {
  try {
    const d = window.LLM_ADVISOR_SNAPSHOT || (await (await fetch("/api/data")).json());
    W = d.workload; R = d.research;
    const qs = new URLSearchParams(location.search);
    if (qs.get("tab")) S.tab = qs.get("tab");
    if (qs.get("hw")) S.cost.hw = qs.get("hw");
    if (qs.get("model")) S.calc.model = qs.get("model");
    render();
  } catch (err) { $("#app").innerHTML = `<div class="loading bad">Failed to load data: ${esc(err.message)}</div>`; }
})();
