// Per-weight imports so only the four fonts we use ship in the bundle.
import { DMMono_400Regular } from '@expo-google-fonts/dm-mono/400Regular';
import { DMMono_500Medium } from '@expo-google-fonts/dm-mono/500Medium';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif/400Regular';
import { InstrumentSerif_400Regular_Italic } from '@expo-google-fonts/instrument-serif/400Regular_Italic';
import { BlurTargetView } from 'expo-blur';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Alert, AppState, Linking, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FloatingTabs, type Tab } from './src/components/FloatingTabs';
import { MarketScreen } from './src/screens/MarketScreen';
import { TripwireSheet } from './src/components/TripwireSheet';
import { TripwiresScreen } from './src/screens/TripwiresScreen';
import { syncBackgroundCheck, type BackgroundState } from './src/services/background';
import { evaluateTripwires } from './src/services/engine';
import {
  notificationsAllowed,
  notifyTest,
  onNotificationReceived,
  onNotificationTap,
  prepareChannel,
  requestNotifications,
} from './src/services/notify';
import { sendServerTest, serverConfigured, syncWithServer, type ServerState } from './src/services/sync';
import { ThemeProvider, useStyles, useTheme, type Palette } from './src/theme';
import type { Coin, NewTripwire, PriceMap } from './src/domain/types';
import { useMarket } from './src/hooks/useMarket';
import { useTripwires } from './src/hooks/useTripwires';

function Root() {
  const styles = useStyles(createStyles);
  const { scheme } = useTheme();
  const blurTarget = useRef<ComponentRef<typeof View>>(null);
  const [tab, setTab] = useState<Tab>('market');
  const [picked, setPicked] = useState<Coin | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [background, setBackground] = useState<BackgroundState>('idle');
  const [server, setServer] = useState<ServerState>(serverConfigured ? 'connecting' : 'off');
  const { armed, tripped, reload, arm, remove, clearTripped } = useTripwires();

  // Keeps the server's copy in step with ours and adopts trips it fired while the app was closed.
  const reconcile = useCallback(async () => {
    const { state, changed } = await syncWithServer();
    setServer(state);
    if (changed) await reload();
  }, [reload]);

  // Every fresh price list is checked against the armed wires.
  const onPrices = useCallback(
    async (prices: PriceMap) => {
      await reconcile(); // first, so a wire the server already fired isn't fired again here
      const fired = await evaluateTripwires(prices);
      if (fired.length > 0) {
        await reload();
        void reconcile(); // tell the server, so it never pushes a wire this phone handled
      }
    },
    [reconcile, reload],
  );
  const { coins, status, updatedAt, refreshing, refresh } = useMarket(onPrices);
  const prices = useMemo<PriceMap>(() => Object.fromEntries(coins.map((c) => [c.id, c.price])), [coins]);

  useEffect(() => {
    const check = () => notificationsAllowed().then(setAllowed, () => undefined);
    prepareChannel().catch(() => undefined);
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, []);

  // Keep the OS-level background job registered only while something is armed.
  useEffect(() => {
    syncBackgroundCheck(armed.length > 0).then(setBackground);
  }, [armed.length]);

  useEffect(() => onNotificationTap(() => setTab('tripwires')), []);
  // A server push that lands while the app is open should update the list at once.
  useEffect(() => onNotificationReceived(() => void reconcile()), [reconcile]);

  const ensureAllowed = useCallback(async () => {
    const ok = await requestNotifications();
    setAllowed(ok);
    if (!ok) {
      Alert.alert('Notifications are off', 'Tripwire can only alert you once notifications are allowed for it.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => void Linking.openSettings() },
      ]);
    }
    return ok;
  }, []);

  const onArm = useCallback(
    async (wire: NewTripwire) => {
      await arm(wire);
      await ensureAllowed(); // before the first sync: the push token needs permission
      void reconcile();
    },
    [arm, ensureAllowed, reconcile],
  );

  const onRemove = useCallback(
    async (id: string) => {
      await remove(id);
      void reconcile();
    },
    [remove, reconcile],
  );

  const onClearTripped = useCallback(async () => {
    await clearTripped();
    void reconcile();
  }, [clearTripped, reconcile]);

  const onTest = useCallback(async () => {
    if (!(await ensureAllowed())) return;
    if (serverConfigured) {
      try {
        if (await sendServerTest(10)) {
          Alert.alert(
            'Test on its way',
            'Your server will push a test alert in about 10 seconds. Fully close Tripwire now to prove it reaches you when the app is closed.',
          );
          return;
        }
      } catch {
        Alert.alert('Server test failed', 'Tripwire couldn’t reach your server, so this is a local test instead.');
      }
    }
    await notifyTest();
  }, [ensureAllowed]);

  return (
    <View style={styles.root}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />

      {/* Android blurs whatever is inside this view behind the floating tab bar. */}
      <BlurTargetView ref={blurTarget} style={styles.flex}>
        <View style={[styles.flex, tab !== 'market' && styles.hidden]}>
          <MarketScreen
            coins={coins}
            status={status}
            updatedAt={updatedAt}
            refreshing={refreshing}
            armed={armed}
            onRefresh={refresh}
            onPick={setPicked}
          />
        </View>
        <View style={[styles.flex, tab !== 'tripwires' && styles.hidden]}>
          <TripwiresScreen
            armed={armed}
            tripped={tripped}
            prices={prices}
            notifications={allowed}
            background={background}
            server={server}
            onRemove={onRemove}
            onClearTripped={onClearTripped}
            onTest={onTest}
            onOpenSettings={() => void Linking.openSettings()}
          />
        </View>
      </BlurTargetView>

      <FloatingTabs tab={tab} armedCount={armed.length} onChange={setTab} blurTarget={blurTarget} />
      <TripwireSheet coin={picked} onClose={() => setPicked(null)} onArm={onArm} />
    </View>
  );
}

// Waits for fonts. The native background already matches the page, so nothing flashes.
function Gate() {
  const { colors } = useTheme();
  const [loaded] = useFonts({
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
    DMMono_400Regular,
    DMMono_500Medium,
  });
  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return <Root />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Gate />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    flex: { flex: 1 },
    hidden: { display: 'none' },
  });
