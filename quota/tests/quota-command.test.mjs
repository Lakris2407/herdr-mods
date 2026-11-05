import assert from "node:assert/strict";
import { test } from "node:test";
import { runQuotaCommand, copilotWindows, parseCopilot } from "../mods/quota/quota-command.js";

test("native executable success does not invoke a shell", async () => {
  const calls = [];
  const result = { code: 0, stdout: '{"providers":[]}' };
  assert.equal(await runQuotaCommand(async (...args) => { calls.push(args); return result; }), result);
  assert.deepEqual(calls, [["quota-axi", ["--json"], {}]]);
});

test("spawn failure uses the fixed npm shim command and preserves the target machine", async () => {
  const calls = [], options = { on: "windows-host" }, result = { code: 0, stdout: "{}" };
  const actual = await runQuotaCommand(async (...args) => {
    calls.push(args);
    if (args[0] === "quota-axi") throw new Error("cannot spawn .cmd");
    return result;
  }, options);
  assert.equal(actual, result);
  assert.deepEqual(calls, [
    ["quota-axi", ["--json"], options],
    ["cmd.exe", ["/d", "/s", "/c", "quota-axi --json"], options],
  ]);
});

test("a CLI error is returned without invoking another shell", async () => {
  let calls = 0;
  const result = { code: 1, stderr: "authentication failed" };
  assert.equal(await runQuotaCommand(async () => { calls++; return result; }), result);
  assert.equal(calls, 1);
});

test("missing cmd preserves the original error for the existing Unix fallback", async () => {
  const original = new Error("quota-axi not on PATH");
  await assert.rejects(runQuotaCommand(async command => {
    throw command === "quota-axi" ? original : new Error("cmd.exe not found");
  }), error => error === original);
});

test("Copilot quota from gh: limited snapshots only, used = 100 - remaining", () => {
  const stdout = JSON.stringify({
    quota_reset_date_utc: "2026-12-01T00:00:00Z",
    quota_snapshots: {
      chat: { unlimited: true, percent_remaining: 100 },
      premium_interactions: { unlimited: false, percent_remaining: 62.5 },
      completions: { unlimited: false },
    },
  });
  assert.deepEqual(parseCopilot(stdout), [{
    id: "premium_interactions", label: "premium interactions", kind: "monthly", shareOf: null,
    percentUsed: 37.5, resetsAt: "2026-12-01T00:00:00Z", windowSeconds: null,
  }]);
});

test("Copilot fallback calls only the read-only gh endpoint", async () => {
  const calls = [];
  await copilotWindows(async (...args) => { calls.push(args); return { code: 0, stdout: "{}" }; });
  assert.deepEqual(calls, [["gh", ["api", "/copilot_internal/user"]]]);
});

test("Copilot fallback gives null when gh is missing, signed out or answers badly", async () => {
  assert.equal(await copilotWindows(async () => { throw new Error("gh not found"); }), null);
  assert.equal(await copilotWindows(async () => ({ code: 1, stdout: "", stderr: "not logged in" })), null);
  assert.equal(await copilotWindows(async () => ({ code: 0, stdout: "<html>" })), null);
});
