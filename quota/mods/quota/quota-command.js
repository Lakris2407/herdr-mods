// npm installs a .cmd shim on Windows, which cannot be spawned as a native executable.
// Keep exec injectable so the fallback and machine forwarding can be checked without Herdr.
export async function runQuotaCommand(exec, options = {}) {
  try {
    return await exec("quota-axi", ["--json"], options);
  } catch (startError) {
    try {
      // Fixed command only: never interpolate paths, credentials or caller arguments into cmd.
      return await exec("cmd.exe", ["/d", "/s", "/c", "quota-axi --json"], options);
    } catch {
      // On Unix, let the existing login-shell fallback handle PATH discovery.
      throw startError;
    }
  }
}

// Windows keeps the gh login in the credential store, which quota-axi cannot read; gh itself can.
// Read-only, same numbers quota-axi reports; the token never passes through here.
export async function copilotWindows(exec) {
  const r = await exec("gh", ["api", "/copilot_internal/user"]);
  if (r.code !== 0) return null;
  const user = JSON.parse(r.stdout);
  return Object.entries(user.quota_snapshots ?? {})
    .filter(([, q]) => !q.unlimited && Number.isFinite(q.percent_remaining))
    .map(([id, q]) => ({ id, label: id.replace(/_/g, " "), kind: "monthly", shareOf: null, percentUsed: 100 - q.percent_remaining, resetsAt: user.quota_reset_date_utc ?? null, windowSeconds: null }));
}
