# Rich Output

The agent can produce more than prose. A table, a diagram, a rendered document,
a chart, or a file you can open — the transcript renders these properly rather
than dumping their source, and most of them can be expanded full-screen.

This matters more than it sounds. A wall of markdown pipe characters is data you
have to parse; a table is data you can read. The difference decides whether you
check the agent's work or skim it.

## What it can emit

| Output | What you get |
|---|---|
| **Tables** | Aligned, sortable, and expandable — including large ones that would be unreadable in a chat bubble |
| **Spreadsheets** | An editable grid, for tabular data you want to actually work with |
| **Diagrams** | Mermaid rendered as a diagram, so the agent can draw an architecture or a flow instead of describing it |
| **Documents** | Markdown documents opened full-screen, for anything long enough to need its own space |
| **Previews** | HTML, PDF, images, and Markdown files shown inline rather than as a path you have to go open |
| **Artifacts** | Files the agent produced as a deliverable, collected so you can find them later |
| **Code** | Syntax-highlighted, and diffs rendered as diffs |

## Artifacts

An artifact is a file the agent made *for you* — a report, a script, a
spreadsheet — as opposed to a file it edited in passing. Artifacts are collected
per workspace, versioned by digest, and openable in a workbench where you can
review them next to the conversation that produced them.

The distinction is not cosmetic. "The agent changed a file in my repository" and
"the agent produced a deliverable" want different review behaviour: the first is
a diff to read, the second is a document to open.

## Why it previews rather than just naming

A preview keeps the work in one place. Being told "I wrote `report.pdf`" and
having to go find it breaks the review loop at exactly the moment you were about
to check something.

Previews are for **existing** files and for output the agent has just produced.
Pointing the agent at a file and asking it to show you is a normal thing to do.

## Making good use of it

**Ask for the shape you want.** "As a table" and "as a diagram" are legitimate
instructions, and they change the answer's usefulness more than another paragraph
of prose would.

**Prefer a diagram for anything with structure.** If the answer contains a flow,
a hierarchy, or a state machine, describing it in sentences is lossy.

**Treat a generated file as a draft until you have opened it.** Previewing is
cheap; assuming is not.

## Next steps

- [Document tools](phaneris://docs/go-further/document-tools) — creating and reading PDFs, Office files, and spreadsheets.
- [Pages](phaneris://docs/go-further/pages) — when the output should be a small app rather than a document.
