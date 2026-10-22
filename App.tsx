/**
 * Restores what the last run left behind, then hands the phone to the connect
 * screen or the signed-in one. A stale access token gets the single silent
 * refresh attempt the connection model allows; anything worse asks for a fresh
 * sign-in rather than retrying.
 */

import { useCallback, useEffect, useState } from 'react';
import { useFonts } from 'expo-font';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { clearCredentials, type SavedConnection } from './src/auth/store.ts';
import type { AppState } from './src/app/boot-state.ts';
import { endSignedIn, restore } from './src/app/signedIn.ts';
import SignedInApp from './src/app/SignedInApp.tsx';
import { ConnectingScreen, SignInAgainScreen, UnreachableScreen } from './src/screens/BootScreens.tsx';
import { wipeConnection } from './src/store/index.ts';
import UpdatePrompt from './src/updates/UpdatePrompt.tsx';
import { lazyScreen, preloadLazyScreens } from './src/ui/lazy.tsx';
import { APP_FONTS } from './src/ui/fonts.ts';
import { ThemedSafeAreaView, ThemedStatusBar, ThemeProvider } from './src/ui/ThemeProvider.tsx';

// the connect flow is off the launch path of a signed-in phone
const ConnectScreen = lazyScreen(() => require('./src/screens/ConnectScreen.tsx') as typeof import('./src/screens/ConnectScreen.tsx'), { preload: false });

function Root() {
  const [state, setState] = useState<AppState>({ kind: 'starting' });
  // fonts load in the background; text falls back to the platform faces until they arrive
  useFonts(APP_FONTS);

  useEffect(() => {
    let live = true;
    void restore().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (state.kind === 'signed-in') preloadLazyScreens();
  }, [state.kind]);

  const leave = useCallback((connection: SavedConnection, reason: string | null) => {
    endSignedIn(connection.id);
    void (async () => {
      await clearCredentials(connection.id);
      setState(reason === null ? { kind: 'signed-out', connection } : { kind: 'reauth', connection, reason });
      // an explicit sign-out forgets the cached transcripts and drafts once the signed-in app has unmounted and flushed
      if (reason === null) setTimeout(() => void wipeConnection(connection.id).catch(() => undefined), 0);
    })();
  }, []);

  const retry = useCallback(() => {
    setState({ kind: 'starting' });
    void restore().then(setState);
  }, []);

  const gatewaySettings = (connection: SavedConnection) =>
    setState({ kind: 'connect', connection, address: connection.baseUrl, notice: null });

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <KeyboardProvider>
          <ThemedSafeAreaView
            // the signed-in app lays out its own insets so the drawer can run edge to edge
            edges={state.kind === 'signed-in' ? ['left', 'right'] : ['top', 'bottom', 'left', 'right']}
          >
            <ThemedStatusBar />
            {state.kind === 'starting' ? <ConnectingScreen /> : null}
            {state.kind === 'unreachable' ? (
              <UnreachableScreen
                headline={state.headline}
                detail={state.detail}
                onRetry={retry}
                onGatewaySettings={() => gatewaySettings(state.connection)}
              />
            ) : null}
            {state.kind === 'reauth' || state.kind === 'signed-out' ? (
              <SignInAgainScreen
                variant={state.kind}
                connection={state.connection}
                reason={state.kind === 'reauth' ? state.reason : undefined}
                onSignedIn={(credentials) => setState({ kind: 'signed-in', connection: state.connection, credentials, status: null })}
                onGatewaySettings={() => gatewaySettings(state.connection)}
              />
            ) : null}
            {state.kind === 'connect' ? (
              <ConnectScreen
                key={state.address}
                initialAddress={state.address}
                notice={state.notice}
                existing={state.connection}
                onSignedIn={(connection, credentials, status) => setState({ kind: 'signed-in', connection, credentials, status })}
              />
            ) : null}
            {state.kind === 'signed-in' ? (
              <SignedInApp
                connection={state.connection}
                credentials={state.credentials}
                onSignOut={() => leave(state.connection, null)}
                onReauthRequired={(reason) => leave(state.connection, reason)}
              />
            ) : null}
            <UpdatePrompt />
          </ThemedSafeAreaView>
        </KeyboardProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Root />
    </GestureHandlerRootView>
  );
}
