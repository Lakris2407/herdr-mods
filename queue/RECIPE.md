# Queue

A side panel that holds notes and prompts until you send them: a field to write in, the waiting
notes with their files, and the done ones below. Send pastes a note into an agent's terminal and
presses Enter.

![Queue (demo data)](preview.png)

## What you see

- **Header** (42 px, 1 px `border` bottom): "Queue" in semibold and one status in 11 px: "4
  waiting", "Sending…", or for four seconds what just happened ("Sent to Claude Code · Fix the
  checkout total" in the ok color, a failed send in the fail color, an unsaved change in the
  warning color).
- **Key line:** only while the panel has the keyboard, "↑ ↓ move · Enter runs · N writes · Esc
  leaves" under the header in 10 px.
- **Field** (a `raised` card, 8 px radius): a text area on `background` with a 1 px border that
  takes the ring color while you type, growing from 2 to 10 rows. Under it the attached files, then
  one line: a hint at the left ("Drop files here, or paste a screenshot"; while typing "⌘↵ adds ·
  Esc leaves the field") and **Add** at the right, dim while there is nothing to add. While a note
  is edited the card says "Editing a note", the note's card gets a ring-colored border, and the
  buttons read **Cancel** and **Save**.
- **Target line** (11 px): "Send goes to" in the hint color, then the agent in the text color: its
  program and its own title. With no agent: "Click an agent's terminal to choose where Send goes."
- **Search** (28 px, 1 px border): only from six notes on, or while a search is typed.
- **A note** (a `raised` card): the text in 13 px, at most six lines or 420 characters (a click
  shows the rest); its files as 22 px chips on `background` with the file name, the path in the
  tooltip, and a pasted image as a 44 px thumbnail that a click shows large in a dialog (90% of
  the window, the image fitted, at most twice its pixels); then a line with its age at the left and
  **Send** (the one filled button), **Copy**, **Edit** and **Done** at the right in 11 px. Send is
  dim with no agent, and reads "Sending…" while it runs.
- **Done:** a heading "Done · 2" with **Clear done** at the right, then the done notes, last done
  first, their text in the hint color, with "Done 42m ago", **Restore** and **Delete**.
- **Empty states:** "Nothing waits here yet. Write a prompt above now, and send it when an agent is
  free.", "The queue is empty. The notes below are done.", "No note matches the search."
- **Readable colors** (`colors.js`): labels 6:1 and hints 4.5:1 on `raised`, the focus ring 3:1.
- **Type scale:** 10 (key line), 11 (status, hints, buttons, chips), 12 (search), 13 (note text,
  field, title).

## How it behaves

- Notes are `{ id, text, files, createdAt, doneAt }` in `queue.json` in Herdr's home, written as
  `{ "version": 1, "notes": [...] }`. A new note goes on top. Every change shows at once and is then
  saved; saves run one after the other. Each save names the text it expects to replace
  (`writeTextFile`'s third argument), so a change made by another copy is never written over: the
  panel says the change was not saved and loads the file again. After a save the panel sets shared
  state `queue.rev`, and every other copy loads the file within three seconds.
- A file that is not valid JSON shows an error and blocks every change until it is fixed.
- The draft in the field is kept in `localStorage` (`draft`) until it is added.
- Dropped files (`on_drop` on the root) are kept as paths. A paste with no text (`paste_other`)
  runs `osascript`: the clipboard's PNG is written to `queue-files/<uuid>.png`; without one, the
  clipboard's file reference is used when that path exists. A pasted image is deleted when the last
  note that holds it is deleted, and when it leaves the field without having been added.
- Send runs `hc send --json -- <terminal> <text>`. The text is the note, a blank line, then one
  path per line. On success the note is marked done; on failure it stays and the header says why
  and what to do (the agent is gone, the agent waits for an answer, `hc` is missing).
- The target is the agent whose terminal last had the keyboard (`focused().terminal`, remembered),
  else the only agent in the shown tab, else none. A shell is never a target.
- A thumbnail's click opens the same mod as a dialog with `props.viewer` (`{ picture, size }`): it
  draws only the image, fitted to the dialog (`sips` reads the pixel size on macOS), and a click
  or Escape closes it.
- Copy writes the same text to the clipboard and marks the note done.
- Only done notes can be deleted.
- `"focusable": true`: `pane.go` gives the panel the keyboard. Every button registers in reading
  order while the panel renders, with a role and a screen-reader label; ↑/↓ move a 2 px ring, Enter
  or Space presses, N focuses the field, ← and → run `pane.go` that way, Escape runs `pane.go`
  toward the terminals, and Escape in a text field gives the keyboard back to the panel.
  `queue.new` (`herdr-app do queue.new`) focuses the field.
- A three-second timer does the reload after another copy's save, clears the status after four
  seconds and keeps the ages true; it redraws only for those.

## Built from

- One mod, `mods/queue`, `mod.json` `{ "place": "none", "title": "Queue", "focusable": true }`, shown as a
  block in the side panel stack (`panel-body`) of a cloned layout, with a button in a cloned tab bar.
- `herdr` API: `hc` (`hc send`), `exec` (`osascript`, `sips`), `openOverlay` / `closeOverlay`, `settings`, `window`, `readTextFile` / `writeTextFile`, `appHome`,
  `agents`, `focused`, `layout`, `run` (`pane.go`), `theme`, `shared` / `setShared`, `nextCommand`;
  `fs/promises` (`mkdir`, `unlink`, `exists`); `TextareaState` + `Textarea`, `InputState` + `Input`,
  `image`, `.on_drop`, `cx.write_to_clipboard`.
- `notes.js` is pure (no `herdr` imports), so `node --test` covers the queue's logic. `store.js`
  reads and writes; `demo.js` has the made-up notes.

## Watch out

- `hc send` presses Enter. Never send to a terminal that is not an agent.
- Put `--` before the terminal and the text, or a note that starts with a dash is read as an option.
- AppleScript turns clipboard text into a file reference without complaint; use the reference only
  when that path exists.
- A text area takes its own presses: stop the mouse-down on its wrapper, and track its `focus` and
  `blur` so the panel's own keys (N, Enter, the arrows) do nothing while you type.
- `image()` takes a path inside Herdr's home, which is why only pasted images get a thumbnail.

## Done when

- `herdr-app check mods/queue` passes and `node --test` passes.
- A note you add is in `queue.json` and is still there after Herdr restarts.
- With an agent's terminal clicked, Send puts the note and its files' paths into that agent and the
  note moves to Done; with only a shell in the tab, Send is dim.
- A screenshot pasted in the field shows as a thumbnail, and its file is gone from `queue-files/`
  after its note is deleted.
- The keyboard reaches every button in reading order.
