# Group chats are the gateway's hosted rooms

The desktop has two group-chat engines: the legacy plugin rooms, where the desktop app drives each
round-robin turn itself and keeps the room log in its own storage, and the gateway-hosted rooms
(`groups.*`), where the gateway owns an append-only room log and its driver runs the members' turns.
The desktop already routes new groups to the hosted engine and offers to move a legacy room onto it.

The phone implements only the hosted engine. A phone is foreground-only, so it cannot run turns for a
room, and the legacy engine's cross-device mirror rides the default profile's `ui_meta`, which a phone
would have to rebuild and keep in step with the desktop. The hosted engine needs none of that: the phone
polls `groups.state` and `groups.log`, appends `message.user` events with `groups.send`, and answers the
driver's pending approvals and retries.

## Consequences

- Legacy desktop rooms do not appear on the phone. They stay on the desktop until it moves them onto the
  gateway, as it already offers to.
- Rooms are text-only: `groups.attachment.*` and `groups.discard` are served only by a session authority,
  which the phone does not support (the link halts on `session_authority`).
- A gateway without `groups.capabilities`, or one whose `driver` is false, shows no rooms and refuses to
  create one, with the desktop's "Group driver unavailable" copy.
- The gateway pushes no room events, so an open room polls (about every 1.5 s while the driver works,
  4 s otherwise) and does nothing while the socket is down or the app is in the background.
  Approvals are therefore foreground-only, like the rest of the phone.
- An unconfirmed send is kept in memory under its event id and retried under that same id, so it cannot
  land twice. It does not survive the app being killed.
