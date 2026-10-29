import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { newId, now } from "../lib/util";
import { syncGithubReleaseIfDue } from "./app-releases";

export const notificationRoutes = new Hono<AppEnv>();

notificationRoutes.get("/", async (c) => {
  const u = c.get("user");
  const [list, unread] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30").bind(u.id),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").bind(u.id),
  ]);
  return c.json({ data: list.results, meta: { unread: Number(unread.results[0]?.n ?? 0) } });
});

notificationRoutes.post("/read-all", async (c) => {
  await c.env.DB.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").bind(now(), c.get("user").id).run();
  return c.json({ data: { ok: true } });
});

notificationRoutes.post("/:id/read", async (c) => {
  await c.env.DB.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?").bind(now(), c.req.param("id"), c.get("user").id).run();
  return c.json({ data: { ok: true } });
});

/** Cron (every 15 min): task reminders, housekeeping and Places data retention. */
export async function scheduled(env: Env) {
  // Pick up new Android app builds from GitHub (best effort; also done when the Phone app page opens).
  await syncGithubReleaseIfDue(env);
  const db = env.DB;
  const t = now();
  const soon = new Date(Date.now() + 60 * 60_000).toISOString();
  const today = t.slice(0, 10);
  const due = await db
    .prepare("SELECT id, title, owner_id, due_at FROM tasks WHERE status IN ('open','in_progress') AND archived_at IS NULL AND owner_id IS NOT NULL AND due_at IS NOT NULL AND due_at <= ? LIMIT 500")
    .bind(soon)
    .all<{ id: string; title: string; owner_id: string; due_at: string }>();
  const stmts = due.results.map((x) => {
    const overdue = x.due_at < t;
    return db
      .prepare("INSERT OR IGNORE INTO notifications (id, user_id, type, title, body, entity_type, entity_id, dedupe_key, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(newId(), x.owner_id, overdue ? "task_overdue" : "task_due", `${overdue ? "Overdue" : "Due soon"}: ${x.title}`.slice(0, 200), null, "task", x.id, overdue ? `task-overdue:${x.id}:${today}` : `task-due:${x.id}:${x.due_at}`, t);
  });
  stmts.push(
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
    db.prepare("DELETE FROM login_attempts WHERE created_at < ?").bind(new Date(Date.now() - 86400_000).toISOString()),
    // Google Places content is kept at most 30 days; imported prospects keep only what the user confirmed.
    db.prepare("DELETE FROM lead_search_results WHERE created_at < ?").bind(new Date(Date.now() - 30 * 86400_000).toISOString()),
    db.prepare("DELETE FROM notifications WHERE created_at < ? AND read_at IS NOT NULL").bind(new Date(Date.now() - 60 * 86400_000).toISOString()),
  );
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
}
