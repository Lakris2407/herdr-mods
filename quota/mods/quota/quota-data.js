import { runQuotaCommand, copilotWindows } from "./quota-command.js";
import { SCRIPT as OPENROUTER, parseOpenRouter } from "./openrouter.js";

async function readOpenRouter(exec) {
  try {
    const r = await exec("sh", ["-c", OPENROUTER]);
    return r.code === 0 ? parseOpenRouter(r.stdout) : null;
  } catch {
    return null;
  }
}

async function readQuota(exec, on = null) {
  let r = await runQuotaCommand(exec, { on }).catch(e => ({ code: -1, stderr: String(e) }));
  // Apps started from the Dock miss PATH entries set in the shell's rc file (npm, nvm, mise): ask the person's own shell.
  if (r.code !== 0) r = await exec("sh", ["-c", 'exec "${SHELL:-/bin/sh}" -lic "quota-axi --json" </dev/null'], { on }).catch(e => ({ code: -1, stderr: String(e) }));
  if (r.code !== 0) throw new Error(`quota-axi failed: ${(r.stderr || "").trim().split("\n").pop() || `exit ${r.code}`}`);
  // An interactive shell can print a banner first; the report starts at the first brace.
  const data = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
  const providers = (data.providers ?? []).map(p => ({
      id: p.provider, label: p.label ?? p.provider, plan: p.plan ?? null, status: p.state?.status ?? null,
      windows: (p.windows ?? []).map(w => ({
        id: w.id, label: w.label, kind: w.kind, shareOf: w.shareOf ?? null,
        // Newer quota-axi reports remaining percentages; shares are not independent allowances.
        percentUsed: Number.isFinite(w.percentUsed) ? w.percentUsed
          : w.shareOf == null && Number.isFinite(w.percentRemaining) ? 100 - w.percentRemaining : null,
        resetsAt: w.resetsAt ?? null, windowSeconds: w.windowSeconds ?? null,
      })).filter(w => Number.isFinite(w.percentUsed)),
    }));
  // This computer only: gh on a remote machine would need its own login there.
  const copilot = on == null ? providers.find(p => p.id === "copilot" && !p.windows.length) : null;
  if (copilot) copilot.windows = (await copilotWindows(exec)) ?? [];
  return providers;
}

// Fetch independent sources together so an unavailable quota-axi cannot hide valid spend.
export async function loadQuota(exec, on = null) {
  const [quota, router] = await Promise.allSettled([
    readQuota(exec, on), on == null ? readOpenRouter(exec) : null,
  ]);
  const provider = router.status === "fulfilled" ? router.value : null;
  if (quota.status === "rejected" && !provider?.spend) throw quota.reason;
  const providers = quota.status === "fulfilled" ? quota.value : [];
  if (provider) providers.push(provider);
  return { at: Date.now(), providers, error: quota.status === "rejected" ? String(quota.reason.message ?? quota.reason) : null };
}
