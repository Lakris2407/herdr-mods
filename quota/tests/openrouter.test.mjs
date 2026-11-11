import assert from "node:assert/strict";
import { test } from "node:test";
import { SCRIPT, parseOpenRouter, shortModel, money, creditUsed } from "../mods/quota/openrouter.js";

const out = (key, credits, model = "deepseek/deepseek-v4.1-flash-1017") =>
  `@@model\n${model}\n@@key\n${JSON.stringify(key)}\n@@credits\n${JSON.stringify(credits)}\n`;

test("short model names drop the vendor, its repeat and a date tag", () => {
  assert.equal(shortModel("deepseek/deepseek-v4.1-flash-1017"), "v4.1-flash");
  assert.equal(shortModel("deepseek/deepseek-v4-pro"), "v4-pro");
  assert.equal(shortModel("anthropic/claude-sonnet-5:beta"), "claude-sonnet-5");
  assert.equal(shortModel("plain-model"), "plain-model");
  assert.equal(shortModel(null), null);
});

test("spend and credits come from the key and credits routes", () => {
  const p = parseOpenRouter(out(
    { data: { usage: 50, usage_daily: 1.42, usage_weekly: 6.87, usage_monthly: 18.3, limit: null, limit_remaining: null } },
    { data: { total_credits: 100, total_usage: 18.3 } }));
  assert.equal(p.id, "openrouter");
  assert.equal(p.model, "deepseek/deepseek-v4.1-flash-1017");
  assert.deepEqual(p.spend, { day: 1.42, week: 6.87, month: 18.3, total: 50 });
  assert.deepEqual(p.credits, { total: 100, used: 18.3 });
  assert.equal(Math.round(creditUsed(p)), 18);
});

test("a refused credits route falls back to the key limit", () => {
  const p = parseOpenRouter(out(
    { data: { usage: 5, usage_daily: 1, usage_weekly: 2, usage_monthly: 5, limit: 20, limit_remaining: 15 } },
    { error: { code: 403, message: "Forbidden" } }));
  assert.deepEqual(p.credits, { total: 20, used: 5 });
});

test("no key means signed out, and an API error is kept for the popup", () => {
  const none = parseOpenRouter("@@model\n\n@@nokey\n");
  assert.equal(none.spend, null);
  assert.equal(none.model, null);
  const bad = parseOpenRouter(out({ error: { code: 401, message: "User not found." } }, {}));
  assert.equal(bad.spend, null);
  assert.equal(bad.error, "User not found.");
});

test("money keeps cents under $100", () => {
  assert.equal(money(1.4234), "$1.42");
  assert.equal(money(0), "$0.00");
  assert.equal(money(1234.6), "$1235");
  assert.equal(money(null), "–");
});

test("the key never becomes a command argument", () => {
  // Every use of $k goes through printf (a shell builtin) into curl's stdin.
  const uses = SCRIPT.split("\n").filter(l => l.includes('"$k"'));
  assert.ok(uses.length >= 3);
  for (const line of uses.filter(l => !l.startsWith("[ ")))
    assert.match(line, /^printf 'Authorization: Bearer %s\\n' "\$k" \| curl .* -H @- https:\/\/openrouter\.ai\//);
  assert.doesNotMatch(SCRIPT, /sk-or-/);
});
