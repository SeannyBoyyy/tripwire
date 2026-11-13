import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isExpoGo, type BackgroundState } from '../services/background';
import { fmtPrice, fmtTarget, fmtWhen } from '../domain/format';
import { TAB_BAR_CLEARANCE, fonts, gutter, hairline, useStyles, useTheme, type Palette } from '../theme';
import type { ServerState } from '../services/sync';
import type { PriceMap, Tripwire } from '../domain/types';
import { Attribution } from '../components/Attribution';
import { TestAlert } from '../components/TestAlert';
import { Segmented } from '../components/ui';

const MODES = [
  { value: 'system', label: 'SYSTEM' },
  { value: 'light', label: 'LIGHT' },
  { value: 'dark', label: 'DARK' },
] as const;

type Props = {
  armed: Tripwire[];
  tripped: Tripwire[];
  prices: PriceMap;
  notifications: boolean;
  background: BackgroundState;
  server: ServerState;
  onRemove: (id: string) => void;
  onClearTripped: () => void;
  onOpenSettings: () => void;
};

function SectionHead({ label, action, onAction }: { label: string; action?: string; onAction?: () => void }) {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {action && (
        <Pressable onPress={onAction} hitSlop={14}
          style={({ pressed }) => pressed && styles.pressed}>
          <Text style={styles.action}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

function ArmedRow({
  wire,
  price,
  onRemove,
}: {
  wire: Tripwire;
  price: number | undefined;
  onRemove: (id: string) => void;
}) {
  const styles = useStyles(createStyles);
  const below = wire.direction === 'below';
  const span = wire.target - wire.startPrice;
  const progress =
    price === undefined || span === 0 ? 0 : Math.min(1, Math.max(0, (price - wire.startPrice) / span));
  const away = price === undefined ? null : Math.abs(wire.target / price - 1) * 100;

  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <View style={styles.flex}>
          <Text style={styles.label}>
            {wire.symbol} · {below ? 'FALLS BELOW' : 'RISES ABOVE'}
          </Text>
          <Text style={styles.target}>${fmtTarget(wire.target)}</Text>
        </View>
        <Pressable
          onPress={() => onRemove(wire.id)}
          hitSlop={14}
          style={({ pressed }) => pressed && styles.pressed}
          accessibilityRole="button"
          accessibilityLabel={`Disarm ${wire.symbol} tripwire`}
        >
          <Text style={styles.action}>DISARM</Text>
        </Pressable>
      </View>
      <View style={styles.rule}>
        <View style={[styles.ruleFill, { width: `${progress * 100}%` }]} />
        <View style={styles.ruleEnd} />
      </View>
      <Text style={styles.meta}>
        {price === undefined || away === null
          ? 'Waiting for a price…'
          : `Now ${fmtPrice(price)} · ${away.toFixed(2)}% to go`}
      </Text>
    </View>
  );
}

function TrippedRow({ wire, onRemove }: { wire: Tripwire; onRemove: (id: string) => void }) {
  const styles = useStyles(createStyles);
  const below = wire.direction === 'below';
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <View style={styles.flex}>
          <Text style={styles.label}>
            {wire.symbol} · {below ? 'FELL BELOW' : 'ROSE ABOVE'}
          </Text>
          <Text style={[styles.target, styles.targetDone]}>${fmtTarget(wire.target)}</Text>
        </View>
        <Pressable
          onPress={() => onRemove(wire.id)}
          hitSlop={14}
          style={({ pressed }) => pressed && styles.pressed}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${wire.symbol} tripwire`}
        >
          <Text style={styles.action}>DELETE</Text>
        </Pressable>
      </View>
      <Text style={styles.meta}>
        {fmtWhen(wire.trippedAt ?? wire.createdAt)} · hit at {fmtPrice(wire.trippedPrice ?? wire.target)}
      </Text>
    </View>
  );
}

function closedLine(server: ServerState, background: BackgroundState): string {
  switch (server) {
    case 'connected':
      return 'Your server watches every few minutes and sends a push notification, even when Tripwire is fully closed.';
    case 'connecting':
      return 'Connecting to your server…';
    case 'needs-permission':
      return 'Allow notifications to connect your server.';
    case 'needs-project':
      return 'Run npx eas-cli init once so this project has an ID, then restart Expo.';
    case 'error':
      return 'Can’t reach your server right now, so alerts only fire while Tripwire is open.';
    default:
      return isExpoGo
        ? 'Expo Go can’t be relied on to wake Tripwire. Set up the server to be alerted while it’s closed.'
        : background === 'active'
          ? 'The OS wakes Tripwire at most every 15 minutes, and iOS often waits much longer.'
          : 'Background checks aren’t available on this device.';
  }
}

function Coverage({
  hasArmed,
  notifications,
  background,
  server,
  onOpenSettings,
}: Pick<Props, 'notifications' | 'background' | 'server' | 'onOpenSettings'> & { hasArmed: boolean }) {
  const styles = useStyles(createStyles);
  const closed = closedLine(server, background);

  return (
    <View style={styles.panel}>
      <Text style={styles.sectionLabel}>COVERAGE</Text>
      <Text style={styles.coverLine}>
        <Text style={styles.coverKey}>APP OPEN   </Text>
        Checked every minute. A tripped wire notifies you at once.
      </Text>
      <Text style={styles.coverLine}>
        <Text style={styles.coverKey}>APP CLOSED   </Text>
        {closed}
      </Text>
      {hasArmed && !notifications && (
        <Pressable onPress={onOpenSettings} style={({ pressed }) => pressed && styles.pressed}>
          <Text style={styles.warn}>NOTIFICATIONS ARE OFF — OPEN SETTINGS</Text>
        </Pressable>
      )}
      <TestAlert server={server} />
    </View>
  );
}

function AppearancePicker() {
  const styles = useStyles(createStyles);
  const { mode, setMode } = useTheme();
  return (
    <View style={styles.panel}>
      <Text style={styles.sectionLabel}>APPEARANCE</Text>
      <Segmented options={MODES} value={mode} onChange={setMode} />
    </View>
  );
}

export function TripwiresScreen({
  armed,
  tripped,
  prices,
  notifications,
  background,
  server,
  onRemove,
  onClearTripped,
  onOpenSettings,
}: Props) {
  const styles = useStyles(createStyles);
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.mast}>
        <Text style={styles.kicker}>
          {armed.length} ARMED · {tripped.length} TRIPPED
        </Text>
        <Text style={styles.title}>Tripwires</Text>
      </View>

      {armed.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing armed.</Text>
          <Text style={styles.emptyBody}>Tap any coin on the Market tab to set a price to watch.</Text>
        </View>
      ) : (
        armed.map((wire) => (
          <ArmedRow key={wire.id} wire={wire} price={prices[wire.coinId]} onRemove={onRemove} />
        ))
      )}

      {tripped.length > 0 && (
        <>
          <SectionHead label="TRIPPED" action="CLEAR ALL" onAction={onClearTripped} />
          {tripped.map((wire) => (
            <TrippedRow key={wire.id} wire={wire} onRemove={onRemove} />
          ))}
        </>
      )}

      <Coverage
        hasArmed={armed.length > 0}
        notifications={notifications}
        background={background}
        server={server}
        onOpenSettings={onOpenSettings}
      />
      <AppearancePicker />
      <Attribution />
    </ScrollView>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    mast: {
      paddingHorizontal: gutter,
      paddingBottom: 16,
      borderBottomWidth: hairline,
      borderBottomColor: c.line,
    },
    kicker: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.4, color: c.dim },
    title: {
      fontFamily: fonts.serif,
      fontSize: 68,
      lineHeight: 72,
      letterSpacing: -1.5,
      color: c.text,
      marginTop: 8,
    },
    section: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: gutter,
      paddingTop: 28,
      paddingBottom: 10,
      borderBottomWidth: hairline,
      borderBottomColor: c.line,
    },
    sectionLabel: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.6, color: c.dim },
    row: {
      paddingVertical: 18,
      paddingHorizontal: gutter,
      borderBottomWidth: hairline,
      borderBottomColor: c.line,
    },
    rowTop: { flexDirection: 'row', alignItems: 'flex-start' },
    label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.2, color: c.amberText },
    target: { fontFamily: fonts.serif, fontSize: 40, lineHeight: 46, color: c.text, letterSpacing: -0.5 },
    targetDone: { color: c.dim },
    action: { fontFamily: fonts.monoMedium, fontSize: 11, letterSpacing: 1.4, color: c.dim },
    rule: { height: 2, backgroundColor: c.line, marginTop: 14, marginRight: 1 },
    ruleFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: c.amber },
    ruleEnd: { position: 'absolute', right: -1, top: -5, width: 2, height: 12, backgroundColor: c.amber },
    meta: { fontFamily: fonts.mono, fontSize: 12, color: c.dim, marginTop: 12 },
    empty: { paddingVertical: 48, paddingHorizontal: gutter, gap: 8 },
    emptyTitle: { fontFamily: fonts.serifItalic, fontSize: 30, color: c.text },
    emptyBody: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: c.dim },
    panel: {
      marginTop: 36,
      marginHorizontal: gutter,
      paddingTop: 14,
      borderTopWidth: hairline,
      borderTopColor: c.faint,
      gap: 10,
    },
    coverLine: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: c.dim },
    coverKey: { fontFamily: fonts.monoMedium, color: c.text, letterSpacing: 1 },
    warn: { fontFamily: fonts.monoMedium, fontSize: 11, letterSpacing: 1, color: c.loss, marginTop: 4 },
    pressed: { opacity: 0.5 },
  });
