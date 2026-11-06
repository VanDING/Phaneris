# Resident assistant packaged-client follow-up

User-approved scope: fix observed dispatch failures, bind existing messaging channels to the resident assistant, and replace More → Deliveries with a persistent non-modal panel that exists only on the assistant page. Closing the assistant hides the panel; reopening restores its workspace-local presentation. Existing user changes and live data are preserved.

The following failure cases are specified before implementation. Verification uses isolated workspace state, loopback providers and the actual Electron renderer; no live messages or paid provider calls.

| ID | Failure to prevent | Acceptance evidence |
| --- | --- | --- |
| RFU01 | Catalog `pi/` IDs cannot pass dispatch validation | Discover, resolve and dispatch a prefixed catalog model without losing its identity |
| RFU02 | Catalog membership is mistaken for protocol compatibility | Expose connection protocol; inherit working configuration by default; retain actionable upstream errors without inventing model compatibility |
| RFU03 | A running model is presented as not started | Original Runtime attempt and live activity identify processing, tools and waiting; no timeout-based guess |
| RFU04 | Assistant receives only generic execution failures | A bounded, attributed error summary is available from the original execution and its result source |
| RFU05 | Manual continuation silently rewrites a cancelled delegation | Original cancellation remains; a separate attributed continuation is visible without declaring the old assignment successful |
| RFU06 | Explicit source waits behind unrelated indexing | First scoped history query indexes the named ordinary Session, preserving workspace/suppression/source checks |
| RFU07 | Existing generated files never become deliverables | Successful delegated writes register actual files through existing Artifact storage; no arbitrary history prose or external paths become artifacts |
| RFU08 | More opens a menu then a modal | One click opens work and deliverables directly, with task titles rather than UUIDs |
| RFU09 | Click-away or typing dismisses the panel | Chat remains editable; panel stays open without a backdrop or focus trap |
| RFU10 | Panel remains visible outside assistant or crosses workspaces | Close hides panel; reopening restores state for that workspace only |
| RFU11 | Deliverable requires copying a path | Clicking its filename invokes existing file preview with original ownership |
| RFU12 | Running/cancelled/failed tasks disappear or imply acceptance | Show all work states; delivery receipts and user acceptance remain separate |
| RFU13 | Messaging binding points at an ordinary/new session | Connected channels are displayed; a transient platform picker pairs to the current resident singleton using existing gateway authorization |
| RFU14 | Sidebar overflows, cannot resize or traps keyboard | Light/dark, narrow/wide, resize keys, Escape and focus-return evidence |
| RFU15 | Polling races overwrite new workspace state or steal source views | Generation-scoped requests, independent partial failures, bounded refresh while visible |

Regression gates: existing resident delegation/history/context/native/UI workflows; appropriate messaging regression suites; typecheck, lint and i18n gates; renderer/main/preload/subprocess builds. Capture screenshots, workflow manifests and hashes. Real external-platform transport and signed installer validation must be reported separately when not exercised.

User refinement: memory/context is excluded from this panel. Do not render unconnected platform rows. Preserve the existing product chrome, compact list hierarchy and contextual connection actions.
