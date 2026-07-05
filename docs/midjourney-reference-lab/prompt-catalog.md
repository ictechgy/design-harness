# Midjourney Reference Lab Prompt Catalog

These prompts are starting points for manual reference generation. Replace bracketed values and keep prompts generic.

Do not prompt for specific brands, products, real companies, living artists, private people, private screenshots, or proprietary design systems.

## Prompt Pattern

```text
Generic [ui archetype] interface for [domain], focused on [quality target].
Show [state or workflow], with [density/layout constraint], [accessibility/readability constraint],
and [good/bad/ambiguous condition]. No logos, no brand names, no real product references,
no private data, no recognizable people.
```

## Dense Dashboard Scanability

Good target:

```text
Generic operational dashboard interface for local commerce inventory review, focused on fast scanability.
Show grouped metrics, a compact table, readable hierarchy, clear status chips, and large enough controls.
No logos, no brand names, no real product references, no private data, no recognizable people.
```

Bad target:

```text
Generic operational dashboard interface for local commerce inventory review, intentionally hard to scan.
Show overcrowded cards, weak grouping, tiny controls, long table labels, and unclear priority.
No logos, no brand names, no real product references, no private data, no recognizable people.
```

Ambiguous target:

```text
Generic operational dashboard interface for local commerce inventory review with mixed quality.
Show useful grouping but competing priorities, some unclear labels, and one overloaded action area.
No logos, no brand names, no real product references, no private data, no recognizable people.
```

## Mobile Checkout Clarity

Good target:

```text
Generic mobile checkout interface for a small local service booking flow, focused on clarity and trust.
Show price summary, delivery or appointment details, clear primary action, and readable form spacing.
No logos, no brand names, no real product references, no private data, no recognizable people.
```

Bad target:

```text
Generic mobile checkout interface for a small local service booking flow, intentionally confusing.
Show competing calls to action, dense copy, unclear fees, small tap targets, and weak error affordances.
No logos, no brand names, no real product references, no private data, no recognizable people.
```

## Empty And Error States

Good target:

```text
Generic SaaS empty state for a task list, focused on useful next action and calm hierarchy.
Show concise explanation, one clear action, and enough surrounding context to understand the state.
No logos, no brand names, no real product references, no private data, no recognizable people.
```

Bad target:

```text
Generic SaaS error state for a task list, intentionally unhelpful.
Show vague error wording, no recovery path, weak visual hierarchy, and ambiguous action labels.
No logos, no brand names, no real product references, no private data, no recognizable people.
```

## Review Notes

After generation, record what the reference helped reveal:

- layout condition,
- interaction condition,
- likely current criterion mapping,
- false-positive concern,
- future criterion candidate,
- whether the output should stay local-only.
