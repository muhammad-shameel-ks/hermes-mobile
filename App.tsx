/**
 * Restores what the last run left behind, then hands the phone to the connect
 * screen or the signed-in one. A stale access token gets the single silent
 * refresh attempt the connection model allows; anything worse asks for a fresh
 * sign-in rather than retrying.
 */

import { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { useFonts } from 'expo-font';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { refreshCredentials } from './src/auth/native-flow.ts';
import { clearCredentials, loadConnection, loadCredentials, saveCredentials, type SavedConnection } from './src/auth/store.ts';
import { isStale, nowSeconds } from './src/auth/tokens.ts';
import { probeGateway } from './src/gateway/status.ts';
import { restoreSession, type AppState } from './src/app/boot-state.ts';
import SignedInApp from './src/app/SignedInApp.tsx';
import { ConnectingScreen, SignInAgainScreen, UnreachableScreen } from './src/screens/BootScreens.tsx';
import ConnectScreen from './src/screens/ConnectScreen.tsx';
import { theme } from './src/ui/theme.ts';
import { resolveTokens, TokensContext } from './src/ui/tokens.ts';

// One skin and one appearance until the appearance settings land: the desktop's `nous` dark.
const tokens = resolveTokens('dark');

const restore = () =>
  restoreSession({ loadConnection, loadCredentials, saveCredentials, refreshCredentials, probeGateway, isStale, nowSeconds });

export default function App() {
  const [state, setState] = useState<AppState>({ kind: 'starting' });
  // fonts load in the background; text falls back to the platform faces until they arrive
  useFonts({
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    'Collapse-Bold': require('./assets/fonts/Collapse-Bold.ttf'),
    codicon: require('./assets/fonts/codicon.ttf'),
  });

  useEffect(() => {
    let live = true;
    void restore().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, []);

  const leave = useCallback((connection: SavedConnection, reason: string | null) => {
    void (async () => {
      await clearCredentials(connection.id);
      setState(reason === null ? { kind: 'signed-out', connection } : { kind: 'reauth', connection, reason });
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
      <TokensContext.Provider value={tokens}>
        <KeyboardProvider>
          <SafeAreaView
            style={styles.root}
            // the signed-in app lays out its own insets so the drawer can run edge to edge
            edges={state.kind === 'signed-in' ? ['left', 'right'] : ['top', 'bottom', 'left', 'right']}
          >
            <StatusBar style="light" />
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
          </SafeAreaView>
        </KeyboardProvider>
      </TokensContext.Provider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
});
