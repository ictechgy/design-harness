# UI/UX Quality Basis For Design Harness

Date: 2026-07-04

This document summarizes research that Design Harness can use when evaluating UI/UX quality. The goal is not to turn design taste into a fake objective score. The goal is to connect findings to evidence, sources, and clear confidence levels so humans and AI coding agents can make better UI revisions.

## Core Position

Design Harness should use a layered quality model:

1. Accessibility and operability: strongest basis for deterministic checks.
2. Usability heuristics: useful for risks and review prompts.
3. Human-centered task fit: requires a design brief or task context.
4. Visual craft: useful for critique, but mostly heuristic or subjective.
5. Agent compatibility: promising and relevant, but non-normative.

## Source Strength

| Strength | Meaning | Example sources | Allowed use |
| --- | --- | --- | --- |
| `official-testable` | Standard-like source with testable criteria | WCAG 2.2 | Deterministic failure or risk, scoped to implemented checks |
| `official-pattern` | Official or institutional practice guidance | ISO 9241-210, GOV.UK Design System | Architecture, process, recommendations, review prompts |
| `industry-heuristic` | Widely used professional heuristic guidance | Nielsen Norman Group, IBM Carbon, Shopify Polaris | Heuristic risk, report guidance, fixture inspiration |
| `research-emerging` | Current research that may inform product direction | arXiv:2605.02729 | Exploratory framing, not pass/fail language |
| `philosophical` | Design principles or aesthetic philosophy | Vitsoe / Dieter Rams | Optional critique language only |

Only `official-testable` criteria should support deterministic pass/fail language. Pattern libraries, heuristics, research papers, and design philosophy should support recommendations, risks, or review prompts.

## Research Notes

### WCAG 2.2

WCAG 2.2 is the strongest basis for machine-checkable accessibility criteria. It defines technology-neutral success criteria and includes areas such as contrast, reflow, focus, keyboard accessibility, timing, moving content, input assistance, and text alternatives.

Design Harness implication:
- Keep expanding deterministic accessibility checks.
- Avoid claiming full WCAG conformance unless the harness explicitly covers the required level.
- Phrase findings as scoped checks, such as "this contrast check failed the configured WCAG-derived threshold."

Source: https://www.w3.org/TR/WCAG22/

### ISO 9241-210

ISO 9241-210 frames human-centered design as understanding users, tasks, environments, and evaluation throughout the lifecycle.

Design Harness implication:
- Treat the design brief as first-class context.
- Do not make task-fit claims when no task context exists.
- Mark task-fit findings as heuristic unless direct evidence supports them.

Source: https://www.iso.org/standard/77520.html

### Nielsen Norman Group Usability Heuristics

NN/g's usability heuristics are useful lenses for status visibility, consistency, error prevention, recognition over recall, user control, recovery, and minimalist design.

Design Harness implication:
- Map heuristics to review prompts and medium/low-confidence risks.
- Do not convert every heuristic into a hard audit failure.

Source: https://www.nngroup.com/articles/ten-usability-heuristics/

### GOV.UK Design System

GOV.UK emphasizes reusable accessible components, service patterns, small-screen-first layouts, and readable line lengths.

Design Harness implication:
- Add layout and readability checks such as narrow viewport reflow and excessive line length.
- Use GOV.UK as an operational reference, not as a visual style to clone.

Sources:
- https://design-system.service.gov.uk/
- https://design-system.service.gov.uk/styles/layout/

### IBM Carbon And Shopify Polaris

Carbon and Polaris both connect accessibility to product quality. Their guidance highlights keyboard use, focus management, cognitive load, native controls, and integrated task-flow testing.

Design Harness implication:
- Add checks for accessible names, focus risks, native semantics, and custom control risks.
- Test integrated task flows when the harness supports scripted scenarios.

Sources:
- https://carbondesignsystem.com/guidelines/accessibility/overview/
- https://polaris.shopify.com/foundations/accessibility

### Agent-Compatible Interfaces

The paper "Augmenting Interface Usability Heuristics for Reliable Computer-Use Agents" (`arXiv:2605.02729`) argues that agent-compatible UI design can improve computer-use agent reliability. This is relevant to Design Harness, but it is emerging research and should not be treated like a standard.

Design Harness implication:
- Encourage semantic HTML, explicit labels, visible state, and stable controls.
- Frame these as human usability and accessibility improvements first, with agent reliability as an additional benefit.

Source: https://arxiv.org/abs/2605.02729

### Dieter Rams / Vitsoe

Rams' principles are useful for critique language: useful, understandable, unobtrusive, thorough, and restrained. They are not browser-testable standards.

Design Harness implication:
- Use these ideas for optional subjective critique.
- Do not emit hard failures based on philosophical criteria.

Source: https://www.vitsoe.com/us/about/good-design

## Recommended Criteria Families

### Accessibility And Operability

Candidate checks:
- Text contrast and non-text contrast risks.
- Missing accessible names for buttons, links, inputs, and icon-only controls.
- Missing programmatic labels for form controls.
- Missing alt text for informative images.
- Focus visibility and risky tabindex usage.
- Keyboard trap indicators and unreachable controls.
- Color-only status or error communication.
- Missing dynamic status/error announcement patterns.

### Responsiveness And Layout

Candidate checks:
- Reflow at narrow widths such as 320 CSS px.
- Horizontal overflow and fixed-width container risk.
- Text clipping and truncation without affordance.
- Excessive line length for reading-heavy content.
- Sticky/fixed elements obscuring content.
- Tap target risk where geometry is available.

### Information Architecture And Hierarchy

Candidate checks:
- Missing, duplicate, empty, or skipped headings.
- Missing landmark structure.
- Low meaningful text density.
- Repeated generic labels.
- Weak grouping for forms, tables, lists, and dashboards.

### Interaction And State

Candidate checks:
- Buttons and links without visible affordance.
- Disabled controls without explanation.
- Forms with no visible validation or recovery path.
- Missing loading, saving, empty, error, and success states.
- Custom controls that do not expose native semantics.
- Unexpected focus movement or modal focus risks.

### Content And Task Fit

Candidate checks:
- Brief-to-page mismatch.
- Required workflow steps hidden behind unclear labels.
- Jargon or vague CTA text in task-critical locations.
- No visible next step for the primary task.

### Visual Polish

Candidate checks:
- Spacing rhythm inconsistencies.
- Alignment drift across repeated components.
- Unclear typography scale.
- Palette contrast and color token inconsistency.
- Decoration that reduces readability or task focus.

## Report Language Rules

Reports should avoid unqualified claims such as:

- "WCAG compliant"
- "accessible"
- "good design"
- "best practice violation"
- "objectively better"

Preferred language:

- "This observed element failed the configured contrast threshold."
- "This captured DOM may lack an accessible name."
- "This is a heuristic readability risk and should be reviewed."
- "This optional subjective critique is not an audit failure."

## Harness Design Decision

Design Harness should make criteria first-class objects. Every finding should point to a criterion, sources, determinism level, result kind, confidence, viewport, evidence, and remediation hint.

This gives the project a durable path from research to implementation without overclaiming what automated UI/UX evaluation can prove.
