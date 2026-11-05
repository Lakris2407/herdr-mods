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

// quota-axi cannot read a gh login kept in the system credential store (Windows), so a signed-in Copilot can come
// back with no windows. gh itself can read it. Read-only: the token stays inside gh and never reaches this code.
export function parseCopilot(stdout) {
  const user = JSON.parse(stdout);
  return Object.entries(user.quota_snapshots ?? {})
    .filter(([, q]) => q && !q.unlimited && Number.isFinite(q.percent_remaining))
    .map(([id, q]) => ({
      id, label: id.replace(/_/g, " "), kind: "monthly", shareOf: null,
      percentUsed: 100 - q.percent_remaining, resetsAt: user.quota_reset_date_utc ?? null, windowSeconds: null,
    }));
}

// Null when gh is missing, signed out or answers with something else: the provider then stays as quota-axi left it.
export async function copilotWindows(exec) {
  try {
    const r = await exec("gh", ["api", "/copilot_internal/user"]);
    return r.code === 0 ? parseCopilot(r.stdout) : null;
  } catch {
    return null;
  }
}
