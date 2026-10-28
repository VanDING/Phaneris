# Run context content and metering integrity

## Metered composition follow-up — recorded before implementation

The separate text-estimate bars and input line exposed a large estimate gap.
Final history must use one metered composition, with uncertain attribution
visible instead of normalizing unchanged content or drawing a second total.

## Final metered-composition verification

- **54 workflow checks passed**: integrity 9, accounting/palette 9, broad Run 36.
- Every one of the real session's **136** composition sums equals recorded input.
  Final input remains **211,294**: system 3,894; schemas 7,457; user 36;
  injected context 15; assistant 55,122; tool results 139,450; unattributed 5,320.
- Unchanged prompt/schema/user attribution stays fixed. The final unattributed
  remainder is **2.5%**; this is an attribution remainder, not a measured error
  bound for the other approximate categories.
- Retained output constrains the next request. A capture/codec/projection case
  with 150 output tokens (100 reasoning) and a 300 input increment attributes
  100 to assistant and 200 to the new tool category. The current response's 999
  output tokens are excluded. Reasoning is not counted a second time.
- Provenance cases verify metadata-only changes, missing requests, model
  changes, edited history and reasoning that was not retained. Unsupported
  attribution falls back to estimates plus the explicit remainder.
- History, category details and Overview occupancy use one metered total.
  The duplicate line and separate text-composition capacity bar are removed.
  Missing usage remains estimated; conflicting or zero metering never causes
  negative remainders or a forced redistribution across unchanged content.
- `typecheck:all`, `typecheck:scripts`, full `lint`, all four i18n gates, the 7
  existing focused tests and `git diff --check` passed.
- Final evidence: `.cache/verification/run-context-integrity-9f6u6t/`,
  `.cache/verification/run-context-accounting-jcwCgW/`, and
  `.cache/verification/run-redesign-IN8tZE/`. Each includes a hashed manifest.
- Shipped components were mounted in Chromium, including light/dark and narrow
  panels. Live provider calls and the installed Electron renderer were not run.
  The source conversation was read without modification.

## Metered-composition acceptance cases

| Failure | Required behavior |
| --- | --- |
| Current response output is added to the current request input | Keep it out: this output can enter the next request only. |
| Previous response is retained and conversation extends by its assistant message and tool results | Use its recorded output/reasoning to constrain new assistant/tool attribution. Never count reasoning twice. |
| A single new tool-result category follows an intact response | Attribute the measured input increment after retained assistant output to that category; image transport length is irrelevant. |
| Several content categories change, a request is missing, the model changes, or history is rewritten | Fall back to changed-content estimates and an unattributed remainder; do not claim measured category accuracy. |
| Static categories are identical | Preserve their attributed values across requests. Never rescale them to absorb a difference. |
| Retained estimates cannot account for the full measured input | Render a gray unattributed segment so the full bar still equals measured input. |
| Estimates exceed measured input, including reported zero | Mark attribution unavailable and render measured input as unattributed; do not invent negative residuals or force-rescale estimates. |
| A category has no inspectable content changes | Do not issue an added/modified/removed badge for an attribution or coverage change. |
| Final chart | Colored category stacks plus an explicit unattributed remainder; no duplicate provider-input line. |
| Real session | All 136 bar sums match recorded input; unchanged prompt/schema/user attribution stays fixed. |

## Initial text-only pass (superseded)

The following cases and verification describe the earlier text-only bars. The
metered-composition follow-up above supersedes their separate-line and separate
capacity-composition behavior.

Failure cases recorded before implementation. Supersedes the proportional
category-allocation expectations in the 2026-10-26 accounting matrix.

| Failure | Required behavior |
| --- | --- |
| Provider input changes while prompt, schemas and user content stay identical | Category and item text estimates stay fixed; no content-change badges. |
| An image's base64 grows without changing its text or image count | Text estimates stay fixed. Count images separately; never tokenize their transport encoding. |
| Usage, timing, result provenance or other runtime metadata changes | Neither text estimates nor semantic content fingerprints change. |
| Provider input exists | History and capacity use metered input, including cache reads/writes once; category estimates are independent. |
| Categories exceed or fall short of metered input | Do not rescale categories or draw their shares inside the measured height/capacity fill. |
| User inspects category history | Preserve colored category stacks at independent text-estimate heights; show metered input as a separate line, with missing samples left unconnected. |
| Provider input is missing or zero | Missing stays an explicitly approximate text estimate; recorded zero stays zero without erasing category estimates. |
| Legacy manifest contains only serialized character counts | Use retained text and available schema text; do not reuse serialized message lengths. Explain the fallback and excluded image tokens. |
| A schema changes without changing its length or description | Changes detects the schema fingerprint and reports a modification. |
| A category replaces one item with another | Report both the addition and removal even though item count is unchanged. |
| Per-item retained previews differ from request-time content | Never multiply item estimates by a category allocation ratio. |
| Legacy assistant text is stored in output blocks, including thinking | Include retained text/thinking once; keep tool-call arguments in the tool category. |
| Adjacent requests mix recorded and missing metering | Leave net change unknown instead of subtracting a text estimate from measured input. |
| Request selection or Overview navigation changes | Context and Overview retain identical metering and independent text-estimate rules. |
| New request manifest is persisted and reloaded | Preserve text-only metrics, image counts and stable semantic fingerprints through normal session storage. |
| Real 261027-onyx-maple session is replayed | All 136 metered totals stay intact; unchanged prompt/schema/user categories have no phantom deltas; images no longer collapse historical text categories. |
| Light/dark and narrow panels | Preserve the approved palette, equal-width marks and single-row axes; label the two accounting bases clearly. |

Repeatable evidence:

- `bun run scripts/verification/run-context-integrity-workflow.ts`
- `bun run scripts/verification/run-context-accounting-workflow.ts`
- `bun run scripts/verification/run-redesign-workflow.ts`

The integrity workflow exercises request capture, normal session encoding and
decoding, production Run components in Chromium, and optional read-only replay
through `PHANERIS_RUN_CONTEXT_SESSION`. It writes numeric evidence, screenshots
and a hashed manifest to its verification directory.

## Initial verified result (superseded)

- Integrity workflow: **7 checks passed**; request capture, session codec,
  image/metadata exclusion, retained reasoning, mixed metering, schema changes,
  category stacks with a separate input line, and real-session replay.
- Existing accounting workflow: **9 checks passed**; approved light/dark
  palettes, cache usage, zero/missing input, bounded bars and responsive axes.
- Broad Run workflow: **36 checks passed**, including 600px and dark 390px panels.
- All **136** recorded input totals in `261027-onyx-maple` are preserved. The
  final request remains **211,294** input tokens. Independent retained-text
  estimates sum to **123,245**; they are explicitly approximate and exclude
  image tokens. Unchanged prompt/schema/user items produce **zero** estimate
  drift or content-change badges.
- History retains colored category stacks. Their heights use text estimates;
  recorded provider input is a separate dashed line. Capacity likewise keeps
  measured occupancy separate from the text-composition bar.
- `typecheck:all`, full `lint`, all four i18n gates, and `git diff --check` passed.
  The 7 existing focused tests also passed. No new unit tests were added after
  implementation.
- Evidence: `.cache/verification/run-context-integrity-XmL0Ex/`,
  `.cache/verification/run-context-accounting-dGMfke/`, and
  `.cache/verification/run-redesign-gl7473/`. Each contains a hashed manifest;
  numeric checks and screenshots are retained with the run.
- These workflows mount production components in Chromium. Live provider calls
  and the installed Electron renderer were not exercised; the source session
  was read without modification.
