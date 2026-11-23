import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Keypad } from './Keypad';
import { applyKey, fmtPrice, fmtTarget, groupDigits, parseTarget, roundNice, toInput, type KeyId } from '../domain/format';
import { MAX_ARMED } from '../domain/rules';
import { fonts, gutter, hairline, useStyles, useTheme, type Palette } from '../theme';
import type { Coin, Direction, NewTripwire } from '../domain/types';
import { Segmented, Sparkline } from './ui';

const STEPS = [1, 3, 5, 10];
const DIRECTIONS = [
  { value: 'below', label: '↓ FALLS BELOW' },
  { value: 'above', label: '↑ RISES ABOVE' },
] as const;

type Verdict = { ok: boolean; warn: boolean; note: string };

function judge(direction: Direction, target: number | null, coin: Coin, armedCount: number): Verdict {
  if (armedCount >= MAX_ARMED) {
    return { ok: false, warn: true, note: `Tripwire can watch ${MAX_ARMED} at a time. Disarm one to add another.` };
  }
  if (target === null) {
    return { ok: false, warn: false, note: 'Enter a target in USD, or pick a distance below.' };
  }
  const below = direction === 'below';
  if (below ? target >= coin.price : target <= coin.price) {
    return {
      ok: false,
      warn: true,
      note: `${coin.symbol} is already ${below ? 'under' : 'over'} $${fmtTarget(target)}, so this would trip instantly.`,
    };
  }
  const pct = Math.abs(target / coin.price - 1) * 100;
  return {
    ok: true,
    warn: false,
    note: `Trips after a ${pct.toFixed(1)}% ${below ? 'drop' : 'rise'} from ${fmtPrice(coin.price)}.`,
  };
}

function Caret() {
  const { colors } = useTheme();
  const blink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0, duration: 520, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 520, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [blink]);
  return (
    <Animated.View
      style={{ width: 2, height: 40, marginHorizontal: 3, backgroundColor: colors.amberText, opacity: blink }}
    />
  );
}

type Props = {
  coin: Coin | null;
  /** How many wires are armed right now; the sheet won't arm past MAX_ARMED. */
  armedCount: number;
  onClose: () => void;
  onArm: (wire: NewTripwire) => void;
};

export function TripwireSheet({ coin, armedCount, onClose, onArm }: Props) {
  // Keyed by coin so every open starts from a clean form.
  return coin ? <Sheet key={coin.id} coin={coin} armedCount={armedCount} onClose={onClose} onArm={onArm} /> : null;
}

function Sheet({
  coin,
  armedCount,
  onClose,
  onArm,
}: {
  coin: Coin;
  armedCount: number;
  onClose: () => void;
  onArm: Props['onArm'];
}) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [direction, setDirection] = useState<Direction>('below');
  const [raw, setRaw] = useState('');
  const enter = useRef(new Animated.Value(0)).current;

  // Everything has to fit without scrolling, so trade chart height for keypad on short screens.
  const chartHeight = height >= 760 ? 76 : height >= 660 ? 52 : 0;
  const keyHeight = height >= 760 ? 56 : 46;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  const close = () =>
    Animated.timing(enter, {
      toValue: 0,
      duration: 150,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(onClose);

  const below = direction === 'below';
  const target = parseTarget(raw);
  const verdict = useMemo(() => judge(direction, target, coin, armedCount), [direction, target, coin, armedCount]);
  const weekUp = coin.spark.length > 1 ? coin.spark[coin.spark.length - 1] >= coin.spark[0] : true;
  const suggestion = toInput(roundNice(coin.price * (below ? 0.97 : 1.03)));

  const press = (key: KeyId) => {
    void Haptics.selectionAsync();
    setRaw((current) => applyKey(current, key));
  };

  const pick = (pct: number) => {
    void Haptics.selectionAsync();
    setRaw(toInput(roundNice(coin.price * (below ? 1 - pct / 100 : 1 + pct / 100))));
  };

  const arm = () => {
    if (!verdict.ok || target === null) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onArm({
      coinId: coin.id,
      symbol: coin.symbol,
      name: coin.name,
      direction,
      target,
      startPrice: coin.price,
    });
    close();
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: enter }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
      </Animated.View>

      <Animated.View
        style={[
          styles.sheet,
          {
            paddingBottom: insets.bottom + 12,
            opacity: enter,
            transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }) }],
          },
        ]}
      >
        <View style={styles.head}>
          <View style={styles.flex}>
            <Text style={styles.kicker}>ARM A TRIPWIRE</Text>
            <Text style={styles.coinName}>{coin.name}</Text>
          </View>
          <View style={styles.now}>
            <Text style={styles.kicker}>NOW</Text>
            <Text style={styles.nowPrice}>{fmtPrice(coin.price)}</Text>
          </View>
        </View>

        {chartHeight > 0 && (
          <Sparkline
            data={coin.spark}
            width={width - gutter * 2}
            height={chartHeight}
            color={weekUp ? colors.gain : colors.loss}
            target={target ?? undefined}
          />
        )}

        <View style={styles.block}>
          <Segmented options={DIRECTIONS} value={direction} onChange={setDirection} />
        </View>

        <View style={styles.display} accessible accessibilityLabel={`Target price ${raw || 'empty'} US dollars`}>
          <Text style={styles.dollar}>$</Text>
          {raw === '' && <Caret />}
          <Text
            style={[styles.amount, raw === '' && styles.amountEmpty]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.55}
          >
            {raw === '' ? groupDigits(suggestion) : groupDigits(raw)}
          </Text>
          {raw !== '' && <Caret />}
          <View style={styles.flex} />
          <Text style={styles.unit}>USD</Text>
        </View>

        <View style={styles.chips}>
          {STEPS.map((pct) => (
            <Pressable key={pct} onPress={() => pick(pct)} style={styles.chip} accessibilityRole="button">
              <Text style={styles.chipText}>
                {below ? '−' : '+'}
                {pct}%
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.note, verdict.warn && { color: colors.loss }]}>{verdict.note}</Text>

        <Keypad onKey={press} keyHeight={keyHeight} />

        <Pressable
          onPress={arm}
          disabled={!verdict.ok}
          accessibilityRole="button"
          style={({ pressed }) => [styles.cta, !verdict.ok && styles.ctaOff, pressed && verdict.ok && { opacity: 0.85 }]}
        >
          <Text style={[styles.ctaText, !verdict.ok && styles.ctaTextOff]}>ARM TRIPWIRE</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    backdrop: { backgroundColor: c.scrim },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: c.surface,
      borderTopWidth: 2,
      borderTopColor: c.amber,
      paddingHorizontal: gutter,
      paddingTop: 18,
    },
    head: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12 },
    kicker: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.6, color: c.dim },
    coinName: { fontFamily: fonts.serif, fontSize: 40, lineHeight: 44, color: c.text, letterSpacing: -0.5 },
    now: { alignItems: 'flex-end' },
    nowPrice: { fontFamily: fonts.monoMedium, fontSize: 17, color: c.text, marginTop: 2 },
    block: { marginTop: 14 },
    display: { flexDirection: 'row', alignItems: 'center', height: 68, marginTop: 8 },
    dollar: { fontFamily: fonts.serif, fontSize: 44, color: c.dim, marginRight: 6 },
    amount: { flexShrink: 1, fontFamily: fonts.serif, fontSize: 52, color: c.text, letterSpacing: -0.5 },
    amountEmpty: { color: c.faint },
    unit: { fontFamily: fonts.mono, fontSize: 12, letterSpacing: 1.4, color: c.dim },
    chips: { flexDirection: 'row', gap: 8 },
    chip: { paddingVertical: 8, paddingHorizontal: 14, borderWidth: hairline, borderColor: c.faint },
    chipText: { fontFamily: fonts.mono, fontSize: 12, color: c.text },
    note: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: c.dim, marginTop: 10, marginBottom: 10, minHeight: 36 },
    cta: { marginTop: 12, paddingVertical: 16, alignItems: 'center', backgroundColor: c.amber },
    ctaOff: { backgroundColor: c.press },
    ctaText: { fontFamily: fonts.monoMedium, fontSize: 13, letterSpacing: 2, color: c.onAmber },
    ctaTextOff: { color: c.dim },
  });
