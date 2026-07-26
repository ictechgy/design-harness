# Terrazzo token-lint evaluation (2026-07)

## Recommendation

**Decision: `INCONCLUSIVE`. Do not add Terrazzo or build a native replacement
from this result.**

Exact `@terrazzo/cli@2.4.0` produced no low-noise validation signal unique to
the current compiler-owned Design Harness token profile. The useful rules
duplicated stricter native gates, several policy rules rejected supported
canonical output, the installed graph narrowed the repository's Node contract,
and the CLI exposed human-output and config-cardinality caveats.

Those observations point away from adoption. The formal label is nevertheless
`INCONCLUSIVE`, not `NO_BUILD`, because the precommitted experiment plan made
the required malformed controls a mandatory validity gate. The exact tool
accepted an undetermined token type and a DTCG-forbidden brace name. A second
raw-config mini-matrix reproduced both behaviors, ruling out the documented
`defineConfig` form as their cause. Under the agreed decision rule, that
mandatory-gate failure controls the label.

This decision authorizes no dependency, permanent gate, native rule, public
command, audit integration, or release work. A future rerun is meaningful only
for an exact Terrazzo release that claims relevant fixes, and still requires a
new owner-approved plan.

## Question and scope

The evaluation asked:

> Does exact `@terrazzo/cli@2.4.0` add material, low-noise validation value for
> Design Harness's current generated `design.tokens.json` beyond the native
> profile, ownership/drift gate, and Style Dictionary compatibility smoke?

The tested input was the current compiler-emitted artifact from
`examples/configs/design-guide.example.yaml`. It remained a generated,
compiler-owned artifact throughout. This was not an evaluation of arbitrary
token-file input, a new CLI surface, full DTCG conformance, rendered design
quality, or accessibility conformance.

No repository package, dependency, lockfile, source, schema, enum, criterion,
finding, score, report runtime, loop, README, version, or release artifact
changed in the experiment.

## Evidence classes and sources

The report keeps four evidence classes separate:

- **Observed behavior:** exact local commands, exits, output channels, hashes,
  inventories, footprint, and timings from the isolated probe.
- **Upstream documentation:** Terrazzo's rule and CLI descriptions.
- **Repository facts:** current Design Harness validators, compiler, drift
  gate, tests, package boundaries, and Node contract.
- **Inference:** the adoption recommendation derived from those observations
  and the precommitted decision rules.

Primary external sources, observed 2026-07-26:

- [exact npm registry document for `@terrazzo/cli@2.4.0`](https://registry.npmjs.org/%40terrazzo%2Fcli/2.4.0)
- [npm attestations for `@terrazzo/cli@2.4.0`](https://registry.npmjs.org/-/npm/v1/attestations/@terrazzo%2fcli@2.4.0)
- [attested source commit `b032980a…`](https://github.com/terrazzoapp/terrazzo/commit/b032980a503033c5dafcf60464470327f65add36)
- [Terrazzo lint documentation](https://terrazzo.app/docs/linting/)
- [Terrazzo CLI reference](https://terrazzo.app/docs/reference/cli/)
- [DTCG Format Module 2025.10](https://www.designtokens.org/TR/2025.10/format/)

The npm metadata declares the package license as MIT. The license inventory
below records package-manifest declarations and is not legal advice.

## Frozen provenance and environment

| Item | Observed value |
| --- | --- |
| Design Harness base/head | `d21eeff11455d5beed2a40270fa789ad9359cac3` |
| Design Harness tree | `0f9f3510e3b6de9cf4e91c35e5c6fbc58e2e7599` |
| OS/architecture | macOS 26.5.2, Darwin 25.5.0, arm64 |
| Node | `v24.14.0` |
| pnpm | `11.9.0` |
| package | `@terrazzo/cli@2.4.0` |
| published | `2026-06-13T00:57:47.267Z` |
| registry SHA-1 | `2e056fb4d3508d66bb04d65ff0cb9bb309536d79` |
| registry integrity | `sha512-NpUIY4qcHpxdx0jVIcCV7fBzmkKi0SyUi/Zx/t9jLKayivfF+7t5q/SUQ1Y6AsmHgjwqqUnexKyWy4hFAbO/xw==` |
| tarball | 15 files; 1,242,704 bytes unpacked |
| attested source | `terrazzoapp/terrazzo@b032980a503033c5dafcf60464470327f65add36` |
| attested workflow | `.github/workflows/release.yml` on `refs/heads/main` |
| canonical token SHA-256 | `5810c111325093d3cfef0c483a3873ffea588dc9f8e53fdbce9a5184d3dbb949` |
| temp lock SHA-256 | `f7ae42f3c9ff75bc12d8818a7e3059f2128deda3f8780aff304241e5dcdca21b` |

The npm attestation endpoint returned both an npm publish attestation and SLSA
provenance v1. Its decoded subject matched the package identity and SHA-512,
and its resolved Git dependency identified the source commit above. The
registry integrity was also present in the isolated pnpm lock.

## Protocol

1. Build the current workspace.
2. Create a private `mktemp -d` root outside the repository.
3. Install only exact `@terrazzo/cli@2.4.0` there with lifecycle scripts
   disabled.
4. Compile the canonical guide into a separate temporary target with the
   current built Design Harness CLI.
5. Copy its compiler-owned `design.tokens.json` into the probe.
6. Use only local token paths and one rule at a time.
7. Run the predeclared T01–T22 matrix, including both `check` and `lint`,
   malformed controls, rule severity, canonical/profile controls,
   no-write proof, diagnostics, footprint, licenses, engines, provenance, and
   three warm timings per valid/invalid alias.
8. Hash each selected input and the complete probe path inventory before and
   after every scripted command.
9. Rerun T06–T09 under raw default config exports after documented
   `defineConfig` diagnostics appeared twice.
10. Remove the temporary root after preserving summarized evidence.

No import, Figma, lab, build, remote-token, or networked runtime command was
used. Network access was limited to the isolated install and explicit
registry/provenance reads.

## T01–T22 results

`PASS` means the planned observation was obtained. `FAIL` means the exact tool
did not satisfy the predeclared negative-control expectation; it does not mean
the row was skipped.

| ID | Status | Result |
| --- | --- | --- |
| T01 | PASS | `tz --version` printed `2.4.0`, exit 0. |
| T02 | PASS | Help listed `check [path]` and `lint [path] (alias of check)`. |
| T03 | PASS | With a minimum local config, canonical `check` and `lint` exited 0 and accepted the root `dev.design-harness` extension. |
| T04 | PASS with caveat | Configured aliases matched semantically. Without a config, `check <path>` exited 0 while `lint <path>` exited 1 demanding a config. |
| T05 | PASS | Malformed JSON made both aliases exit 1 with a local line/column diagnostic. |
| T06 | **FAIL** | Rules off: both aliases accepted a valid inherited type and an invalid undetermined type. `core/required-type`: both aliases rejected both inputs. |
| T07 | PASS | Explicit `core/valid-color` rejected an sRGB component outside `0..1`; rules off accepted it. |
| T08 | PASS | Explicit `core/valid-dimension` rejected a missing unit; rules off accepted it. |
| T09 | **FAIL** | Baseline parsing and `core/consistent-naming` accepted group name `bad{name}` under both aliases. DTCG 2025.10 prohibits braces and periods in token/group names. |
| T10 | PASS | `warn` printed to stderr and exited 0. |
| T11 | PASS | The same finding at `error` printed to stderr and exited 1. |
| T12 | PASS with caveat | Canonical lower-kebab names were clean; a camelCase mutation was detected, but declared `ignore: ["spacing.**"]` did not suppress it under either alias. |
| T13 | PASS / profile rejection | `core/descriptions` rejected all 14 canonical leaves even though `$description` is deliberately unsupported by the current profile. |
| T14 | PASS / profile rejection | `core/duplicate-values` rejected the intentional identical heading/body font stacks. A target-plus-alias control was also reported as a duplicate because the rule did not recognize the parser's normalized `aliasOf`; aliases are outside the current canonical profile. |
| T15 | PASS / no unique signal | Supported-family validity duplicated native checks; `core/required-type` rejected all 14 canonical inherited-type leaves. |
| T16 | PASS with caveat | Canonical sRGB passed. A display-p3 control failed `max-gamut` with implementation option `gamut: "srgb"`, but passed both aliases with the official example's silently ignored `format: "srgb"` option. |
| T17 | PASS / out of scope | A declared canonical text/background pair passed; a synthetic 1.19-ratio pair failed the 4.5 threshold. The current guide has no pair declaration. |
| T18 | PASS | All 33 main scripted runs and all 14 raw-config disambiguation commands preserved selected input hashes and complete path inventories. |
| T19 | PASS with caveats | Success uses stdout; warnings/errors use stderr. `--silent`/`--quiet` suppress warnings. There is no structured-output option; `--json` exits 1 with a Node unknown-option stack. |
| T20 | PASS | All runtime token paths were local and no networked Terrazzo surface ran. |
| T21 | PASS / adoption blocker | Provenance, the 75-package host-installed inventory, and the 154-resolution full-lock inventory were complete, but footprint and engine observations conflict with a low-cost root gate. |
| T22 | PASS | Three warm whole-process samples per valid/invalid alias were recorded. |

### Type and name disambiguation

The raw-config rerun removed the `defineConfig` double-normalization variable:

| Control | raw `check` | raw `lint` |
| --- | ---: | ---: |
| valid inherited type, rules off | 0 | 0 |
| invalid undetermined type, rules off | 0 | 0 |
| valid inherited type, `required-type` | 1 | 1 |
| invalid undetermined type, `required-type` | 1 | 1 |
| invalid color, explicit validity | 1 | 1 |
| invalid dimension, explicit validity | 1 | 1 |
| DTCG-forbidden brace name, naming rule | 0 | 0 |

All 14 raw-config commands retained identical input hashes and inventories.
There was therefore no config form in this exact evaluation that both
preserved DTCG-valid inherited type semantics and rejected the undetermined
type, and the forbidden-name result was reproducible.

### Diagnostic cardinality

Terrazzo's documentation shows configs exported through `defineConfig`.
Following that form caused each configured diagnostic to appear twice:

- one camelCase mutation: `2 warnings` or `2 errors`;
- 14 missing descriptions: `28 errors`;
- 14 inherited-type leaves: `28 errors`;
- one intentional duplicate font value: `2 errors`.

Exporting the equivalent raw config object yielded one diagnostic per defect.
Installed source shows the CLI loading the config module and calling
`defineConfig` again. This is an observed 2.4.0 interface caveat; the
experiment does not infer future-version behavior.

### Rule and option caveats

Additional exact-version controls exposed rule interfaces that did not behave
as their declarations implied:

- `core/consistent-naming` declares `ignore`, but
  `ignore: ["spacing.**"]` did not suppress `spacing.headingFlow` under
  `check` or `lint`. The mutated input SHA-256 was
  `64c873701c7d406c9b67f778a266f2aa9c50c66955ba0aae6949da903493db89`.
- the official `core/max-gamut` example uses `format: "srgb"`, while exact
  2.4.0 reads `gamut`. With `format`, a display-p3 green control passed both
  aliases because the default remained `rec2020`; with `gamut: "srgb"`, both
  aliases rejected it. The control SHA-256 was
  `8d7ab6f1c583098f585faece94460865417d36a7c2a236328f1275fc0ab84cb2`.
- `core/duplicate-values` attempts to exclude aliases, but the parser stores a
  normalized `aliasOf` such as `number.first` while the helper it calls accepts
  only the braced form `{number.first}`. A target-plus-alias control therefore
  exited 1 as a duplicate. This is an exact 2.4.0 interface defect outside the
  current compiler-owned canonical profile.

These are interface and false-positive-control costs, not new product signals.
The selected input hashes were unchanged after all six commands; the complete
post-probe inventory SHA-256 was
`69743568960d8f526a918bea0076f85a1cd2257ab4ef811a6f360955556c7139`.

## Marginal-value comparison

| Terrazzo rule/family | Canonical/control behavior | Current Design Harness gate | Classification |
| --- | --- | --- | --- |
| `core/consistent-naming` | clean canonical; detects camelCase; misses forbidden braces; declared ignore did not suppress | lower-kebab guide validation and compiler-owned drift check | `duplicate` |
| `core/descriptions` | rejects every canonical leaf | `$description` is outside the closed generation profile | `false-positive-for-profile` |
| `core/duplicate-values` | rejects intentional heading/body reuse; alias exclusion also failed | identical role stacks and repeated values are allowed project decisions; canonical profile emits no aliases | `false-positive-for-profile` |
| `core/required-type` | rejects every canonical inherited-type leaf | group-level inheritance is deliberate and DTCG-valid | `false-positive-for-profile` |
| `core/valid-color` | catches explicit malformed input when enabled | stricter closed native color validation | `duplicate` |
| `core/valid-dimension` | catches explicit malformed input when enabled | stricter closed native dimension validation | `duplicate` |
| `core/valid-font-family` | canonical clean | stricter closed native font-family validation | `duplicate` |
| other `core/valid-*` rules | unsupported token families | profile supports only color, fontFamily, and dimension | `unique-out-of-scope` |
| `core/colorspace` | canonical clean; catches display-p3 control | profile requires literal `srgb` | `duplicate` |
| `core/max-gamut` | canonical clean; catches out-of-sRGB control with implementation option; official example silently misses it | profile bounds literal sRGB components | `duplicate` |
| `core/required-children` | can restate fixed groups/count bounds | current schema/profile and compiler already own those bounds | `duplicate` or `false-positive-for-profile` |
| modes/typography/font-size rules | no matching canonical surface | modes, composites, and font-size tokens are excluded | `unique-out-of-scope` |
| `a11y/min-contrast` | works only for explicitly declared pairs | no token-pair field exists; rendered contrast uses separate DOM evidence | `unique-out-of-scope` |

Relevant repository evidence:

- `packages/core/src/design-guide.ts` enforces the closed profile, lower-kebab
  names, literal sRGB/ranges, dimensions, font families, and excluded metadata.
- `packages/core/src/guide-compiler.ts` emits normalized tokens plus the root
  ownership extension.
- `packages/cli/src/guide-targets.ts` validates generated ownership and plans
  all owned outputs.
- `packages/cli/src/guide-run.ts` recompiles and compares generated artifacts
  without writing during `guide check`.
- `scripts/run-guide-smoke.mjs` proves compile idempotence, drift detection,
  and check no-write behavior.
- `scripts/run-guide-compat-smoke.mjs` independently parses and builds every
  generated leaf through exact Style Dictionary 5.5.0.

Ownership validation alone is not semantic linting. The comparison instead
rests on the complete native profile plus drift and independent consumer
smokes. None of the tested Terrazzo rules exposed a plausible, low-noise,
current-profile defect that those gates miss.

## Footprint, licenses, engines, and timing

The isolated installation resolved:

- 18 direct CLI dependencies;
- 75 unique installed packages;
- 72,524 KiB actual `node_modules` disk use on this macOS arm64 host;
- a 47,519-byte temp pnpm lock;
- both `vite@7.3.6` and `vite@8.1.5`;
- `vite-node@5.3.0`.

License declarations across the 75 unique packages:

| Declaration | Count |
| --- | ---: |
| MIT | 57 |
| ISC | 7 |
| BSD-2-Clause | 4 |
| Apache-2.0 | 3 |
| MPL-2.0 | 2 |
| BSD-3-Clause | 2 |
| unknown | 0 |

Those counts describe the packages installed for the current macOS arm64
host. The lock represented 154 package resolutions and snapshots, including
other platform variants. A registry audit resolved all 154 coordinates,
matched every registry integrity to the lock, found repository metadata for
all 154, and found no unknown license declaration. Full-lock declarations
were MIT 125, Apache-2.0 3, BSD-2-Clause 4, ISC 7, MPL-2.0 12,
BSD-3-Clause 2, and 0BSD 1.

The exact CLI package declares no Node engine. Installed Vite, vite-node,
Rolldown, and the platform binding require
`^20.19.0 || >=22.12.0`. Design Harness currently declares Node `>=22.0.0`.
A root install would therefore exclude Node 22.0–22.11 users unless the
repository contract changed. This experiment did not authorize that change.

Exact CLI pinning also did not freeze caret transitives. The evaluation
installed Vite 8.1.5, while planning metadata had observed 8.0.13. A permanent
gate would own that transitive resolution and lock churn.

Warm whole-process timings on the one test machine:

| Command class | Samples (ms) | Median (ms) |
| --- | --- | ---: |
| valid `check` | 184.95, 180.11, 187.48 | 184.95 |
| valid `lint` | 179.30, 178.23, 179.49 | 179.30 |
| malformed `check` | 178.34, 177.71, 172.38 | 177.71 |
| malformed `lint` | 176.13, 174.63, 175.36 | 175.36 |

Terrazzo's printed parse time was about 3–6 ms. The table measures process
startup, Node, config loading, and the CLI together and is not a product
latency claim.

## Decision-rule application

The precommitted mandatory gates resolved as follows:

| Gate | Result |
| --- | --- |
| exact package provenance and installed 2.4.0 | pass |
| canonical tokens pass both aliases | pass with explicit minimum config |
| required malformed controls fail both aliases | **fail at T06 and T09** |
| warn/error behavior observed | pass |
| source SHA and inventory unchanged | pass |
| complete overlap/gap matrix | pass |

The plan says all six must pass or the formal result is `INCONCLUSIVE`.
Although the evidence also meets multiple `NO_BUILD` conditions, relabeling it
would violate that precommitted precedence. The consensus Architect
independently confirmed this interpretation after reviewing the new results
and requested the raw-config rerun above.

Neither follow-up outcome is eligible:

- no current-profile rule demonstrated unique low-noise value;
- canonical false positives remain;
- the contributor Node floor would narrow;
- the footprint and human-only diagnostics add ownership cost;
- the required negative controls did not close.

`INCONCLUSIVE` here does not mean “adopt provisionally.” It means the agreed
experiment cannot issue a positive or final no-build label while its mandatory
control gate is red. The operational recommendation remains: make no product
or dependency change.

## Boundary and possible future gate

No immediate follow-up is scheduled. The smallest technically meaningful
future probe would test only:

1. DTCG-valid inherited type versus truly undetermined type;
2. forbidden `{`, `}`, and `.` names;
3. one-defect diagnostic cardinality under the documented config form.

That probe is justified only for a future exact Terrazzo release whose notes or
source claim relevant fixes. It requires a fresh owner-approved RALPLAN and may
again end with evidence against adoption.

## Limitations

- one exact Terrazzo release and one dependency-resolution date;
- one macOS arm64 machine and Node 24.14.0;
- one compiler-owned canonical Design Harness profile;
- synthetic negative controls;
- no Windows or Linux run;
- no future-version inference;
- decoded registry attestations, but no separate Sigstore verifier;
- manifest-declared license inventory, not legal advice;
- local timings are observational only;
- no claim of full DTCG conformance for either tool;
- no claim that token-pair contrast replaces rendered contrast;
- no dependency, native rule, audit integration, or release action.
