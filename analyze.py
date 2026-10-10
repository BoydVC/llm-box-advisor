#!/usr/bin/env python3
"""Derive Boyd's fleet activity profile from Bot Island's collected data (read-only).

Input : /workspace/tokenmax/bot-island/data/fleet.json  (never modified)
Output: data/workload.json

Everything here is MEASURED from logged metadata (tool calls, routine runs, cron schedules).
No token counts exist locally, so tokens are NOT computed here; the web app estimates them
from these measured counts using clearly labelled, user-adjustable assumptions.
"""
import collections
import datetime as dt
import json
import os
import statistics
import sys
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get("FLEET_JSON", "/workspace/tokenmax/bot-island/data/fleet.json")
ET = ZoneInfo("America/New_York")

# Event types that correspond to "the model decided to do something" (≈ one agent step each).
STEP_TYPES = {"mcp_tool_call", "shell_command", "browser_navigation", "computer_use_session", "file_write"}
DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def parse(ts):
    return dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))


def cron_runs_per_week(cron):
    """Runs/week for simple 5-field crons (minute hour dom month dow) as used by the fleet."""
    m, h, dom, mon, dow = cron.split()

    def count(field, lo, hi):
        if field == "*":
            return hi - lo + 1
        n = 0
        for part in field.split(","):
            if "-" in part:
                a, b = part.split("-")
                n += int(b) - int(a) + 1
            else:
                n += 1
        return n
    per_day = count(m, 0, 59) * count(h, 0, 23)
    days = 7 if dow == "*" else count(dow, 0, 6)
    return per_day * days


def cron_english(cron):
    m, h, dom, mon, dow = cron.split()
    hours = [int(x) for x in h.split(",")] if h != "*" else []
    times = ", ".join(dt.time(hh, int(m)).strftime("%-I:%M %p") for hh in hours) or "hourly"
    days = {"*": "every day", "1-5": "weekdays", "1": "Mondays", "0": "Sundays"}.get(dow, f"dow {dow}")
    return f"{times} ET, {days}"


def main():
    d = json.load(open(SRC))
    bots = {b["id"]: b for b in d["bots"]}
    ev = d["events"]
    steps = [e for e in ev if e["type"] in STEP_TYPES]
    # Audit-log coverage window: the span where per-tool events were logged.
    tool_days = sorted({parse(e["ts"]).astimezone(ET).date() for e in steps if e["type"] != "file_write"})
    # Use the dense window (days with >= 5 logged steps) as the representative period.
    per_day = collections.Counter(parse(e["ts"]).astimezone(ET).date() for e in steps)
    # Window = first dense day .. newest audit-log entry (after that only output files were collected).
    audit_end = parse(d["sources"]["auditNewest"]).astimezone(ET).date()
    dense = sorted(day for day, n in per_day.items() if n >= 5 and day <= audit_end)
    w0, w1 = dense[0], audit_end
    wdays = (w1 - w0).days + 1
    in_win = [e for e in steps if w0 <= parse(e["ts"]).astimezone(ET).date() <= w1]
    daily = [per_day.get(w0 + dt.timedelta(days=i), 0) for i in range(wdays)]

    by_hour = collections.Counter(parse(e["ts"]).astimezone(ET).hour for e in in_win)
    by_dow_hour = collections.Counter((parse(e["ts"]).astimezone(ET).weekday(), parse(e["ts"]).astimezone(ET).hour) for e in in_win)
    by_app = collections.Counter(e.get("app") for e in in_win)
    by_type = collections.Counter(e["type"] for e in in_win)
    ms = [e["ms"] for e in in_win if e.get("ms") and e["type"] == "mcp_tool_call"]
    per_minute = collections.Counter(parse(e["ts"]).astimezone(ET).strftime("%Y-%m-%d %H:%M") for e in in_win)
    # Distinct bots active in the same 10-minute bucket (proxy for concurrent sessions).
    bucket_bots = collections.defaultdict(set)
    for e in in_win:
        t = parse(e["ts"]).astimezone(ET)
        bucket_bots[(t.date(), t.hour, t.minute // 10)].add(e["bot"])
    conc_hist = collections.Counter(len(s) for s in bucket_bots.values())

    # Routine runs: measured durations + overlap (true concurrency of scheduled runs).
    routines, intervals = [], []
    for b in d["bots"]:
        for r in b["routines"]:
            runs = r.get("runs", [])
            durs = [(parse(x["end"]) - parse(x["start"])).total_seconds() / 60 for x in runs if x.get("end")]
            for x in runs:
                if x.get("end"):
                    intervals.append((parse(x["start"]), parse(x["end"]), b["name"], r["name"]))
            routines.append({
                "bot": b["name"], "botId": b["id"], "name": r["name"], "cron": r["cron"],
                "schedule": cron_english(r["cron"]), "enabled": r["enabled"],
                "runsPerWeek": cron_runs_per_week(r["cron"]) if r["enabled"] else 0,
                "observedRuns": len(runs), "okRuns": sum(1 for x in runs if x.get("status") == "ok"),
                "medianMinutes": round(statistics.median(durs), 1) if durs else None,
                "p90Minutes": round(sorted(durs)[int(0.9 * (len(durs) - 1))], 1) if durs else None,
                "firstRun": runs[0]["start"] if runs else None, "lastRun": runs[-1]["start"] if runs else None,
            })
    pts = sorted([(s, 1) for s, e, *_ in intervals] + [(e, -1) for s, e, *_ in intervals])
    cur = peak = 0
    peak_at = None
    for t, k in pts:
        cur += k
        if cur > peak:
            peak, peak_at = cur, t
    overlaps = []
    for i, a in enumerate(intervals):
        for b2 in intervals[i + 1:]:
            if a[0] < b2[1] and b2[0] < a[1] and a[2] != b2[2]:
                overlaps.append(f"{a[2]} · {a[3]} ↔ {b2[2]} · {b2[3]} ({a[0].astimezone(ET):%b %-d %-I:%M %p} ET)")

    bot_rows = []
    for b in d["bots"]:
        be = [e for e in in_win if e["bot"] == b["id"]]
        apps = collections.Counter(e.get("app") for e in be)
        hours = collections.Counter(parse(e["ts"]).astimezone(ET).hour for e in be)
        active_days = len({parse(e["ts"]).astimezone(ET).date() for e in be})
        rr = [r for r in routines if r["botId"] == b["id"]]
        bot_rows.append({
            "id": b["id"], "name": b["name"], "title": b.get("title") or "",
            "stepsInWindow": len(be), "stepsPerActiveDay": round(len(be) / active_days, 1) if active_days else 0,
            "activeDays": active_days, "topApps": apps.most_common(6),
            "peakHourET": hours.most_common(1)[0][0] if hours else None,
            "computerUse": apps.get("Computer use", 0), "browser": apps.get("Browser", 0), "shell": apps.get("Shell", 0),
            "messages": sum(1 for e in ev if e["type"] == "agent_msg" and (e["bot"] == b["id"] or e.get("from") == b["id"])),
            "boydMessages": sum(1 for e in ev if e["type"] == "boyd_msg" and e["bot"] == b["id"]),
            "artifactWrites30d": b.get("artifactWrites30d", 0),
            "observedRhythm": b.get("observedRhythm", []),
            "routines": [r["name"] for r in rr if r["enabled"]],
            "runsPerWeek": sum(r["runsPerWeek"] for r in rr),
            "routineMinutesPerWeek": round(sum((r["medianMinutes"] or 0) * r["runsPerWeek"] for r in rr), 1),
        })
    bot_rows.sort(key=lambda r: -r["stepsInWindow"])

    out = {
        "generatedAt": dt.datetime.now(ET).isoformat(timespec="minutes"),
        "source": SRC, "sourceGeneratedAt": d.get("generatedAt"),
        "botCount": len(d["bots"]),
        "window": {"start": str(w0), "end": str(w1), "days": wdays,
                   "note": "Per-tool audit events were logged densely only in this window; later days only have output files, so they are excluded from rates."},
        "measured": {
            "stepsInWindow": len(in_win),
            "stepsPerDayMean": round(len(in_win) / wdays, 1),
            "stepsPerDayMedian": statistics.median(daily),
            "stepsPerDayP90": sorted(daily)[int(0.9 * (len(daily) - 1))],
            "stepsPerDayMax": max(daily),
            "daily": [{"date": str(w0 + dt.timedelta(days=i)), "steps": n} for i, n in enumerate(daily)],
            "byType": by_type.most_common(), "byApp": by_app.most_common(),
            "byHourET": [by_hour.get(h, 0) for h in range(24)],
            "byDowHourET": [[by_dow_hour.get((dw, h), 0) for h in range(24)] for dw in range(7)],
            "peakHourET": by_hour.most_common(1)[0][0],
            "peakMinuteSteps": per_minute.most_common(1)[0][1],
            "peakMinute": per_minute.most_common(1)[0][0],
            "toolLatencyMsMedian": statistics.median(ms) if ms else None,
            "concurrentBots10minHist": sorted(conc_hist.items()),
            "maxConcurrentBots10min": max(conc_hist) if conc_hist else 0,
            "agentMessages": sum(1 for e in ev if e["type"] == "agent_msg"),
            "boydMessages": sum(1 for e in ev if e["type"] == "boyd_msg"),
        },
        "routines": routines,
        "routineSummary": {
            "enabled": sum(1 for r in routines if r["enabled"]),
            "runsPerWeek": sum(r["runsPerWeek"] for r in routines),
            "runsPerDay": round(sum(r["runsPerWeek"] for r in routines) / 7, 1),
            "routineMinutesPerWeek": round(sum((r["medianMinutes"] or 0) * r["runsPerWeek"] for r in routines), 1),
            "peakOverlappingRuns": peak, "peakOverlapAt": peak_at.astimezone(ET).isoformat(timespec="minutes") if peak_at else None,
            "overlapExamples": overlaps[:8], "overlapCount": len(overlaps),
        },
        "bots": bot_rows,
        "usage": json.load(open("/workspace/tokenmax/usage.json")) if os.path.exists("/workspace/tokenmax/usage.json") else None,
    }
    os.makedirs(os.path.join(HERE, "data"), exist_ok=True)
    path = os.path.join(HERE, "data", "workload.json")
    json.dump(out, open(path, "w"), indent=1, default=str)
    m = out["measured"]; rs = out["routineSummary"]
    print(f"window {w0}..{w1} ({wdays}d): {m['stepsInWindow']} steps, {m['stepsPerDayMean']}/day mean, median {m['stepsPerDayMedian']}, max {m['stepsPerDayMax']}; peak hour {m['peakHourET']}:00 ET")
    print(f"routines enabled {rs['enabled']}, {rs['runsPerDay']} runs/day, {rs['routineMinutesPerWeek']} routine-min/week, peak overlap {rs['peakOverlappingRuns']} at {rs['peakOverlapAt']}")
    print("max concurrent bots in a 10-min bucket:", m["maxConcurrentBots10min"], m["concurrentBots10minHist"])
    for b in bot_rows:
        print(f"  {b['name']:28} steps {b['stepsInWindow']:4} perActiveDay {b['stepsPerActiveDay']:6} runs/wk {b['runsPerWeek']:3} {b['topApps'][:3]}")
    print("wrote", path)


if __name__ == "__main__":
    sys.exit(main())
