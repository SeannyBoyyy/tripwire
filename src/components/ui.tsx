import { useEffect, useReducer, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Svg, { Line, Polyline } from 'react-native-svg';
import { fmtAgo } from '../domain/format';
import { fonts, hairline, useStyles, useTheme, type Palette } from '../theme';

type SparklineProps = {
  data: number[];
  width: number;
  height: number;
  color: string;
  /** Draws a dashed line at this price and widens the scale to include it. */
  target?: number;
};

export function Sparkline({ data, width, height, color, target }: SparklineProps) {
  const { colors } = useTheme();
  if (data.length < 2 || height <= 0) return <View style={{ width, height }} />;

  const hasTarget = target !== undefined && Number.isFinite(target);
  const lo = Math.min(...data, ...(hasTarget ? [target] : []));
  const hi = Math.max(...data, ...(hasTarget ? [target] : []));
  const span = hi - lo || 1;
  const pad = 2;
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2);
  const step = width / (data.length - 1);
  const points = data.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  return (
    <Svg width={width} height={height}>
      {hasTarget && (
        <Line
          x1={0}
          x2={width}
          y1={y(target)}
          y2={y(target)}
          stroke={colors.amberText}
          strokeWidth={1}
          strokeDasharray="5 4"
        />
      )}
      <Polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function LiveDot({ live }: { live: boolean }) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!live) {
      pulse.setValue(0.4);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [live, pulse]);

  return (
    <Animated.View
      style={{
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: live ? colors.amber : colors.faint,
        opacity: pulse,
      }}
    />
  );
}

/** "12s ago", ticking once a second. Keeps its own clock so parents don't re-render. */
export function Ago({ since, style }: { since: number | null; style?: TextStyle }) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  return <Text style={style}>{since ? fmtAgo(Date.now() - since) : '—'}</Text>;
}

type SegmentedProps<T extends string> = {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
};

export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  const styles = useStyles(createSegmentedStyles);
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.button, on && styles.on]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.text, on && styles.textOn]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const createSegmentedStyles = (c: Palette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', borderWidth: hairline, borderColor: c.faint },
    button: { flex: 1, paddingVertical: 12, alignItems: 'center' },
    on: { backgroundColor: c.text },
    text: { fontFamily: fonts.monoMedium, fontSize: 12, letterSpacing: 1.2, color: c.dim },
    textOn: { color: c.bg },
  });
