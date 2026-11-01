import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWindows } from "../mods/quota/quota-windows.js";

const windows = ["gemini_5h", "gemini_weekly", "claude_gpt_5h", "claude_gpt_weekly"]
  .map(id => ({ id, kind: id.endsWith("weekly") ? "weekly" : "session" }));
const provider = { id: "agy", windows };

test("existing settings and enabled option preserve all windows", () => {
  assert.deepEqual(visibleWindows(provider, {}), windows);
  assert.deepEqual(visibleWindows(provider, { agyClaudeGpt: true }), windows);
});

test("disabled option hides only Claude/GPT without changing cached data", () => {
  assert.deepEqual(visibleWindows(provider, { agyClaudeGpt: false }).map(w => w.id),
    ["gemini_5h", "gemini_weekly"]);
  assert.equal(provider.windows.length, 4);
  assert.deepEqual(visibleWindows(provider, { agyClaudeGpt: true }), windows);
});

test("other providers and unrelated future windows are unaffected", () => {
  assert.deepEqual(visibleWindows({ id: "claude", windows }, { agyClaudeGpt: false }), windows);
  const future = { id: "agy", windows: [{ id: "new_model" }, { kind: "weekly" }] };
  assert.deepEqual(visibleWindows(future, { agyClaudeGpt: false }), future.windows);
});

test("category filters still apply independently after the provider filter", () => {
  assert.deepEqual(visibleWindows(provider, { agyClaudeGpt: false })
    .filter(w => w.kind === "weekly").map(w => w.id), ["gemini_weekly"]);
});
