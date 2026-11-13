import { memo, useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { arrow, fmtPct, fmtPrice, fmtTarget } from '../domain/format';
import { TAB_BAR_CLEARANCE, fonts, gutter, hairline, useStyles, useTheme, type Palette } from '../theme';
import type { Coin, Tripwire } from '../domain/types';
import { Attribution } from '../components/Attribution';
import { Ago, LiveDot, Sparkline } from '../components/ui';
import type { MarketStatus } from '../hooks/useMarket';

const NO_WIRES: Tripwire[] = [];

type Props = {
  coins: Coin[];
  status: MarketStatus;
  updatedAt: number | null;
  refreshing: boolean;
  armed: Tripwire[];
  onRefresh: () => void;
  onPick: (coin: Coin) => void;
};

function Masthead({ coins, status, updatedAt }: Pick<Props, 'coins' | 'status' | 'updatedAt'>) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();

  const { up, down, median } = useMemo(() => {
    const changes = coins.map((c) => c.change24h).sort((a, b) => a - b);
    const mid = (changes.length - 1) / 2;
    const med = changes.length ? (changes[Math.floor(mid)] + changes[Math.ceil(mid)]) / 2 : 0;
    const ups = changes.filter((c) => c >= 0).length;
    return { up: ups, down: changes.length - ups, median: med };
  }, [coins]);

  const today = new Date()
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    .toUpperCase();
  const live = status === 'live';
  const label = status === 'error' ? 'OFFLINE' : status === 'stale' ? 'STALE' : live ? 'LIVE' : 'SYNCING';

  return (
    <View style={styles.mast}>
      <View style={styles.kickerRow}>
        <Text style={styles.kicker}>{today}</Text>
        <View style={styles.status}>
          <LiveDot live={live} />
          <Text style={styles.kicker}>{label}</Text>
          <Ago since={updatedAt} style={styles.kickerDim} />
        </View>
      </View>
      <Text style={styles.title}>Market</Text>
      {coins.length > 0 && (
        <Text style={styles.tape}>
          TOP {coins.length} EX-STABLES{'   '}
          <Text style={{ color: colors.gain }}>{up} ▲</Text>
          {'   '}
          <Text style={{ color: colors.loss }}>{down} ▼</Text>
          {'   '}MEDIAN {median >= 0 ? '+' : '−'}
          {Math.abs(median).toFixed(2)}%
        </Text>
      )}
    </View>
  );
}

const CoinRow = memo(function CoinRow({
  coin,
  wires,
  onPress,
}: {
  coin: Coin;
  wires: Tripwire[];
  onPress: (coin: Coin) => void;
}) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const up = coin.change24h >= 0;
  const weekUp = coin.spark.length > 1 ? coin.spark[coin.spark.length - 1] >= coin.spark[0] : up;

  return (
    <Pressable
      onPress={() => onPress(coin)}
      accessibilityRole="button"
      accessibilityLabel={`${coin.name}, ${fmtPrice(coin.price)}. Set a tripwire`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.press }]}
    >
      <Text style={styles.rank}>{String(coin.rank).padStart(2, '0')}</Text>
      <View style={styles.identity}>
        <Text style={styles.symbol}>{coin.symbol}</Text>
        <Text style={styles.name} numberOfLines={1}>
          {coin.name}
        </Text>
        {wires.length > 0 && (
          <Text style={styles.wire} numberOfLines={1}>
            ◆ {wires.map((w) => `${w.direction === 'below' ? '↓' : '↑'} ${fmtTarget(w.target)}`).join('   ')}
          </Text>
        )}
      </View>
      <Sparkline data={coin.spark} width={60} height={28} color={weekUp ? colors.gain : colors.loss} />
      <View style={styles.quote}>
        <Text style={styles.price}>{fmtPrice(coin.price)}</Text>
        <Text style={[styles.change, { color: up ? colors.gain : colors.loss }]}>
          {arrow(coin.change24h)} {fmtPct(coin.change24h)}
        </Text>
      </View>
    </Pressable>
  );
});

function Empty({ status }: { status: MarketStatus }) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  if (status === 'loading') {
    return (
      <View style={styles.empty}>
        <ActivityIndicator color={colors.amberText} />
      </View>
    );
  }
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>Can’t reach the tape.</Text>
      <Text style={styles.emptyBody}>CoinGecko didn’t answer. Pull down to try again.</Text>
    </View>
  );
}

export function MarketScreen({ coins, status, updatedAt, refreshing, armed, onRefresh, onPick }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const wiresByCoin = useMemo(() => {
    const map = new Map<string, Tripwire[]>();
    for (const wire of armed) map.set(wire.coinId, [...(map.get(wire.coinId) ?? []), wire]);
    return map;
  }, [armed]);

  return (
    <FlatList
      data={coins}
      keyExtractor={(c) => c.id}
      renderItem={({ item }) => (
        <CoinRow coin={item} wires={wiresByCoin.get(item.id) ?? NO_WIRES} onPress={onPick} />
      )}
      ListHeaderComponent={<Masthead coins={coins} status={status} updatedAt={updatedAt} />}
      ListEmptyComponent={<Empty status={status} />}
      ListFooterComponent={coins.length > 0 ? <Attribution /> : undefined}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.amberText}
          colors={[colors.amberText]}
          progressBackgroundColor={colors.surface}
          progressViewOffset={insets.top}
        />
      }
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }}
      showsVerticalScrollIndicator={false}
    />
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    mast: {
      paddingHorizontal: gutter,
      paddingBottom: 16,
      borderBottomWidth: hairline,
      borderBottomColor: c.line,
    },
    kickerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    status: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    kicker: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.4, color: c.dim },
    kickerDim: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.2, color: c.dim },
    title: {
      fontFamily: fonts.serif,
      fontSize: 68,
      lineHeight: 72,
      letterSpacing: -1.5,
      color: c.text,
      marginTop: 8,
    },
    tape: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.8, color: c.dim, marginTop: 8 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: gutter,
      borderBottomWidth: hairline,
      borderBottomColor: c.line,
    },
    rank: { width: 18, fontFamily: fonts.mono, fontSize: 11, color: c.faint },
    identity: { flex: 1, minWidth: 0 },
    symbol: { fontFamily: fonts.monoMedium, fontSize: 15, letterSpacing: 0.8, color: c.text },
    name: { fontFamily: fonts.serifItalic, fontSize: 16, color: c.dim, marginTop: 1 },
    wire: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.6, color: c.amberText, marginTop: 5 },
    quote: { alignItems: 'flex-end', minWidth: 104 },
    price: { fontFamily: fonts.monoMedium, fontSize: 15, color: c.text },
    change: { fontFamily: fonts.mono, fontSize: 12, marginTop: 3 },
    empty: { paddingVertical: 64, paddingHorizontal: gutter, alignItems: 'center', gap: 8 },
    emptyTitle: { fontFamily: fonts.serifItalic, fontSize: 26, color: c.text },
    emptyBody: { fontFamily: fonts.mono, fontSize: 12, color: c.dim, textAlign: 'center' },
  });
