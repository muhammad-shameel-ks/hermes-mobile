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

## Attention

**Attention**:
A chat's open request - an approval, a clarify, a sudo, secret or vault prompt - lifted out of its chat so the reader sees it wherever they are. One per request; the next request in the same chat is a new attention.
_Avoid_: alert, ping, pending request

**Attention banner**:
The card dropped over the screen when an attention waits in a chat other than the open one. Run and Reject answer an approval in place; Open switches to the chat; the X waves that one attention off.
_Avoid_: toast, in-app notification, heads-up

**Attention notification**:
The system notification an attention raises while the app is out of sight. It carries no actions: a tap opens the chat, where the request is answered on its card.
_Avoid_: push notification, alert

**Background hold**:
Android's foreground service that keeps the app and its socket running while a turn streams or waits on the reader out of sight, released as soon as nothing is left to wait for. Without it the socket closes with the app and no attention can arrive.
_Avoid_: keep-alive, wake lock, background mode

## Connections and profiles

**Connection**:
A saved way to reach one gateway: a label, a base URL with an explicit scheme and port, an auth mode, and the credentials minted for it.
_Avoid_: server, host, instance

**Profile**:
A Hermes-side identity that owns its own sessions and configuration; the phone presents a gateway's profiles as its bots.
_Avoid_: account, user, agent

**Active profile**:
The profile the phone is currently acting as: it scopes the sessions list and new sessions. Opening a Bot Chat leaves it unchanged; that chat's own requests carry the bot's profile.
_Avoid_: current profile, selected profile

## Bot Mode

**Bot**:
A Hermes profile the phone presents as a chat partner: the profile carries its name, avatar and description, and every bot owns exactly one Bot Chat.
_Avoid_: agent, assistant, persona

**Bot Chat**:
A bot's one continuous conversation, identified by its title on the bot's profile rather than a stored pointer, and held out of the sessions list.
_Avoid_: bot session, bot thread, bot channel

**Side-chat**:
A bot's ordinary session other than its Bot Chat - a scratch conversation that stays visible in the sessions list.
_Avoid_: side thread, sub-chat

**Bot roster**:
The drawer's BOTS tab: bot rows of avatar, name, last-message preview and time, with hidden bots behind a disclosure.
_Avoid_: bots list, bot drawer

**Section**:
A named group of bots the reader makes on the bot roster. The filing lives on each bot's profile, carrying the section's id and name, so every client draws the same sections; bots in none sit under Unassigned, which is not a section.
_Avoid_: folder, group, category

## Group chats

**Group chat**:
A gateway-hosted room of two to six bots that the reader talks into; the gateway's driver runs each member's turn and the phone reads the room's log. Only hosted rooms exist on the phone; the desktop's older client-driven rooms do not.
_Avoid_: room (except in gateway method names), channel, bot group

**Room log**:
A group chat's ordered, append-only event list: messages, plus the control events that explain a bot's silence. The phone polls it while a group chat is open.
_Avoid_: history, feed

**Mention**:
An `@handle` in a message that addresses one member, or `@everyone` for the whole room; a message with no mention goes to every member.
_Avoid_: tag, ping

**Pending action**:
What the driver waits on the reader for: a member's command approval, or a retry of a turn left unfinished.
_Avoid_: prompt, request

**Unconfirmed send**:
A message whose answer never arrived, held under its event id so a retry cannot post it twice.
_Avoid_: failed send, draft

**Room activity**:
The group chat's turn lifecycle as a feed: who replied, passed, failed, waited or was interrupted, derived from the room log. The desktop's run epochs have no wire analogue; rows are the newest 50, newest first.
_Avoid_: activity log, status feed

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

**Kanban board**:
A gateway-side queue of tasks that agents, not the reader, run: a card placed in Ready with an assignee is picked up by the dispatcher. One gateway holds several boards; the phone shows the one selected for that gateway, a lane at a time.
_Avoid_: task list, todo list, project board

**Lane**:
One status on a kanban board - Triage, Todo, Scheduled, Ready, Running, Blocked, Review, Done, Archived. Every card sits in exactly one. Running, Review and Scheduled are the dispatcher's lanes: a card can leave them but the reader cannot move one in.
_Avoid_: column, status bucket, swimlane

**Card**:
One kanban task as its lane shows it: title, latest summary, and who is on it.
_Avoid_: ticket, item, issue

**Drop dock**:
The grid of lanes laid over the board while the reader holds a card; letting go on a lane moves the card there, letting go in place opens the card's actions.
_Avoid_: move menu, drop zone

**Agent-process tail**:
The read-only live output of an agent's background process - the desktop's read-only terminal tab; the phone's only terminal-family surface, deferred to a later phase.
_Avoid_: terminal, agent terminal, console

**Coding row**:
The desktop's composer row carrying branch, worktree and diff counts and opening the review pane; not ported to the phone.
_Avoid_: git row, git status bar, coding rail

**Memory graph**:
The profile's learned skills and memory chunks, read on the phone as a list or timeline screen.
_Avoid_: starmap, star map, memory map, constellation, learning
