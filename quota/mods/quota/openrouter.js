// OpenRouter spend (pay as you go, in US dollars) and the model DeepSeek Harness uses, for the quota strip.
// No Herdr imports here, so tests can load it directly.

// The key stays inside this fixed script: Keychain (or OPENROUTER_API_KEY) -> printf (a shell builtin, so not in
// any process list) -> curl's stdin as a header. It never reaches the mod, Herdr's shared state, or a log.
// Nothing is interpolated into the script; the Keychain service name and the profile path are fixed.
export const KEYCHAIN_SERVICE = "openrouter-api-key";
export const SCRIPT = `
k=$(security find-generic-password -s ${KEYCHAIN_SERVICE} -w 2>/dev/null) || k="$OPENROUTER_API_KEY"
echo @@model
sed -n 's/^[[:space:]]*model:[[:space:]]*//p' "$HOME/.dsh/profiles/headless/cordis.patch.yml" 2>/dev/null | head -n 1
[ -n "$k" ] || { echo @@nokey; exit 0; }
echo @@key
printf 'Authorization: Bearer %s\\n' "$k" | curl -sS --max-time 15 -H @- https://openrouter.ai/api/v1/key
echo
echo @@credits
printf 'Authorization: Bearer %s\\n' "$k" | curl -sS --max-time 15 -H @- https://openrouter.ai/api/v1/credits
echo
`;

export const PERIODS = [["day", "Today", "today"], ["week", "This week", "week"], ["month", "This month", "month"]];

// Split the script output into its marked sections.
function sections(stdout) {
  const out = {};
  let name = null;
  for (const line of String(stdout).split("\n")) {
    const m = /^@@(\w+)$/.exec(line.trim());
    if (m) { name = m[1]; out[name] = ""; } else if (name) out[name] += `${line}\n`;
  }
  return out;
}

const json = text => { try { return JSON.parse(text); } catch { return null; } };
const num = v => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);

// "deepseek/deepseek-v4.1-flash-1017" -> "v4.1-flash": drop the vendor, its repeat in the name, and a date tag.
export function shortModel(model) {
  if (!model) return null;
  const [vendor, name = vendor] = model.includes("/") ? model.split("/", 2) : [null, model];
  let s = name.replace(/:.*$/, "");
  if (vendor && s.toLowerCase().startsWith(`${vendor.toLowerCase()}-`)) s = s.slice(vendor.length + 1);
  return s.replace(/-\d{4}(-\d{2})?$/, "") || name;
}

// Provider in the same shape quota-axi providers take, plus `spend`. No windows: spend is not a percentage.
export function parseOpenRouter(stdout) {
  const s = sections(stdout);
  const model = (s.model ?? "").trim().replace(/^["']|["']$/g, "") || null;
  const base = { id: "openrouter", label: "OpenRouter", plan: "pay as you go", status: null, windows: [], model, spend: null, credits: null, error: null };
  if ("nokey" in s) return base;
  const key = json((s.key ?? "").trim());
  if (!key?.data) return { ...base, error: key?.error?.message ?? "OpenRouter did not answer" };
  const d = key.data;
  const spend = { day: num(d.usage_daily), week: num(d.usage_weekly), month: num(d.usage_monthly), total: num(d.usage) };
  // The credits route can refuse a key without that right: then fall back to the key's own limit.
  const c = json((s.credits ?? "").trim())?.data;
  let credits = null;
  if (num(c?.total_credits) !== null && num(c?.total_usage) !== null) credits = { total: num(c.total_credits), used: num(c.total_usage) };
  else if (num(d.limit) !== null && num(d.limit_remaining) !== null) credits = { total: num(d.limit), used: num(d.limit) - num(d.limit_remaining) };
  return { ...base, spend, credits };
}

export const money = v => (v === null || v === undefined ? "–" : `$${v < 100 ? v.toFixed(2) : Math.round(v)}`);

// Share of the credit used, 0..100; null without a credit total.
export function creditUsed(p) {
  const c = p.credits;
  return c && c.total > 0 ? Math.min(100, Math.max(0, (c.used / c.total) * 100)) : null;
}
