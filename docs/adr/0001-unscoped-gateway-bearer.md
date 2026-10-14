# The gateway bearer is unscoped

The gateway's native PKCE sign-in mints one bearer that reaches every profile and cannot
be revoked (`revoke_session()` is a documented no-op), so the phone adopts the desktop's
model: profile scoping lives entirely in app state - every request carries `?profile=` -
and "sign out" can only mean forgetting local tokens.

## Consequences

- A leaked credential stays valid until its refresh TTL lapses; per-device revocation does
  not exist and is a documented limitation, not a gap to close.
- The active profile is presentation, never an authorization boundary: nothing about it
  constrains what a request may touch.
