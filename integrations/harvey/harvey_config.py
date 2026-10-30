#!/usr/bin/env python3
"""Small, safe edits to Harvey's config for the Gexart Harvey app.

Harvey reads harvey.local.yaml *instead of* harvey.yaml when it exists, so the first edit copies the
template, and every edit keeps a .bak. Run with Harvey's own Python, from anywhere:

  python harvey_config.py --harvey-dir D:\\harvey show
  python harvey_config.py --harvey-dir D:\\harvey set-niche --industries "Dental clinic;Gym" --geography "Kolkata, India"
  python harvey_config.py --harvey-dir D:\\harvey set-postal "Gexart, 12 Park Street, Kolkata 700016, India"
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

try:
    import yaml  # Harvey depends on PyYAML
except ImportError:  # pragma: no cover
    raise SystemExit("Run this with Harvey's Python (.venv\\Scripts\\python.exe): PyYAML is missing.")


def paths(harvey_dir: Path) -> tuple[Path, Path]:
    return harvey_dir / "harvey.local.yaml", harvey_dir / "harvey.yaml"


def load(harvey_dir: Path) -> tuple[dict, Path]:
    local, template = paths(harvey_dir)
    src = local if local.exists() else template
    if not src.exists():
        raise SystemExit(f"No harvey.yaml in {harvey_dir}. Is this the Harvey folder?")
    return (yaml.safe_load(src.read_text(encoding="utf-8")) or {}), local


def save(data: dict, local: Path) -> None:
    if local.exists():
        shutil.copy2(local, local.with_suffix(".yaml.bak"))
    local.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True, width=120), encoding="utf-8")


def split(v: str) -> list[str]:
    return [x.strip() for x in v.replace("\n", ";").split(";") if x.strip()]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--harvey-dir", required=True)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show")
    n = sub.add_parser("set-niche")
    n.add_argument("--industries", required=True, help="Semicolon-separated, e.g. 'Dental clinic;Gym'")
    n.add_argument("--geography", required=True, help="Semicolon-separated, e.g. 'Kolkata, India;Pune, India'")
    n.add_argument("--titles", default="Owner;Founder;Managing Director;Clinic Manager")
    p = sub.add_parser("set-postal")
    p.add_argument("address")
    who = sub.add_parser("set-persona")
    who.add_argument("--name", required=True)
    who.add_argument("--company", default="Gexart")
    who.add_argument("--email", required=True)
    args = ap.parse_args()

    harvey_dir = Path(args.harvey_dir)
    data, local = load(harvey_dir)

    if args.cmd == "show":
        icp = data.get("icp") or {}
        print(json.dumps({
            "trained": local.exists(),
            "product": (data.get("product") or {}).get("name"),
            "industries": icp.get("industries") or [],
            "geography": icp.get("geography") or [],
            "postal_address": (data.get("compliance") or {}).get("postal_address") or "",
            "provider": ((data.get("channels") or {}).get("email") or {}).get("provider"),
            "persona": (data.get("persona") or {}).get("name"),
        }))
        return

    if args.cmd == "set-niche":
        icp = data.setdefault("icp", {}) or {}
        data["icp"] = icp
        icp["industries"] = split(args.industries)
        icp["geography"] = split(args.geography)
        icp["titles"] = split(args.titles)
        icp.setdefault("company_size", "2-50 employees")
    elif args.cmd == "set-postal":
        comp = data.setdefault("compliance", {}) or {}
        data["compliance"] = comp
        comp["postal_address"] = args.address.strip()
    elif args.cmd == "set-persona":
        persona = data.setdefault("persona", {}) or {}
        data["persona"] = persona
        persona.update({"name": args.name.strip(), "company": args.company.strip(), "email": args.email.strip()})
    save(data, local)
    print(json.dumps({"ok": True, "file": str(local)}))


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # report cleanly to the app
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)
