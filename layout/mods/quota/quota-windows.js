// Keep all reported windows in the cache; this preference only controls presentation.
export function visibleWindows(provider, options) {
  return provider.windows.filter(window => provider.id !== "agy"
    || options.agyClaudeGpt !== false
    || !window.id?.startsWith("claude_gpt_"));
}
