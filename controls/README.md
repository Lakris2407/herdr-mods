# Controls for Herdr

One menu to turn any status-bar block, any tab-bar button and any side-panel button off and on. Hide
the quota on a small screen, drop Files, Changes or Skills if you never use them, bring them back with
one click.

![Controls](preview.png)

- A small sliders button at the right end of the status bar opens the menu. `cmd-shift-,` does too, and
  so does a right-click on a panel button once the tab bar is patched.
- **Status bar:** every block in your status row, with a tick when it shows. Click to hide or show it
  at once. Herdr saves that with your layout, so it stays after a restart.
- **Tab bar buttons:** every mod block beside the tabs, such as the Skills toggle. Click to hide or
  show it at once, like a status block. Hiding a button also closes the panel it opens.
- **Side panel buttons:** every panel in your side-panel stack. Click to take its button out of the
  tab bar; the panel closes if it was open. This needs a small patch to your `tabs-plus` tab bar:
  [tabs-plus.md](tabs-plus.md).
- A hidden block keeps running until Herdr starts again; from then on it does no work at all.

It reads your layout and lists what is in it, so it works with any mods, not only the ones in this repo.

## Install

Ask the agent running in Herdr: "add the Herdr mod at github.com/Lakris2407/herdr-mods/tree/main/controls". Or by hand,
after the [one-time setup](../README.md#one-time-setup):

1. Copy `mods/controls` to `~/.config/herdr-app/mods/controls` and run
   `herdr-app check ~/.config/herdr-app/mods/controls`.
2. Put the button at the end of the status row in `~/.config/herdr-app/layouts/main-plus.json`:

   ```json
   { "id": "status-controls", "type": "block", "content": { "mod": "controls", "props": { "view": "button" } },
     "size": { "px": 30 }, "min": 30 }
   ```

3. Merge [`keys.json`](keys.json) into `~/.config/herdr-app/keys.json` for `cmd-shift-,`.
4. For the panel buttons, patch `tabs-plus` as in [tabs-plus.md](tabs-plus.md).

## What it runs

Nothing outside Herdr: it reads the shown layout and runs `layout.hide`, `layout.show` and
`mod.open`. It writes one shared value, `tabs-plus.hidden`, the panel buttons you turned off.
