# Harvey ↔ Gexart CRM bridge

[Harvey](https://github.com/ethanplusai/harvey) is an open-source sales agent that runs on your PC
using your Claude subscription. This bridge keeps it and the CRM in step:

| From | To | What |
|---|---|---|
| Harvey | CRM | Every business/person Harvey finds becomes a CRM prospect (source **harvey**), with its research notes |
| Harvey | CRM | Emails sent, replies, opt-outs, bounces and booked meetings appear on the prospect's timeline; every reply creates a task and a notification |
| CRM | Harvey | The CRM's do-not-contact list is merged into Harvey's `compliance.do_not_contact`, so an opt-out anywhere stops both |

Nothing is deleted on either side, and Harvey's database is only read.

## The Gexart Harvey app (Windows)

Download it from the CRM (**Autopilot → Setup → Harvey on your PC**) or use this folder directly.

1. Run **Install Harvey.cmd** once. It installs Python, Git and the Claude Code CLI if missing, puts Harvey in
   `%USERPROFILE%\harvey`, and adds a **Gexart Harvey** shortcut to your desktop.
2. Open **Gexart Harvey** and go top to bottom: **Sign in to Claude** → **Teach Harvey** (your website) →
   **Save niche** (industries + cities) and your **postal address** → paste the CRM **bridge token** →
   **Mailbox setup wizard** → **Start Harvey**.
3. While the app is open it syncs with the CRM every 15 minutes. Harvey keeps running after you close the app.

The app keeps its settings in `%APPDATA%\GexartHarvey` (the token is encrypted with Windows DPAPI) and edits
Harvey's config only through `harvey_config.py`, which backs up every change. Rebuild the download with
`node scripts/harvey-kit.mjs` after changing anything in this folder.

## Manual set-up (any OS)

1. **Install Harvey** (needs Python 3.11+ and Claude Code logged in with `claude login`):
   ```bash
   git clone https://github.com/ethanplusai/harvey.git C:\harvey
   cd C:\harvey
   py -3.13 -m venv .venv
   .venv\Scripts\activate
   pip install -e .
   ```
   Then follow Harvey's README: `harvey train https://gexart.com`, set your mailbox, `harvey discover`.
2. **Create a bridge token** in the CRM: **Autopilot → Setup → Harvey bridge → Create token**. Copy it (shown once).
3. **Create `integrations\harvey\.env`** next to `crm_sync.py`:
   ```
   GEXART_CRM_URL=https://sales-crm-gexart.tech-gexart.workers.dev
   GEXART_CRM_TOKEN=gxd_…
   HARVEY_DIR=C:\harvey
   ```
4. **Test once** with Harvey's Python:
   ```bash
   C:\harvey\.venv\Scripts\python.exe crm_sync.py --write-dnc
   ```
5. **Run it every 15 minutes**: Task Scheduler → Create Basic Task → Daily → repeat every 15 minutes, action
   `C:\harvey\.venv\Scripts\python.exe` with arguments `"D:\…\integrations\harvey\crm_sync.py" --write-dnc`.
   Or leave a terminal open with `--loop 15`.

## Notes

- Harvey runs on **your PC**: when it is off or asleep, Harvey and this sync pause. The CRM's own Autopilot
  runs in the cloud regardless.
- Use one tool per prospect: let Harvey work its own leads, and the CRM Autopilot its own. The CRM skips
  prospects that are on the do-not-contact list, and the shared list prevents double opt-out mistakes.
- Harvey uses your Claude plan's usage limits. Check your provider's terms for automated use.
- Revoke a token any time in **Settings → Phone app** (bridge tokens are listed with devices).
