// The poster look of the panel, shown while the `poster` theme is on (themes/poster.json), or with
// `{ "look": "poster" }` in the block's props: square white cards with thin borders, two big numbers
// in a pixel font, and the last 8 weeks as tall black bars with this week in the accent color.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { readable } from "./colors.js";
import { posterNumbers, num, POSTER_WEEKS } from "./stats.js";

// Ships in fonts/ (SIL Open Font License); Herdr loads a mod's fonts by itself.
const PIXEL = "Silkscreen";
const PLOT = 260;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (t) => { const d = new Date(t); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const prs = (n) => `${num(n)} PR${n === 1 ? "" : "s"}`;

// A square card with a 1px border, the poster's one container.
export const posterCard = (t) => v_flex().bg(t.raised).border_1().border_color(t.border);

// The card's title row: a name on the left, a quieter note (text or an element) on the right, a
// divider under both.
export const posterTitle = (title, note, t, ink) => h_flex().h(44).flex_none().px(14).gap(8).items_center()
  .border_b(1).border_color(t.border)
  .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().child(title))
  .when(note != null, (e) => e.child(typeof note === "string"
    ? div().flex_none().text_size(14).text_color(ink.label).child(note) : note.flex_none()));

function big(id, value, label, tip, ink) {
  return v_flex().id(id).gap(4).tooltip(tip).accessibility_label(`${value} ${label}. ${tip}`)
    .child(div().font_family(PIXEL).font_weight(700).text_size(32).line_height(1).child(value))
    .child(div().text_size(13).text_color(ink.label).child(label));
}

// The numbers and the bars. Bars carry no labels, as in the poster: each has its week and count as a
// tooltip, and a screen reader gets the whole chart as one sentence.
export function posterHero(s, t, ink) {
  const { weeks, merged, aiShare } = posterNumbers(s);
  const now = weeks.length - 1, max = Math.max(1, ...weeks.map((w) => w.merged));
  const lit = readable(t.accent, t.raised, 3);
  const tip = (w, n) => (n === now ? `This week so far: ${prs(w.merged)} merged` : `Week of ${short(w.start)}: ${prs(w.merged)} merged`);
  const ai = s.ai.total ? `Last 30 days: ${num(s.ai.total - s.ai.none)} of ${prs(s.ai.total)} carry a Claude or Codex mark` : "No PRs merged in the last 30 days";
  return posterCard(t)
    .child(posterTitle("Your stats", `${POSTER_WEEKS} weeks`, t, ink))
    .child(v_flex().px(14).pt(16).pb(14).gap(20)
      .child(h_flex().gap(28).items_start()
        .child(big("poster-merged", num(merged), "PRs merged", `PRs merged in the last ${POSTER_WEEKS} weeks, this week included`, ink))
        .child(big("poster-ai", aiShare == null ? "—" : `${aiShare}%`, "AI share", ai, ink)))
      .child(h_flex().id("poster-weeks").role("image").h(PLOT).items_end().gap(6)
        .accessibility_label(`PRs merged per week: ${weeks.map((w, n) => `${n === now ? "this week" : short(w.start)} ${w.merged}`).join(", ")}.`)
        .children(weeks.map((w, n) => v_flex().id(`poster-week-${n}`).flex_1().min_w(0).h_full().justify_end().tooltip(tip(w, n))
          .child(div().w_full().h(Math.max(2, Math.round(PLOT * w.merged / max)))
            .bg(n === now ? lit : w.merged > 0 ? t.foreground : ink.hint))))));
}
