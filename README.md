# Hermes Mobile

A native mobile client for the [Hermes](https://github.com/NousResearch/hermes-agent) agent. It brings the Hermes desktop app's chat UI and gateway protocol to Android and iOS, built with [Expo](https://expo.dev) and React Native.

Hermes Mobile does not run an agent itself. It connects to a Hermes gateway you already run, signs in with the gateway's native PKCE flow, and lets you chat with your profiles ("bots"), review files and changes, and answer approvals from your phone.

> **Status:** early and moving fast. Android builds are published automatically; iOS builds from source work, but there is no iOS distribution yet.

## Features

- Chat with streaming replies, reasoning and tool-call cards, attachments, dictation and read-aloud
- Approvals and clarification prompts from the agent, answered on the phone
- Attention: a request waiting in another chat drops in as a banner (approvals can be run or rejected right there), and while the app is in the background on Android a system notification opens the chat that needs you
- Bot Mode: your gateway's profiles shown as bots, each with its own sessions
- Group chats: rooms of two to six bots hosted by the gateway, with @mentions, stop, approvals and retries
- Files and Review surfaces for browsing what the agent produced and the changes it made
- Kanban: the gateway's task boards, a lane per page with a pipeline ribbon; hold a card to drag it onto another lane, open a task to steer its worker, comment, reassign or unblock it
- Model picker with thinking level, slash commands, and a message queue
- Skins with light and dark appearances
- In-app update prompt for Android release builds

## Install

Release builds for Android (arm64) are attached to every [GitHub release](https://github.com/muhammad-shameel-ks/hermes-mobile/releases/latest) as `hermes-X.Y.Z.apk`. Android will ask you to allow installing from an unknown source the first time. See [docs/releasing.md](docs/releasing.md) for how releases are built and what the signing caveats are.

## Connect to a gateway

You need a running Hermes gateway that this device can reach and that has dashboard auth configured with the `native_pkce` sign-in flow. See the [Hermes docs](https://github.com/NousResearch/hermes-agent) for setting one up.

1. Open the app and type the gateway's address, for example `192.168.1.20:9119` or `https://hermes.example.com`. The default port is `9119`.
2. The app checks the address as you type and shows the **Sign in** button once the gateway qualifies.
3. Sign in through the browser window that opens. The app stores its tokens in the device's secure storage.

Plain `http` is accepted only for loopback, link-local and private-network addresses, as a development convenience. Anything else needs `https`.

## Develop

### Prerequisites

- Node.js 22 and npm
- For Android: Android Studio (SDK, an emulator or a device with USB debugging) and JDK 17
- For iOS: macOS with Xcode and CocoaPods

The app uses custom native modules, so it runs in an Expo **development build**, not in Expo Go.

### Run it

```sh
git clone https://github.com/muhammad-shameel-ks/hermes-mobile.git
cd hermes-mobile
npm ci

npm run android   # builds and launches the dev client on an Android emulator or device
npm run ios       # builds and launches the dev client on an iOS simulator or device
npm start         # starts Metro for an already installed dev client
```

`android/` and `ios/` are generated from `app.json` and the config plugins in `plugins/` by `expo prebuild`, and are git-ignored. Change native configuration in `app.json` or a plugin, never in the generated folders.

An Android emulator reaches your computer's gateway at `http://10.0.2.2:9119`.

### Check your work

```sh
npm run typecheck   # tsc --noEmit
npm test            # Node's built-in test runner over tests/**/*.test.ts
```

CI runs both on every pull request, along with a check that the vendored code still matches its manifest.

### Project layout

| Path | What lives there |
| --- | --- |
| `App.tsx`, `index.ts` | Entry point and root component |
| `src/auth/` | Native PKCE sign-in, token storage and refresh |
| `src/gateway/` | Gateway address handling, status probe and HTTP client |
| `src/chat/` | Chat screen, controller, transcript, composer and request cards |
| `src/bots/`, `src/drawer/` | Bot roster, avatars and the navigation drawer |
| `src/groups/` | Group chats: the room protocol, live room store, creation and room screens |
| `src/files/`, `src/review/` | Files and Review surfaces |
| `src/kanban/` | Kanban: board polling, lanes, drag-to-move, task and new-task screens |
| `src/settings/` | Settings screens and persisted preferences |
| `src/updates/` | In-app update check for release builds |
| `src/ui/` | Design tokens, skins and shared components |
| `plugins/` | Expo config plugins for native tweaks |
| `vendor/hermes-shared/` | Vendored `@hermes/shared` from the Hermes monorepo |
| `tests/` | Unit tests |
| `docs/` | Architecture decisions, release process and parity notes |

The project's vocabulary is defined in [GLOSSARY.md](GLOSSARY.md). Read it before naming things. Design decisions are recorded in [docs/adr/](docs/adr/).

## Contributing

Contributions are welcome. If you want to add a feature, or bring more of the Hermes desktop app's behaviour and look over to the mobile app, please feel free to open a pull request. [docs/drawer-parity.md](docs/drawer-parity.md) is an example of how a ported surface is documented against its desktop source, and [GLOSSARY.md](GLOSSARY.md) calls a deliberate difference from desktop a *parity deviation*. For a big change, open an issue first so we can agree on the approach.

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. In short: fork, branch, open a pull request against `main`, and make sure `npm run typecheck` and `npm test` pass. Nobody pushes to `main` directly.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security problem, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Third-party code is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
