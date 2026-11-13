// Made-up notes for screenshots: `{ "demo": true }` in the block's props. Nothing is read, saved or sent.
const MIN = 60000;

export function demoNotes(now = Date.now()) {
  const note = (id, min, text, files = [], doneMin = null) => ({ id, text, files, createdAt: now - min * MIN, doneAt: doneMin == null ? null : now - doneMin * MIN, space: null, spaceName: null });
  const pin = (id, min, text) => ({ ...note(id, min, text), pinned: true });
  return [
    pin("p1", 4000, "Review the diff on this branch. Bugs first, then naming. Keep it to a short list."),
    pin("p2", 9000, "Run the tests, fix what fails, and open a PR with a short summary."),
    note("a", 2, "The checkout total is wrong when a coupon and free shipping are both active. Reproduce it with the cart in the screenshot, then fix it and add a test.", ["/tmp/demo/cart-total.png"]),
    note("b", 14, "After the fix: run the full backend suite once more and tell me which tests are slow."),
    note("c", 55, "Idea: show the plan name on the invoice PDF.\nAsk for a small mockup first."),
    note("d", 190, "Read docs/CREDENTIALS.md and list every key that no code uses.", ["/tmp/demo/CREDENTIALS.md", "/tmp/demo/env-audit.csv"]),
    note("e", 300, "Rename the Orders page to Purchases in the nav.", [], 42),
    note("f", 420, "Why did the nightly build take 40 minutes?", [], 180),
  ];
}

export const demoAgent = { address: "demo", tab: "demo", tab_name: "shop", status: "idle", program: { name: "Claude Code" }, title: "Fix the checkout total" };
