#!/usr/bin/env python3
"""Sync Harvey (https://github.com/ethanplusai/harvey) with the Gexart CRM.

  * Prospects Harvey found        -> CRM prospects (source "harvey"), with Harvey's research notes
  * Harvey's conversation events  -> CRM timeline (sent, replies, opt-outs, bounces, meetings),
                                     plus a task + notification for every reply
  * CRM do-not-contact list        -> written to Harvey's config, so an opt-out anywhere stops both

Standard library only. Reads Harvey's database read-only. Run it with Harvey's own Python
(the one in Harvey's .venv) so the optional YAML update can use PyYAML.

  python crm_sync.py --harvey-dir C:\\harvey               one sync
  python crm_sync.py --harvey-dir C:\\harvey --loop 15     every 15 minutes
  python crm_sync.py --harvey-dir C:\\harvey --write-dnc   also update Harvey's do_not_contact

Settings come from flags or environment variables (or a .env file next to this script):
  GEXART_CRM_URL    e.g. https://sales-crm-gexart.tech-gexart.workers.dev
  GEXART_CRM_TOKEN  the Harvey bridge token from CRM -> Autopilot -> Setup (starts with gxd_)
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE_FILE = HERE / ".crm_sync_state.json"
BATCH = 200


def load_dotenv() -> None:
    env = HERE / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


class Crm:
    def __init__(self, url: str, token: str):
        if not url.startswith("https://") and "localhost" not in url and "127.0.0.1" not in url:
            raise SystemExit("The CRM URL must use https://")
        self.base = url.rstrip("/") + "/api/v1/device/harvey"
        self.token = token

    def call(self, method: str, path: str, payload: dict | None = None) -> dict:
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={
            "authorization": f"Bearer {self.token}",
            "content-type": "application/json",
            "user-agent": "gexart-harvey-sync/1.0",
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")[:400]
            raise SystemExit(f"CRM returned {e.code} for {path}: {body}") from None


def connect_ro(db: Path) -> sqlite3.Connection:
    if not db.exists():
        raise SystemExit(f"Harvey database not found at {db}. Pass --harvey-dir (the folder you cloned Harvey into).")
    con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True, timeout=30)
    con.row_factory = sqlite3.Row
    return con


def cols(con: sqlite3.Connection, table: str) -> set[str]:
    return {r["name"] for r in con.execute(f"PRAGMA table_info({table})")}


def iso(v) -> str | None:
    if not v:
        return None
    s = str(v).replace(" ", "T")
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.isoformat()


def read_prospects(con: sqlite3.Connection, since: str | None) -> list[dict]:
    pc = cols(con, "prospects")
    cc = cols(con, "companies")
    pick = lambda alias, have, name: f"{alias}.{name}" if name in have else "''"  # noqa: E731
    sql = f"""
      SELECT p.id, {pick('p', pc, 'first_name')} AS first_name, {pick('p', pc, 'last_name')} AS last_name,
             {pick('p', pc, 'email')} AS email, {pick('p', pc, 'email_verified')} AS email_verified,
             {pick('p', pc, 'phone')} AS phone, {pick('p', pc, 'linkedin_url')} AS linkedin_url,
             {pick('p', pc, 'title')} AS title, {pick('p', pc, 'status')} AS status, {pick('p', pc, 'score')} AS score,
             {pick('p', pc, 'personalization_notes')} AS personalization, {pick('p', pc, 'updated_at')} AS updated_at,
             COALESCE(NULLIF(c.name, ''), {pick('p', pc, 'company')}) AS company_name,
             {pick('c', cc, 'website')} AS website, {pick('c', cc, 'domain')} AS domain,
             COALESCE(NULLIF({pick('c', cc, 'industry')}, ''), {pick('p', pc, 'industry')}) AS industry,
             {pick('c', cc, 'location')} AS location, {pick('c', cc, 'company_size')} AS company_size
      FROM prospects p LEFT JOIN companies c ON c.id = p.company_id
      {"WHERE p.updated_at > ?" if since and "updated_at" in pc else ""}
      ORDER BY {"p.updated_at" if "updated_at" in pc else "p.rowid"}
    """
    rows = con.execute(sql, (since,) if since and "updated_at" in pc else ()).fetchall()
    out = []
    for r in rows:
        name = (r["company_name"] or "").strip()
        if not name:
            continue
        score = r["score"]
        out.append({
            "harvey_id": str(r["id"]),
            "company_name": name,
            "website": r["website"] or None,
            "domain": r["domain"] or None,
            "industry": r["industry"] or None,
            "location": r["location"] or None,
            "company_size": r["company_size"] or None,
            "first_name": r["first_name"] or None,
            "last_name": r["last_name"] or None,
            "title": r["title"] or None,
            "email": (r["email"] or "").strip().lower() or None,
            "email_verified": bool(r["email_verified"]),
            "phone": r["phone"] or None,
            "linkedin_url": r["linkedin_url"] or None,
            "score": max(0, min(100, int(score))) if isinstance(score, (int, float)) else None,
            "personalization": (r["personalization"] or "")[:2000] or None,
            "status": r["status"] or None,
            "_updated_at": r["updated_at"],
        })
    return out


OPT_OUT_STATUSES = {"opted_out", "unsubscribed", "do_not_contact", "dnc"}
BOUNCE_STATUSES = {"bounced", "invalid", "bounce"}


def read_events(con: sqlite3.Connection) -> list[dict]:
    """Turns conversation threads and prospect statuses into idempotent events."""
    events: list[dict] = []
    emails = {str(r["id"]): (r["email"] or "").lower() for r in con.execute("SELECT id, email FROM prospects")}
    for r in con.execute("SELECT id, status FROM prospects"):
        st = (r["status"] or "").lower()
        if st in OPT_OUT_STATUSES or st in BOUNCE_STATUSES:
            events.append({"event_id": f"status:{r['id']}:{st}", "harvey_prospect_id": str(r["id"]),
                           "email": emails.get(str(r["id"])), "type": "opt_out" if st in OPT_OUT_STATUSES else "bounce"})
    if "conversations" not in {t[0] for t in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}:
        return events
    for conv in con.execute("SELECT id, prospect_id, thread_json, intent, stage FROM conversations"):
        try:
            thread = json.loads(conv["thread_json"] or "[]")
        except json.JSONDecodeError:
            continue
        if not isinstance(thread, list):
            continue
        pid = str(conv["prospect_id"] or "")
        for i, m in enumerate(thread):
            if not isinstance(m, dict):
                continue
            who = str(m.get("role") or m.get("direction") or m.get("from_role") or m.get("sender") or "").lower()
            outbound = who in {"harvey", "assistant", "us", "outbound", "out", "sent", "agent", "sender"}
            body = m.get("body") or m.get("content") or m.get("text") or m.get("message") or ""
            events.append({
                "event_id": f"conv:{conv['id']}:{i}",
                "harvey_prospect_id": pid or None,
                "email": emails.get(pid),
                "type": "sent" if outbound else "reply",
                "subject": (m.get("subject") or "")[:300] or None,
                "body": str(body)[:8000] or None,
                "intent": None if outbound else (m.get("intent") or conv["intent"] or None),
                "at": iso(m.get("timestamp") or m.get("at") or m.get("date") or m.get("sent_at") or m.get("created_at")),
            })
        if (conv["stage"] or "").lower() in {"meeting_booked", "meeting", "booked"}:
            events.append({"event_id": f"meeting:{conv['id']}", "harvey_prospect_id": pid or None, "email": emails.get(pid), "type": "meeting"})
    return events


def write_dnc(harvey_dir: Path, values: list[str]) -> str:
    try:
        import yaml  # type: ignore
    except ImportError:
        out = harvey_dir / "data" / "crm_do_not_contact.txt"
        out.write_text("\n".join(values) + "\n", encoding="utf-8")
        return f"PyYAML not available; wrote {len(values)} entries to {out}. Run this script with Harvey's .venv Python to update the config."
    cfg = harvey_dir / "harvey.local.yaml"
    if not cfg.exists():
        cfg = harvey_dir / "harvey.yaml"
    data = yaml.safe_load(cfg.read_text(encoding="utf-8")) or {}
    comp = data.setdefault("compliance", {}) or {}
    data["compliance"] = comp
    current = comp.get("do_not_contact") or []
    if isinstance(current, str):
        current = [x for x in current.replace(",", "\n").splitlines() if x.strip()]
    merged = sorted({*map(str.strip, map(str, current)), *values} - {""})
    if merged == sorted(set(map(str, current))):
        return f"Harvey do_not_contact already up to date ({len(merged)} entries)."
    shutil.copy2(cfg, cfg.with_suffix(cfg.suffix + ".bak"))
    comp["do_not_contact"] = merged
    cfg.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding="utf-8")
    return f"Updated {cfg.name}: {len(merged)} do-not-contact entries (backup: {cfg.name}.bak)."


def sync_once(args) -> None:
    crm = Crm(args.crm_url, args.token)
    state = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}
    con = connect_ro(Path(args.harvey_dir) / "data" / "harvey.db")
    try:
        prospects = read_prospects(con, None if args.full else state.get("prospects_since"))
        events = read_events(con)
    finally:
        con.close()
    created = updated = skipped = 0
    for i in range(0, len(prospects), BATCH):
        chunk = prospects[i:i + BATCH]
        r = crm.call("POST", "/prospects", {"items": [{k: v for k, v in p.items() if not k.startswith("_")} for p in chunk]})["data"]
        created += r["created"]; updated += r["updated"]; skipped += r["skipped_do_not_contact"]
    if prospects:
        state["prospects_since"] = max(str(p["_updated_at"] or "") for p in prospects) or state.get("prospects_since")
    sent_ids = set(state.get("event_ids", []))
    new_events = [e for e in events if e["event_id"] not in sent_ids]
    rec = dup = 0
    for i in range(0, len(new_events), BATCH):
        chunk = new_events[i:i + BATCH]
        r = crm.call("POST", "/events", {"items": chunk})["data"]
        rec += r["recorded"]; dup += r["duplicate"]
        sent_ids.update(e["event_id"] for e in chunk)
    state["event_ids"] = sorted(sent_ids)[-50000:]
    msg = ""
    if args.write_dnc:
        dnc = [d["value"] for d in crm.call("GET", "/do-not-contact")["data"]]
        msg = " " + write_dnc(Path(args.harvey_dir), dnc)
    STATE_FILE.write_text(json.dumps(state))
    print(f"[{datetime.now():%Y-%m-%d %H:%M}] prospects: {created} new, {updated} updated, {skipped} blocked by do-not-contact; "
          f"events: {rec} recorded, {dup} already known.{msg}", flush=True)


def main() -> None:
    load_dotenv()
    ap = argparse.ArgumentParser(description="Sync Harvey with the Gexart CRM")
    ap.add_argument("--harvey-dir", default=os.environ.get("HARVEY_DIR", "."), help="Folder Harvey was cloned into")
    ap.add_argument("--crm-url", default=os.environ.get("GEXART_CRM_URL", ""))
    ap.add_argument("--token", default=os.environ.get("GEXART_CRM_TOKEN", ""))
    ap.add_argument("--loop", type=int, default=0, help="Repeat every N minutes")
    ap.add_argument("--write-dnc", action="store_true", help="Merge the CRM do-not-contact list into Harvey's config")
    ap.add_argument("--full", action="store_true", help="Resend all prospects, not only changed ones")
    args = ap.parse_args()
    if not args.crm_url or not args.token.startswith("gxd_"):
        raise SystemExit("Set GEXART_CRM_URL and GEXART_CRM_TOKEN (a Harvey bridge token from the CRM).")
    while True:
        try:
            sync_once(args)
        except SystemExit as e:
            if not args.loop:
                raise
            print(f"Sync failed: {e}", file=sys.stderr, flush=True)
        if not args.loop:
            break
        time.sleep(args.loop * 60)


if __name__ == "__main__":
    main()
