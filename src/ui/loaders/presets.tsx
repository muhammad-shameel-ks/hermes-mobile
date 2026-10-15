/**
 * The desktop's two stock particle-loader placements: components/page-loader.tsx
 * (`size-10`, primary at 70%) for a screen waiting on its first data, and the
 * thread's CenteredThreadSpinner (`size-12`, midground at 70%) for a session
 * loading. Both run the rose curve at pathSteps 220 and strokeScale 0.72.
 */

import { View } from 'react-native';

import { mixPct } from '../color.ts';
import { useTokens } from '../tokens.ts';
import { Loader } from './Loader.tsx';

export function PageLoader({ label = 'Loading' }: { label?: string }) {
  const t = useTokens();
  return <Loader size={40} color={mixPct(t.dtPrimary, 0.7, 'transparent')} pathSteps={220} strokeScale={0.72} label={label} />;
}

export function ThreadLoader({ label = 'Loading session' }: { label?: string }) {
  const t = useTokens();
  return (
    <View pointerEvents="none">
      <Loader size={48} color={mixPct(t.uiAccent, 0.7, 'transparent')} pathSteps={220} strokeScale={0.72} label={label} />
    </View>
  );
}
