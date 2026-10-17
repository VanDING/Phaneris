# State matrix

Every surface must answer five states. A cell is either implemented, explicitly
not applicable, or carried by the shared `StateSurface` primitive with surface
copy. A blank cell is a defect: the user has no recovery path.

`StateSurface` (`packages/ui/src/components/state/StateSurface.tsx`) owns the
shape, spacing, semantics (`role=status` / `role=alert`) and action slot.
Surface-specific components only supply content. `PanelEmptyState` wraps
`EmptyState`, so every panel empty state (sources, skills, automations, files,
artifacts, trajectory, sessions) routes through one primitive. Errors and
connection problems render `ErrorBanner` (transport, overlay); `ChatDisplay`
keeps its transcript-preserving inline error. `BrowserEmptyStateCard` is a
content-specific card (prompt list + safety footer) built from the same tokens;
it is the documented exception, not a second generic empty primitive.

| Primitive | Used by |
| --- | --- |
| `StateSurface` / `EmptyState` | Panel empties, loading, denied |
| `ErrorState` | Full-surface failures |
| `ErrorBanner` | Transport banner, overlay error banner, inline warnings |
| `PanelEmptyState` | Renderer panels (thin wrapper over `EmptyState`) |

| Surface \ State | loading | empty | error | partial | denied |
| --- | --- | --- | --- | --- | --- |
| Chat (`ChatDisplay`) | ☑ turn-level spinner + streaming indicator | ☑ NewSessionLanding + rotating hints | ☑ inline error keeps the transcript and offers Retry / Clear draft / Reload | ☑ interrupted stream keeps partial text and a retry affordance | ☑ permission card names the requested action; Allow / Always allow / Deny |
| Session list (`SessionList`) | ☑ skeleton rows while sessions hydrate | ☑ `StateSurface` empty + New session action | ☑ load failure banner with Retry | ☑ background task running badge on the session row | — (list has no permission state) |
| Sources (`SourcesListPanel`, `SourceInfoPage`) | ☑ list skeleton | ☑ `StateSurface` empty + Add source / docs link | ☑ connection banner with Reconnect | ☑ credential expired / auth required badge | ☑ source requires auth; Reconnect opens the credential flow |
| Skills (`SkillsListPanel`, `SkillInfoPage`) | ☑ list skeleton | ☑ `StateSurface` empty + Add skill | ☑ load failure banner | ☑ project-managed skill rendered read-only | — |
| Plugins (`PluginsListPanel`) | ☑ list skeleton | ☑ `StateSurface` empty (install is docs-driven) | ☑ load failure banner | ☑ partially installed bundle shows per-capability status | — |
| Projects (`ProjectsListPanel`) | ☑ list skeleton | ☑ `StateSurface` empty + Create project | ☑ create/delete failure toast + retry | ☑ project with missing workspace path | — |
| Pages (`PagesHome`, `PageView`) | ☑ page skeleton | ☑ `StateSurface` empty + Ask the agent to create | ☑ render/share failure with Retry | ☑ unpublished page shows local-only notice | ☑ share disabled until the page has content |
| Automations (`AutomationsListPanel`) | ☑ run status spinner | ☑ `StateSurface` empty + Add automation | ☑ run failure row with Retry | ☑ concurrent run skipped badge | — |
| Kanban / schedule (`KanbanSurface`, `GanttSurface`, `CalendarSurface`) | ☑ board skeleton | ☑ `StateSurface` empty + Add task | ☑ save conflict banner with Reload | ☑ task editing while a background sync is pending | — |
| Messaging (`MessagingPanel`) | ☑ channel list skeleton | ☑ `StateSurface` empty + Connect channel | ☑ offline banner with Retry | ☑ reconnecting state | ☑ channel access revoked |

## Rules

1. Every state names what the user can do next. "Something went wrong" alone is
   not a state.
2. Error surfaces preserve surrounding content (transcript, list) instead of
   replacing the screen unless the content itself failed to load.
3. Loading uses `role="status"`; error and denied use `role="alert"`; empty is
   neutral and must not announce.
4. Permission denials are decisions, not errors: they use the permission card
   with the risk label, not the red error surface.
5. Screenshots for each implemented cell are captured in the visual baseline
   (`docs/verification/results/`).
