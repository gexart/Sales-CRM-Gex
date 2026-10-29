// Background work. Uses the Cloudflare Queue when bound (retries, no request held open);
// otherwise falls back to waitUntil so local development without queues still works.
import type { Env, Job } from "./env";
import { runAudit } from "./audits/run";
import { transcribeCall } from "./routes/calls";

export async function enqueue(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, job: Job) {
  if (env.JOBS) {
    try {
      await env.JOBS.send(job);
      return;
    } catch (e) {
      console.warn("Queue send failed; running inline", e);
    }
  }
  ctx.waitUntil(runJob(env, job));
}

export async function runJob(env: Env, job: Job) {
  if (job.kind === "audit") return runAudit(env, job.runId, job.userId, job.accountId);
  if (job.kind === "transcribe") return transcribeCall(env, job.callId);
}

export async function handleQueue(batch: MessageBatch<Job>, env: Env) {
  for (const msg of batch.messages) {
    try {
      await runJob(env, msg.body);
      msg.ack();
    } catch (e) {
      console.error("Job failed", msg.body, e);
      msg.retry({ delaySeconds: 30 });
    }
  }
}
