// Idempotent job runner: a (job, slot) runs to success at most once; retries with backoff; timeout; dead letters.
export async function runJob(db, { job, slot, fn, retries = 3, timeoutMs = 25000 }) {
  const key = `${job}:${slot}`;
  const prev = await db.prepare('SELECT status, attempts FROM job_runs WHERE key = ?').bind(key).first();
  if (prev && prev.status === 'done') return { skipped: true, key };
  if (prev && prev.status === 'failed' && prev.attempts >= retries) return { ok: false, exhausted: true, key };
  let attempts = prev ? prev.attempts : 0;
  let lastErr;
  while (attempts < retries) {
    attempts++;
    await db.prepare("INSERT INTO job_runs (key, job, slot, status, attempts, started_at) VALUES (?, ?, ?, 'running', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET status='running', attempts=excluded.attempts, started_at=excluded.started_at").bind(key, job, slot, attempts).run();
    try {
      const result = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs))]);
      await db.prepare("UPDATE job_runs SET status='done', finished_at=datetime('now'), error=NULL WHERE key = ?").bind(key).run();
      return { ok: true, key, attempts, result };
    } catch (e) {
      lastErr = String(e && e.message || e);
      await db.prepare("UPDATE job_runs SET status='failed', error=? WHERE key = ?").bind(lastErr, key).run();
      if (attempts < retries) await new Promise((r) => setTimeout(r, 100 * 2 ** attempts));
    }
  }
  await db.prepare('INSERT INTO dead_letters (job, payload, error) VALUES (?, ?, ?)').bind(job, slot, lastErr).run();
  return { ok: false, key, attempts, error: lastErr };
}
