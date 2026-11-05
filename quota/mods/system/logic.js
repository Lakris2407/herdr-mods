// What the System block knows, without Herdr: parsing, thresholds and wording. Pure, so node can test it.

export const COUNTERS = [
  "\\Processor Information(_Total)\\% Processor Utility",
  "\\System\\Processor Queue Length",
  "\\Processor Information(_Total)\\% Processor Performance",
  "\\Memory\\Available MBytes",
  "\\Memory\\Committed Bytes",
  "\\Memory\\Commit Limit",
  "\\Paging File(_Total)\\% Usage",
  "\\LogicalDisk(C:)\\Free Megabytes",
  "\\LogicalDisk(D:)\\Free Megabytes",
  "\\PhysicalDisk(_Total)\\% Idle Time",
  "\\PhysicalDisk(_Total)\\Disk Bytes/sec",
  "\\LogicalDisk(C:)\\% Free Space",
  "\\LogicalDisk(D:)\\% Free Space",
];
// One typeperf at a time writes one sample a second to one small file, overwritten at each start. It ends by itself
// after this many samples, under exec's 30 s limit, so nothing outlives Herdr by more than that.
const LIVE_SAMPLES = 22;
export const livePath = (home) => `${home}\\AppData\\Local\\Temp\\herdr-system-live.csv`;
export const liveArgs = (path, samples = LIVE_SAMPLES) => [...COUNTERS, "-si", "1", "-sc", String(samples), "-f", "CSV", "-y", "-o", path];

// One line per process. The command line is read only to set the Cline and Codex flags and is never printed.
export const SCAN = String.raw`[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$now=Get-Date;Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,WorkingSetSize,KernelModeTime,UserModeTime,CreationDate,CommandLine|ForEach-Object{$age=if($_.CreationDate){[long]($now-$_.CreationDate).TotalSeconds}else{0};$cline=if($_.Name -eq 'node.exe' -and $_.CommandLine -match 'node_modules[\\/]+cline[\\/]+bin[\\/]+cline'){1}else{0};$codex=if($_.ProcessId -ne $PID -and $_.Name -notmatch '^claude' -and $_.CommandLine -match 'codex' -and $_.CommandLine -notmatch 'mcp'){1}else{0};$cpu=[long](($_.KernelModeTime+$_.UserModeTime)/1e7);($_.ProcessId,$_.ParentProcessId,$_.Name,$_.WorkingSetSize,$cpu,$age,$cline,$codex) -join '|'};$map=@{};Get-ChildItem (Join-Path $env:USERPROFILE '.claude\sessions') -Filter *.json -File -ErrorAction SilentlyContinue|ForEach-Object{try{$map[[string](Get-Content $_.FullName -Raw|ConvertFrom-Json).sessionId]=$_.BaseName}catch{}};$d=Join-Path $env:USERPROFILE 'AppData\Local\Temp\herdr-subagents';if(Test-Path $d){Get-ChildItem $d -File|ForEach-Object{if(($now-$_.LastWriteTime).TotalSeconds -gt 15){Remove-Item $_.FullName -ErrorAction SilentlyContinue}else{try{$n=[int](Get-Content $_.FullName -Raw|ConvertFrom-Json).running;$owner=$map[$_.BaseName];if(-not $owner){$owner=0};"SUB|$owner|$n"}catch{}}}};"SUB|end"`;

// One short read on a Linux machine, which exits at once: nothing is installed or left running there.
export const REMOTE_SCRIPT = String.raw`uname -s; cut -d' ' -f1 /proc/uptime; head -1 /proc/stat; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo; awk '$3 ~ /^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme[0-9]+n[0-9]+)$/ {print "disk", $3, $6, $10, $13}' /proc/diskstats; df -kP / | tail -1`;

// Task Manager's Memory % counts against this total. It never changes, so the mod asks once.
export const TOTAL_MEMORY = "(Get-CimInstance Win32_ComputerSystem -Property TotalPhysicalMemory).TotalPhysicalMemory";

const GIB = 1024 ** 3;
const STRAY_AGE_S = 600, STRAY_SHARE = 0.5;

const mean = (list) => list.reduce((sum, x) => sum + x, 0) / list.length;
const optional = (x) => (Number.isFinite(x) && x >= 0 ? x : null);
const clampPct = (x) => Math.min(100, Math.max(0, x));
const usedPct = (freePct) => (freePct == null ? null : clampPct(100 - freePct));

export function parseTotalMemory(stdout) {
  const bytes = Number(String(stdout ?? "").trim());
  return Number.isFinite(bytes) && bytes > 0 ? bytes / GIB : null;
}

// Column order is the order of COUNTERS. Headers fail the number check, typeperf's closing lines lack a quote.
export function parseTypeperf(stdout) {
  const rows = [];
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    if (!line.startsWith('"')) continue;
    const fields = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    if (fields.length !== COUNTERS.length + 1) continue;
    const v = fields.slice(1).map((x) => (x.trim() === "" ? NaN : Number(x)));
    if (v.slice(0, 8).some((x) => !Number.isFinite(x) || x < 0) || v[5] === 0) continue;
    const idle = optional(v[9]), freeD = optional(v[8]);
    rows.push({
      cpu: clampPct(v[0]), queue: v[1], clock: v[2],
      availableGB: v[3] / 1024, committedGB: v[4] / GIB, limitGB: v[5] / GIB, commitPct: (v[4] / v[5]) * 100,
      pagefilePct: v[6], freeCGB: v[7] / 1024, freeDGB: freeD == null ? null : freeD / 1024,
      diskPct: idle == null ? null : clampPct(100 - idle), diskMBs: optional(v[10]) == null ? null : v[10] / 1024 ** 2,
      usedCPct: usedPct(optional(v[11])), usedDPct: usedPct(optional(v[12])),
    });
  }
  return rows;
}

export function parseRemote(stdout) {
  const lines = String(stdout ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const os = lines[0] ?? null;
  if (os !== "Linux") return os ? { os } : null;
  const cpu = lines.find((x) => /^cpu\s/.test(x))?.split(/\s+/).slice(1).map(Number);
  const kb = (name) => Number(lines.find((x) => x.startsWith(`${name}:`))?.match(/(\d+)/)?.[1]);
  const df = lines.at(-1)?.split(/\s+/);
  const uptime = Number(lines[1]), total = kb("MemTotal"), available = kb("MemAvailable");
  const rootTotal = Number(df?.[1]), rootFree = Number(df?.[3]);
  if (!cpu || cpu.length < 8 || cpu.some((x) => !Number.isFinite(x))) return null;
  if (![uptime, total, available, rootTotal, rootFree].every(Number.isFinite) || !total || !rootTotal) return null;
  const [user, nice, system, idle, iowait, irq, softirq, steal] = cpu;
  return {
    os, uptime, totalKB: total, availableKB: available, rootTotalKB: rootTotal, rootFreeKB: rootFree,
    busy: user + nice + system + irq + softirq + steal, ticks: user + nice + system + idle + iowait + irq + softirq + steal,
    disks: lines.filter((x) => x.startsWith("disk ")).map((x) => { const f = x.split(/\s+/); return { name: f[1], sectors: Number(f[2]) + Number(f[3]), busyMs: Number(f[4]) }; }),
  };
}

// Rates need two reads, so the first sample leaves CPU and disk unknown. Same field names as the laptop's sample.
export function remoteSample(prev, cur, now) {
  const seconds = prev ? cur.uptime - prev.uptime : 0, ticks = prev ? cur.ticks - prev.ticks : 0;
  const pairs = seconds > 0 ? cur.disks.map((d) => [d, prev.disks.find((x) => x.name === d.name)]).filter(([, old]) => old) : [];
  const usedPct = (1 - cur.rootFreeKB / cur.rootTotalKB) * 100;
  return {
    remote: true, at: now, remoteTotalGB: cur.totalKB / 1024 ** 2, availableGB: cur.availableKB / 1024 ** 2,
    cpuNow: ticks > 0 ? clampPct(((cur.busy - prev.busy) / ticks) * 100) : null,
    diskPct: pairs.length ? clampPct(Math.max(...pairs.map(([d, old]) => (d.busyMs - old.busyMs) / (seconds * 10)))) : null,
    diskMBs: pairs.length ? pairs.reduce((n, [d, old]) => n + (d.sectors - old.sectors) * 512, 0) / 1024 ** 2 / seconds : null,
    freeCGB: cur.rootFreeKB / 1024 ** 2, usedCPct: clampPct(usedPct), freeDGB: null, usedDPct: null,
  };
}

// Latest values, rates averaged over the rows given: two seconds, enough to stop the meters flickering.
export function summarize(rows, now) {
  const known = (key) => { const list = rows.map((r) => r[key]).filter((x) => x != null); return list.length ? mean(list) : null; };
  return {
    ...rows[rows.length - 1], at: now,
    cpuNow: mean(rows.map((r) => r.cpu)), clock: mean(rows.map((r) => r.clock)),
    diskPct: known("diskPct"), diskMBs: known("diskMBs"),
  };
}

// Each meter stands alone: up to 70 is fine, up to 90 is a warning, above that is critical.
export const meterLevel = (pct) => (pct == null ? null : pct > 90 ? 2 : pct > 70 ? 1 : 0);

// Same meaning as Task Manager's Memory %. Null until the total is known.
export const memoryPct = (s, totalGB) => (totalGB ? clampPct(((totalGB - s.availableGB) / totalGB) * 100) : null);

// The row's three meters. A percent not known yet stays null: an empty meter with an ellipsis.
export function meters(s, totalGB) {
  return [
    { key: "cpu", label: "CPU", pct: s?.cpuNow ?? null },
    { key: "ram", label: "RAM", pct: s ? memoryPct(s, totalGB) : null },
    { key: "disk", label: "DISK", pct: s?.diskPct ?? null },
  ].map((m) => ({ ...m, level: meterLevel(m.pct), text: m.pct == null ? "…" : `${Math.round(m.pct)}%` }));
}

// As the sidebar names them: space · tab.
export const agentLabel = (a) => [a.space_name, a.tab_name].filter(Boolean).join(" · ") || a.title || a.address;

const ORDER = { working: 0, blocked: 1, done: 2, idle: 3 };
export const agentsInOrder = (list) => [...list].sort((a, b) => (ORDER[a.status] ?? 4) - (ORDER[b.status] ?? 4));

export const STATUS = { working: "working", blocked: "blocked", done: "done", idle: "idle" };

export function parseScan(stdout) {
  const list = [];
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const f = line.trim().split("|");
    if (f.length !== 7 && f.length !== 8) continue;
    const [pid, ppid, ws, cpu, age, cline] = [f[0], f[1], f[3], f[4], f[5], f[6]].map(Number);
    if (![pid, ppid, ws, cpu, age].every(Number.isFinite)) continue;
    list.push({ pid, ppid, name: f[2], ws, cpu, age, cline: cline === 1, codex: f[7] === "1" });
  }
  return list.length ? list : null;
}

// Running subagents per session, from the fresh count files. `pid` is the session's claude process, 0 if unknown.
// Null if the scan never reached its end line.
export function parseSubagents(stdout) {
  const text = String(stdout ?? "");
  if (!/^SUB\|end\s*$/m.test(text)) return null;
  return [...text.matchAll(/^SUB\|(\d+)\|(\d+)\s*$/gm)].map((m) => ({ pid: Number(m[1]), running: Number(m[2]) }));
}

// A parent id can be reused on Windows: a "parent" younger than its child is not its parent.
const realParent = (byPid, p) => {
  const parent = byPid.get(p.ppid);
  return parent && !(parent.age > 0 && parent.age + 1 < p.age) ? parent : null;
};

// Codex started by another agent has no Herdr terminal, often only a bash > wsl chain under claude.exe. A shell alone
// that mentions codex is not a run (a grep is not); it needs something that executes, and a chain counts once, by its top.
const RUNNER = /^(wsl|node|codex)/i, DRIVER = /^(claude|herdr-core)/i, NOT_A_RUN = /^(ChatGPT|com\.docker\.backend|codex-windows-sandbox-service)/i;

function countCodexRuns(list, byPid, ownTerminals) {
  const tops = new Set();
  for (const p of list) {
    if (!p.codex || !RUNNER.test(p.name) || NOT_A_RUN.test(p.name)) continue;
    let top = p, driven = false, excluded = false;
    for (let q = realParent(byPid, p), depth = 0; q && depth < 64; q = realParent(byPid, q), depth++) {
      if (NOT_A_RUN.test(q.name) || ownTerminals.has(q.pid)) { excluded = true; break; }
      if (DRIVER.test(q.name)) driven = true;
      if (q.codex) top = q;
    }
    if (driven && !excluded) tops.add(top.pid);
  }
  return tops;
}

export function analyze(list, pids, codexTerminals = [], sessions = []) {
  const byPid = new Map(list.map((p) => [p.pid, p])), kids = new Map();
  for (const p of list) {
    if (realParent(byPid, p) && p.pid !== p.ppid) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p]);
  }
  const inAgents = new Set(), agentBytes = {}, trees = {};
  for (const [address, pid] of Object.entries(pids)) {
    const root = byPid.get(pid);
    if (!root) continue;
    let bytes = 0;
    const todo = [root], tree = trees[address] = new Set();
    while (todo.length) {
      const p = todo.pop();
      if (inAgents.has(p.pid)) continue;
      inAgents.add(p.pid);
      tree.add(p.pid);
      bytes += p.ws;
      todo.push(...(kids.get(p.pid) ?? []));
    }
    agentBytes[address] = bytes;
  }
  const codex = list.filter((p) => /^codex(\.exe)?$/i.test(p.name) && !inAgents.has(p.pid));
  const cline = list.filter((p) => p.cline && !inAgents.has(p.pid));
  const tops = countCodexRuns(list, byPid, new Set(codexTerminals.map((a) => pids[a])));
  const clinePids = list.filter((p) => p.cline).map((p) => p.pid);
  const inTree = (tree, ids) => ids.filter((id) => tree.has(id));
  const perAgent = Object.fromEntries(Object.entries(trees).map(([address, tree]) => [address, {
    subagents: sessions.filter((x) => tree.has(x.pid)).reduce((n, x) => n + x.running, 0),
    codexRuns: inTree(tree, [...tops]).length,
    cline: inTree(tree, clinePids).length,
  }]));
  const strays = list
    .filter((p) => p.pid > 4 && !realParent(byPid, p) && p.age >= STRAY_AGE_S && p.cpu / p.age >= STRAY_SHARE)
    .map((p) => ({ name: p.name, cpuPct: Math.round((p.cpu / p.age) * 100), age: p.age }));
  return {
    agentBytes, strays,
    codex: { count: codex.length, bytes: codex.reduce((n, p) => n + p.ws, 0) },
    cline: { count: cline.length, bytes: cline.reduce((n, p) => n + p.ws, 0) },
    clineRunning: clinePids.length, codexRuns: tops.size, perAgent,
    subagents: sessions.reduce((n, x) => n + x.running, 0),
    others: {
      subagents: sessions.filter((x) => !inAgents.has(x.pid)).reduce((n, x) => n + x.running, 0),
      codexRuns: [...tops].filter((id) => !inAgents.has(id)).length,
    },
    wsl: list.some((p) => /^vmmemWSL/i.test(p.name)),
  };
}

const isKind = (a, word) => `${a.app ?? ""} ${a.program?.key ?? ""}`.toLowerCase().includes(word);
export const isCodex = (a) => isKind(a, "codex");

// The line at the top of the popup. Terminals are Herdr's, subagents come from Claude Code: counted apart, never added.
// `Promote (2 Claude agents, 1 Codex agent)`: zero parts left out.
export function breakdown(claude, codex, cline) {
  const part = (n, word) => (n ? `${n} ${word} agent${n === 1 ? "" : "s"}` : null);
  return [part(claude, "Claude"), part(codex, "Codex"), part(cline, "Cline")].filter(Boolean).join(", ");
}

export function agentLine(a, procs) {
  const own = a.status === "working", more = procs?.perAgent?.[a.address];
  const what = breakdown((own && isKind(a, "claude") ? 1 : 0) + (more?.subagents ?? 0), (own && isCodex(a) ? 1 : 0) + (more?.codexRuns ?? 0), more?.cline ?? 0);
  return what ? `${agentLabel(a)} (${what})` : agentLabel(a);
}

export function othersLine(procs) {
  const what = breakdown(procs?.others?.subagents ?? 0, procs?.others?.codexRuns ?? 0, 0);
  return what ? `Other sessions (${what})` : null;
}

export function workingLine(list, subagents, clineRunning, codexRuns) {
  const working = list.filter((a) => a.status === "working");
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const claude = plural(working.filter((a) => isKind(a, "claude")).length, "agent");
  const codex = codexRuns == null ? "…" : working.filter(isCodex).length + codexRuns;
  return `Claude ${claude} + ${subagents == null ? "… subagents" : plural(subagents, "subagent")} · Codex ${codex} · Cline ${clineRunning ?? "…"}`;
}

export const size = (bytes) => (bytes >= GIB ? `${(bytes / GIB).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);

// What the popup and the bar copy. Names and numbers only: no command line ever reaches `procs`.
export const gb = (x) => (x == null ? "—" : `${x < 100 ? x.toFixed(1) : Math.round(x)} GB`);
export const speed = (x) => (x == null ? "—" : `${x < 10 ? x.toFixed(1) : Math.round(x)} MB/s`);

export function outsideLine(p) {
  return [
    p.codex.count ? `Codex app open ${size(p.codex.bytes)}` : "Codex app closed",
    p.cline.count ? `Cline ${p.cline.count} · ${size(p.cline.bytes)}` : "Cline none",
    p.wsl ? "WSL running" : "WSL stopped",
  ].join(" · ");
}

// TextView drops line breaks, so each line of the popup is its own element.
export const htmlText = (line) => String(line).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function valuesLine(s, totalGB) {
  const pct = (x) => (x == null ? "—" : `${Math.round(x)}%`);
  const head = `CPU ${pct(s.cpuNow)} · RAM ${pct(memoryPct(s, totalGB))} · DISK ${pct(s.diskPct)}`;
  return s.remote ? `${head} · /: ${pct(s.usedCPct)}` : `${head} · C: ${pct(s.usedCPct)} · D: ${pct(s.usedDPct)}`;
}

export const healthLine = (s) => `Commit ${Math.round(s.commitPct)}% · Pagefile ${Math.round(s.pagefilePct)}% · Clock ${Math.round(s.clock)}%`;

export function agentLines(list, procs) {
  const lines = agentsInOrder(list).map((a) => {
    const ram = procs?.agentBytes?.[a.address];
    return `${agentLine(a, procs)} · ${STATUS[a.status] ?? a.status} · ${ram != null ? size(ram) : "—"}`;
  });
  if (othersLine(procs)) lines.push(othersLine(procs));
  return lines.length ? lines : ["no agents"];
}

export const straysLine = (procs) => (procs?.strays?.length ? `Strays: ${procs.strays.map((x) => `${x.name} ${x.cpuPct}% ${age(x.age)}`).join(" · ")}` : null);

export const rowText = (s, totalGB) => meters(s, totalGB).map((m) => `${m.label} ${m.text}`).join("  ");

export function popupText({ s, totalGB, list, procs, label }) {
  const out = [label ?? workingLine(list, procs?.subagents, procs?.clineRunning, procs?.codexRuns)];
  const res = (name, pct, note) => `${name}: ${pct == null ? "—" : `${Math.round(pct)}%`}${note ? ` (${note})` : ""}`;
  if (label != null) {
    if (s) out.push(res("CPU", s.cpuNow), res("Memory", memoryPct(s, totalGB), `${gb(s.availableGB)} free`), res("Disk", s.diskPct, speed(s.diskMBs)), res("Storage /", s.usedCPct, `${gb(s.freeCGB)} free`));
    return out.join("\n");
  }
  if (s) {
    out.push(res("CPU", s.cpuNow), res("Memory", memoryPct(s, totalGB), `${gb(s.availableGB)} free`), res("Disk", s.diskPct, speed(s.diskMBs)),
      res("Storage C:", s.usedCPct, `${gb(s.freeCGB)} free`), res("Storage D:", s.usedDPct, `${gb(s.freeDGB)} free`),
      healthLine(s));
  }
  out.push("Agents:", ...agentLines(list, procs));
  if (procs) out.push(`Outside Herdr: ${outsideLine(procs)}`);
  if (straysLine(procs)) out.push(straysLine(procs));
  return out.join("\n");
}

export function age(seconds) {
  const min = Math.floor(seconds / 60);
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}
