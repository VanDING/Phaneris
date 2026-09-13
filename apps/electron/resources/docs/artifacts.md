# Artifacts and File Delivery

Artifacts keep a proposed file revision separate from the final destination until the user reviews and accepts it. Read this guide before creating or changing a user deliverable. Use the live tool schemas for exact arguments.

## Choose the delivery path

| Task | Path |
|------|------|
| Inspect or display an existing file without changing it | Read/preview the existing file; use the matching Preview guide |
| Show a temporary query result or analysis table in chat | `datatable`, `spreadsheet`, or a Preview block as appropriate |
| Create or change a report, Office document, PDF, image, or other user deliverable | Managed Artifact draft → inspect → submit → user accepts |
| Generate a new AI image | `image_generate` performs generation, validation, and submission as one workflow |
| Create a persistent dashboard or mini app | Pages tools and [pages.md](./pages.md) |
| Change repository code/configuration as part of development | Normal authorized repository tools and project rules; do not wrap each source edit in an Artifact |

Previewing a file is not equivalent to submitting a deliverable. After an Artifact is submitted, its native card already provides preview/review controls; do not emit a second Preview block for the same revision.

## Paths and revisions

- `sourcePath`: intended final destination. Creating or submitting a draft does **not** write this path. Relative target paths resolve from the session working directory; use an absolute path to avoid ambiguity.
- `editablePath`: mutable managed checkout returned while the Artifact is a draft. Direct file-producing tools write here, not over `sourcePath`.
- `activePath`: immutable revision used for inspection, or the accepted source path after acceptance. Do not edit it.
- `draftRevision`: revision identifier. Use the latest returned revision as `expectedRevision` for edits/submission. External edits are snapshotted by inspection, which can change the revision.
- `initialPath`: optional existing file to copy into a new draft. Useful when a tool has already generated a temporary file. It does not make that temporary file the final deliverable.

Only one of `initialPath`, `initialText`, and `initialBase64` may be supplied when creating a draft. Paths must satisfy the session's allowed roots.

## Workflow

1. Call `artifact_create` with `kind`, `sourcePath`, and optionally `title` and initial content. Choose the kind appropriate to the content (for example `document`, `spreadsheet`, `presentation`, `pdf`, `image`, `html`, `data`, or `text`).
2. For text/JSON, use `artifact_apply` with `artifactId`, `expectedRevision`, and a supported operation (`set_text`, `set_json`, `replace_text`). For Office/PDF/binary generation, write to the returned `editablePath` with the appropriate CLI. If output was already generated at a temporary path, import it with `initialPath` at creation.
3. Call `artifact_inspect`. It snapshots checkout edits, validates the active revision, and refreshes previews where supported. `artifact_render` is an alias: do not call both.
4. Check the actual content and layout as required for the deliverable. Structural validation or an Office Markdown preview alone does not prove pagination, fonts, cropping, formulas, or visual fidelity. For presentations, use `pptx-tool lint` and `pptx-tool render` when visual review is needed; for other formats use an appropriate render/inspection tool.
5. Fix problems in the draft, inspect again, then call `artifact_submit` with the latest revision. The state becomes `ready`, meaning **ready for user review**, not accepted or saved at the final path.
6. The user accepts or discards using the Artifact Card/Workbench. Do not perform these actions on the user's behalf. Report the proposal as submitted and state any remaining validation limitations.

Example arguments for `artifact_create` (subsequent calls use the actual returned ID/revision):

```json
{
  "kind": "text",
  "sourcePath": "/workspace/reports/findings.md",
  "title": "Findings",
  "initialText": "# Findings\n\nVerified results and remaining limitations.\n"
}
```

## Recovery and state

| Situation | Response |
|-----------|----------|
| Revision conflict | Read `artifact_status`, compare current content, and reconcile before applying another edit. Do not blindly replace the expected revision. |
| User edit lease active | Preserve the user's work. Wait for the edit to finish or ask for the necessary handoff; do not bypass the lease with direct writes. |
| Validation failure | Inspect errors, repair the draft, and reinspect before submission. |
| `ready` Artifact needs changes | The session tools do not expose a revise operation. Ask the user to return it to draft via the Workbench, or create a clearly identified replacement proposal from the intended content. Do not edit the immutable ready revision. |
| Final source changed since the draft began | Preserve both versions and reconcile the conflict; acceptance must not silently overwrite unrelated changes. |
| Tool response lost or uncertain | Query `artifact_status` before repeating creation/submission. |
| Tool unavailable or mode blocks creation | Explain the limitation and continue permitted inspection/planning. Do not bypass the review workflow by writing the final path directly. |

In Explore mode, `artifact_status` and `artifact_inspect` are allowed, but create/apply/submit and image generation are blocked. Inspection may refresh managed validation/preview metadata; it does not authorize changing the final file.
