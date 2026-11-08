// Windows branch of the System block: CPU, memory and GPU on this computer, with no Herdr imports so plain Node can
// test the parsing. macOS and Linux keep using load.js; this file is only picked when the app runs on Windows.

// One PowerShell call, sampling the CPU over 1 s like the Unix scripts. PowerShell prints numbers with a dot
// whatever the system language is. GPU is the busiest-engine total of the 3D engines, empty when no GPU counter exists.
export const WINDOWS_SCRIPT = [
  String.raw`$ErrorActionPreference='SilentlyContinue'`,
  String.raw`$c=(Get-Counter '\Processor Information(_Total)\% Processor Utility' -SampleInterval 1 -MaxSamples 1).CounterSamples[0].CookedValue`,
  String.raw`$o=Get-CimInstance Win32_OperatingSystem`,
  String.raw`$g=(Get-Counter '\GPU Engine(*engtype_3D)\Utilization Percentage').CounterSamples|Measure-Object CookedValue -Sum`,
  String.raw`'windows'; "cpu $c"; "mem $($o.FreePhysicalMemory) $($o.TotalVisibleMemorySize)"; "gpu $(if($g.Count){$g.Sum})"`,
].join("; ");
export const WINDOWS_COMMAND = ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCRIPT]];

const clamp = pct => Math.min(100, Math.max(0, pct));
const gb = bytes => `${(bytes / 2 ** 30).toFixed(1)} GB`;

// `out` is the script's output after its first line ("windows"): `cpu <pct>`, `mem <free KB> <total KB>`, `gpu <pct|empty>`.
export function readWindows(out) {
  const line = {};
  for (const l of out.split(/\r?\n/)) {
    const [key, ...rest] = l.trim().split(/\s+/);
    if (key) line[key] = rest;
  }
  const num = (key, i = 0) => (/^\d+(\.\d+)?$/.test(line[key]?.[i] ?? "") ? Number(line[key][i]) : null);
  const cpuRaw = num("cpu");
  if (cpuRaw === null) throw new Error("Windows load: no CPU reading");
  const cpu = clamp(cpuRaw);
  const free = (num("mem", 0) ?? 0) * 1024, total = (num("mem", 1) ?? 0) * 1024;
  const used = Math.max(0, total - free);
  const gpuRaw = num("gpu");
  return {
    cpu: { pct: cpu, tip: `CPU ${Math.round(cpu)}%` },
    ram: { pct: total ? clamp(used / total * 100) : 0, tip: `Memory ${gb(used)} of ${gb(total)} used` },
    gpu: gpuRaw === null ? null : { pct: clamp(gpuRaw), tip: `GPU ${Math.round(clamp(gpuRaw))}% busy` },
  };
}
