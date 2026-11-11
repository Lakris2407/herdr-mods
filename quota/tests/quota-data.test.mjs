import assert from "node:assert/strict";
import { test } from "node:test";
import { loadQuota } from "../mods/quota/quota-data.js";
import { SCRIPT } from "../mods/quota/openrouter.js";

const spend = { code: 0, stdout: '@@key\n{"data":{"usage_daily":1.42}}\n' };
const isRouter = args => args[1] === SCRIPT;

test("OpenRouter spend survives failed quota-axi and its shell fallback", async () => {
  const data = await loadQuota(async (command, args) => {
    if (isRouter(args)) return spend;
    return { code: 1, stderr: "quota-axi missing" };
  });
  assert.equal(data.providers.length, 1);
  assert.equal(data.providers[0].spend.day, 1.42);
  assert.match(data.error, /quota-axi missing/);
});

test("malformed quota output cannot suppress valid OpenRouter spend", async () => {
  const data = await loadQuota(async (command, args) => isRouter(args)
    ? spend : { code: 0, stdout: "not JSON" });
  assert.equal(data.providers[0].id, "openrouter");
  assert.ok(data.error);
});

test("OpenRouter failure leaves quota providers available", async () => {
  const data = await loadQuota(async (command, args) => {
    if (isRouter(args)) throw new Error("network unavailable");
    return { code: 0, stdout: '{"providers":[{"provider":"claude","windows":[]}]}' };
  });
  assert.deepEqual(data.providers.map(p => p.id), ["claude"]);
  assert.equal(data.error, null);
});

test("total failure still rejects so refresh can retain its previous snapshot", async () => {
  await assert.rejects(loadQuota(async () => ({ code: 1, stderr: "unavailable" })), /unavailable/);
});

test("remote reads stay on the target machine and do not read local OpenRouter", async () => {
  const data = await loadQuota(async (command, args, options) => {
    assert.equal(command, "quota-axi");
    assert.equal(options.on, "build-host");
    return { code: 0, stdout: '{"providers":[]}' };
  }, "build-host");
  assert.deepEqual(data.providers, []);
  assert.equal(data.error, null);
});
