/**
 * Deterministic control corpora for the instrument probe.
 *
 * Three corpora, all answering the same one-line brief:
 *
 *   "A dashboard screen showing three key metrics and one primary action."
 *
 * - `identical`   every member is byte-identical. Distance must bottom out at 0.
 *                 This is the floor sanity check, not a realistic corpus.
 * - `convergent`  every member repeats one generic layout and differs only in
 *                 copy. This is the probe's stand-in for slop: same brief, same
 *                 solution, N times.
 * - `divergent`   every member answers the same brief with a different design
 *                 decision set: layout mode, palette, type scale, radius
 *                 language, and composition all differ.
 *
 * Nothing here is a real AI generation. These are hand-designed controls whose
 * answer is known in advance, which is exactly why they can validate an
 * instrument and cannot support a product claim.
 *
 * Generation is seeded and byte-reproducible so the probe never needs to commit
 * fixture files.
 */

import { CORPUS_SEED, CORPUS_SIZE, createRandom, pick } from "./contract.mjs";

export const BRIEF = "A dashboard screen showing three key metrics and one primary action.";

const SUBJECTS = [
  ["Revenue", "Orders", "Refunds", "Export report"],
  ["Sessions", "Signups", "Churn", "Create campaign"],
  ["Tickets", "Resolved", "Backlog", "Assign queue"],
  ["Shipments", "Delayed", "Returned", "Print labels"],
  ["Balance", "Payouts", "Disputes", "Start payout"],
  ["Storage", "Bandwidth", "Errors", "Upgrade plan"],
  ["Listings", "Views", "Offers", "Publish draft"],
  ["Members", "Active", "Invited", "Send invite"],
  ["Builds", "Passing", "Failing", "Rerun pipeline"],
  ["Invoices", "Paid", "Overdue", "Send reminder"],
  ["Devices", "Online", "Alerts", "Push update"],
  ["Courses", "Enrolled", "Dropped", "Open roster"]
];

/**
 * The generic solution. Every convergent member uses exactly this structure,
 * these class names, this palette, this type scale, and this spacing scale --
 * the shape the ideas-log entry calls "the same card grid".
 */
function convergentMember(subject, index) {
  const [first, second, third, action] = subject;
  const values = [1240 + index * 7, 318 + index * 3, 12 + index];
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${first} overview</title>
<style>
body { margin: 0; padding: 32px; background: #f8fafc; color: #0f172a; font-family: Inter, sans-serif; font-size: 14px; }
h1 { font-size: 24px; font-weight: 600; margin: 0 0 24px; }
.grid { display: grid; gap: 16px; }
.card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; }
.label { font-size: 12px; font-weight: 500; color: #64748b; margin: 0 0 8px; }
.value { font-size: 32px; font-weight: 700; margin: 0; }
.cta { display: inline-block; margin: 24px 0 0; padding: 12px; background: #4f46e5; color: #ffffff; border-radius: 8px; font-size: 14px; font-weight: 600; }
</style>
</head>
<body>
<h1>${first} overview</h1>
<div class="grid">
<div class="card"><p class="label">${first}</p><p class="value">${values[0]}</p></div>
<div class="card"><p class="label">${second}</p><p class="value">${values[1]}</p></div>
<div class="card"><p class="label">${third}</p><p class="value">${values[2]}</p></div>
</div>
<a class="cta" href="/action">${action}</a>
</body>
</html>
`;
}

/** Each divergent member owns a disjoint design vocabulary. */
const DIVERGENT_STYLES = [
  {
    id: "dense-table",
    build: ([a, b, c, action], values) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${a}</title>
<style>
body { margin: 0; padding: 8px; background: #101418; color: #d8dee4; font-family: "IBM Plex Mono", monospace; font-size: 11px; }
table { border-collapse: collapse; width: 100%; }
th { font-size: 10px; font-weight: 400; text-align: left; padding: 4px; color: #7d8794; }
td { padding: 4px; font-size: 13px; font-weight: 500; border-top: 1px solid #232a31; }
button { margin: 8px 0 0; padding: 4px; background: #232a31; color: #d8dee4; border-radius: 2px; font-size: 11px; font-weight: 400; }
</style></head>
<body><table><tr><th>${a}</th><th>${b}</th><th>${c}</th></tr>
<tr><td>${values[0]}</td><td>${values[1]}</td><td>${values[2]}</td></tr></table>
<button>${action}</button></body></html>
`
  },
  {
    id: "editorial-stack",
    build: ([a, b, c, action], values) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${a}</title>
<style>
body { margin: 0; padding: 96px; background: #fffdf7; color: #1b1a17; font-family: Georgia, serif; font-size: 18px; }
h1 { font-size: 64px; font-weight: 400; margin: 0 0 48px; }
dl { display: block; margin: 0; }
dt { font-size: 15px; font-weight: 400; margin: 32px 0 0; }
dd { font-size: 44px; font-weight: 400; margin: 0; }
a { display: block; margin: 64px 0 0; padding: 0; font-size: 18px; font-weight: 400; border-radius: 0; color: #8a2f22; }
</style></head>
<body><h1>${a}</h1><dl><dt>${a}</dt><dd>${values[0]}</dd><dt>${b}</dt><dd>${values[1]}</dd><dt>${c}</dt><dd>${values[2]}</dd></dl>
<a href="/go">${action}</a></body></html>
`
  },
  {
    id: "sidebar-rail",
    build: ([a, b, c, action], values) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${a}</title>
<style>
body { margin: 0; padding: 0; background: #eef2f0; color: #22302c; font-family: "Work Sans", sans-serif; font-size: 15px; display: flex; }
nav { padding: 20px; background: #22302c; color: #eef2f0; font-size: 13px; font-weight: 600; }
main { padding: 40px; display: flex; }
section { padding: 0 40px 0 0; }
strong { display: block; font-size: 28px; font-weight: 800; }
em { font-size: 12px; font-weight: 600; }
form { padding: 20px 0 0; }
input { padding: 10px; border-radius: 999px; font-size: 15px; font-weight: 600; background: #4f7a68; color: #ffffff; }
</style></head>
<body><nav>${a}</nav><main>
<section><em>${a}</em><strong>${values[0]}</strong></section>
<section><em>${b}</em><strong>${values[1]}</strong></section>
<section><em>${c}</em><strong>${values[2]}</strong></section>
</main><form><input type="submit" value="${action}"></form></body></html>
`
  },
  {
    id: "poster-hero",
    build: ([a, b, c, action], values) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${a}</title>
<style>
body { margin: 0; padding: 0; background: #120b1f; color: #f4e9ff; font-family: Futura, sans-serif; font-size: 16px; }
header { padding: 140px 48px 48px; background: #2d1155; }
h2 { font-size: 88px; font-weight: 900; margin: 0; }
ul { padding: 48px; margin: 0; display: inline-flex; }
li { padding: 0 56px 0 0; font-size: 20px; font-weight: 300; }
b { font-size: 52px; font-weight: 900; }
footer { padding: 0 48px 96px; }
span { padding: 18px; background: #f4e9ff; color: #120b1f; border-radius: 4px; font-size: 16px; font-weight: 900; }
</style></head>
<body><header><h2>${a}</h2></header>
<ul><li>${a} <b>${values[0]}</b></li><li>${b} <b>${values[1]}</b></li><li>${c} <b>${values[2]}</b></li></ul>
<footer><span>${action}</span></footer></body></html>
`
  },
  {
    id: "terminal-log",
    build: ([a, b, c, action], values) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${a}</title>
<style>
body { margin: 0; padding: 12px; background: #000000; color: #33ff66; font-family: Menlo, monospace; font-size: 12px; }
pre { margin: 0; padding: 0; font-size: 12px; font-weight: 400; }
kbd { padding: 2px; border-radius: 1px; background: #33ff66; color: #000000; font-size: 12px; font-weight: 700; }
</style></head>
<body><pre>${a}  ${values[0]}
${b}  ${values[1]}
${c}  ${values[2]}</pre>
<kbd>${action}</kbd></body></html>
`
  },
  {
    id: "card-carousel",
    build: ([a, b, c, action], values) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${a}</title>
<style>
body { margin: 0; padding: 56px; background: #fef6f0; color: #3d2b22; font-family: Nunito, sans-serif; font-size: 17px; }
h3 { font-size: 34px; font-weight: 700; margin: 0 0 40px; }
article { display: inline-block; padding: 36px; background: #ffe3d0; border-radius: 28px; }
figure { margin: 0; padding: 0; }
figcaption { font-size: 14px; font-weight: 700; }
output { font-size: 40px; font-weight: 400; }
label { display: block; padding: 40px 0 0; font-size: 17px; font-weight: 700; color: #b8482a; border-radius: 28px; }
</style></head>
<body><h3>${a}</h3>
<article><figure><figcaption>${a}</figcaption><output>${values[0]}</output></figure></article>
<article><figure><figcaption>${b}</figcaption><output>${values[1]}</output></figure></article>
<article><figure><figcaption>${c}</figcaption><output>${values[2]}</output></figure></article>
<label>${action}</label></body></html>
`
  }
];

function divergentMember(subject, index) {
  const style = DIVERGENT_STYLES[index % DIVERGENT_STYLES.length];
  const random = createRandom(CORPUS_SEED + index * 977);
  const values = [
    Math.floor(random() * 9000) + 100,
    Math.floor(random() * 900) + 10,
    Math.floor(random() * 90) + 1
  ];
  return style.build(subject, values);
}

/**
 * Build the three control corpora.
 *
 * `pick` is exercised so the seeded PRNG contract stays live; corpus identity
 * itself is index-driven so every member is distinct and reproducible.
 */
export function buildCorpora() {
  if (CORPUS_SIZE > DIVERGENT_STYLES.length) {
    throw new Error(
      `CORPUS_SIZE ${CORPUS_SIZE} exceeds ${DIVERGENT_STYLES.length} distinct divergent styles; ` +
        "the divergent corpus would contain duplicate-design pairs and could not be a divergent control"
    );
  }

  const identicalSource = convergentMember(SUBJECTS[0], 0);
  const random = createRandom(CORPUS_SEED);
  const orderCheck = pick(random, SUBJECTS)[0];

  return {
    brief: BRIEF,
    orderCheck,
    corpora: {
      identical: Array.from({ length: CORPUS_SIZE }, () => identicalSource),
      convergent: Array.from({ length: CORPUS_SIZE }, (_unused, index) =>
        convergentMember(SUBJECTS[index % SUBJECTS.length], index)
      ),
      divergent: Array.from({ length: CORPUS_SIZE }, (_unused, index) =>
        divergentMember(SUBJECTS[index % SUBJECTS.length], index)
      )
    }
  };
}
