# hermes-mobile

Vocabulary for the effort that reproduces the Hermes desktop app's UI and gateway protocol as an Expo (dev-client) React Native app. The desktop's own terms take precedence; where two words exist for one concept, this file picks one.

## Appearance

**Skin**:
The selectable appearance identity (`nous`, `github`, `catppuccin`, ...) carrying a brand's colours and per-appearance palettes.
_Avoid_: theme, preset, colour scheme

**Seed token**:
A colour or ratio the resolver writes before derivation - a brand colour or a per-appearance mix ratio.
_Avoid_: base variable

**Derived token**:
A value computed from seeds and ratios; every surface, control, row, hairline and text shade in the app.
_Avoid_: computed variable, CSS variable

**Resolved theme**:
The concrete token values for one skin and appearance - what the app paints.
_Avoid_: applied theme

**Mode preference**:
The stored choice between system, light and dark.
_Avoid_: theme mode

**Rendered mode**:
The appearance actually painted, derived from the resolved background rather than the preference; a bright palette paints light whatever the preference says.
_Avoid_: effective mode

**Conversation tokens**:
The five type sizes that Chat Text Size and the platform's font scale multiply - chat text, tool rows, captions and their leading. Nothing else resizes.
_Avoid_: chat font

**Glass**:
The desktop's native window translucency: a material behind the window, not a token. On mobile it survives only as stored settings data.
_Avoid_: blur, translucency

**Wordmark**:
The Hermes lettering on the empty-chat intro splash and on a bot's empty chat.
_Avoid_: logo, splash text

**Parity deviation**:
A deliberate, recorded divergence from the desktop's rendering, carried in the parity spec rather than left implicit.
_Avoid_: exception, workaround

## Transcript and composer

**Transcript**:
The conversation surface: one session's ordered message list, its scroll behaviour and the results rendered inline in it.
_Avoid_: chat view, thread, timeline

**Composer**:
The input dock at the bottom of the transcript: text, attachments, references, submit controls and the status stack.
_Avoid_: input bar, chat box, editor

**Action bar**:
The per-message control row - copy, retry, read aloud, reactions, edit, restore, stop.
_Avoid_: toolbar, hover toolbar, message menu

**Interim reply**:
A segment of a turn sealed before the turn finished. It reads as settled text but carries no action bar.
_Avoid_: partial reply, preview reply, chunk

**Reasoning disclosure**:
The row holding a segment's reasoning text, collapsed by default and opened on demand.
_Avoid_: thinking block, chain of thought

**Tool group**:
The container that holds one turn's tool calls and splits them into runs and cards.
_Avoid_: tool cluster, tool list

**Tool run**:
Two or more same-class tool calls collapsed into one summary row ("Explored 3 files, ran 5 commands").
_Avoid_: tool summary, tool stack

**Tool card**:
A tool result that renders in place as its own panel rather than joining a run - file edits, clarifications, generated images, delegations, connections, the catalog, session starts.
_Avoid_: tool widget, result block

**Status stack**:
The dock above the composer holding the session's live rows: goal, todo, subagents, background tasks, retained todos and queued prompts.
_Avoid_: status bar, activity bar

**Queue**:
Prompts the client holds back until the running turn finishes, draining one at a time.
_Avoid_: pending list, backlog

**Parked queue**:
A queue that Stop has closed to the drain, so the end of a turn does not fire its next entry; it runs again only when the reader resumes it.
_Avoid_: paused queue, held queue

**Steer**:
Sending text into the running turn to redirect it, rather than queueing it for afterwards.
_Avoid_: interrupt, inject, nudge

**Sticky prompt**:
The running turn's user message, pinned at the top of the transcript while the rest of its turn scrolls beneath.
_Avoid_: sticky header, pinned message

**Stick-to-bottom**:
The transcript's follow-the-tail scroll: pinned to the newest row until the reader drags up, re-pinned when they return to the bottom.
_Avoid_: autoscroll, follow mode

**Receiver**:
The one transcript that consumes a session's event stream on a phone; the desktop's per-pane mirrors have no mobile counterpart.
_Avoid_: subscriber, listener, client

## Surfaces

**Files root**:
The single server directory the phone's Files surface is rooted at - the dashboard's files root, never a session's workspace.
_Avoid_: workspace, home directory, uploads folder

**Files surface**:
The phone's full-screen surface over the files root: browse, read, preview, download, share, upload and new folder; no host-filesystem tree.
_Avoid_: file browser, files pane, explorer

**Preview viewer**:
The phone's full-screen renderer for file and artifact targets; static SVG renders, HTML shows source.
_Avoid_: preview pane, preview tiles, right rail

**Review surface**:
The phone's read-only full-screen view of a working tree's changes: file list, scope and unified diffs.
_Avoid_: diff pane, review pane, changes rail

**Agent-process tail**:
The read-only live output of an agent's background process - the desktop's read-only terminal tab; the phone's only terminal-family surface, deferred to a later phase.
_Avoid_: terminal, agent terminal, console

**Coding row**:
The desktop's composer row carrying branch, worktree and diff counts and opening the review pane; not ported to the phone.
_Avoid_: git row, git status bar, coding rail
