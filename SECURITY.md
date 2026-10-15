# Security policy

## Supported versions

Only the [latest release](https://github.com/muhammad-shameel-ks/hermes-mobile/releases/latest) receives security fixes.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability**. If that is not available to you, email hi@shameel.dev.

Include what you found, how to reproduce it, and the app version and platform. You can expect an acknowledgement within a few days. Please give us reasonable time to fix the problem before disclosing it publicly.

## Scope

In scope: this app's handling of sign-in, tokens and stored credentials, its update mechanism, and anything that exposes a user's gateway data.

Known limitations that are documented rather than bugs: the gateway's bearer is not scoped per profile and cannot be revoked ([ADR 0001](docs/adr/0001-unscoped-gateway-bearer.md)), and release APKs are currently signed with a debug key ([docs/releasing.md](docs/releasing.md#signing)).

Problems in the Hermes gateway itself belong in [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent).
