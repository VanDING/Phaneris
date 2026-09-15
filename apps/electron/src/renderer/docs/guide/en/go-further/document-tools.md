# Document Tools

Alongside editing text, the agent can read and produce real document formats —
PDF, Word, PowerPoint, Excel, and calendar files. That capability runs through a
set of Python tools bundled with the app, not through a cloud service, so
documents never leave your machine to be converted.

## What is supported

| Format | Read | Write |
|---|---|---|
| **PDF** | Text and page structure | Assemble, split, and merge |
| **Word (`.docx`)** | Text, tables, styles | Create and edit |
| **PowerPoint (`.pptx`)** | Slides and text | Create and edit |
| **Excel (`.xlsx`)** | Sheets and cells | Create and edit |
| **Images** | Metadata and conversion | Resize and convert |
| **Calendar (`.ics`)** | Events | Generate |
| **Diff** | — | Compare two documents |

The tools are ordinary scripts in the app's resources directory
(`resources/scripts/*.py`). They are invoked as subprocesses with explicit
arguments, never through a shell.

## The runtime requirement

The tools are Python, and a packaged build ships its own Python runtime (fetched
by `scripts/provision-runtime.ts` as `uv` alongside Bun and ripgrep) rather than
assuming one is installed. From a source checkout the system Python is used.

**On Windows there is an additional dependency**: the Microsoft Visual C++
Redistributable, which some of the underlying document libraries need. The app
checks for it at startup and, when it is missing, reports it as a system warning
with a download link rather than failing silently the first time you ask for a
PDF. Install it and restart.

## When to use a document tool, and when not to

**Use it when the format is the deliverable.** Someone asked for a `.docx`, or
the spreadsheet goes to a colleague, or a PDF needs to be filled in.

**Do not use it to hold data the agent will then read back.** A table the agent
both writes and reads is better as a datatable or a spreadsheet block, which
renders in the transcript and has no file to keep in sync. Round-tripping through
a file adds a step and a place for the two copies to diverge.

**Do not use it for a one-off conversion you can preview.** If you just want to
read a PDF, preview it; the agent only needs the tool when reading it *and doing
something with the contents*.

## Reading documents

The agent can extract text from an existing document you point it at, which turns
"here is a contract" into something you can ask questions about. Tables come
through as tables rather than flattened text, so a question about a specific
column has a specific answer.

For long documents this is where the working directory matters: point the session
at the folder, not the whole drive, and the agent spends its turns reading rather
than searching.

## Next steps

- [Rich output](phaneris://docs/go-further/rich-output) — the formats that render in the transcript.
- [Sources](phaneris://docs/sources/local-filesystems) — making a document folder available.
