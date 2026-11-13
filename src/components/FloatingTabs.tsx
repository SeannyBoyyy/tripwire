import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useRef, useState, type ComponentRef, type ReactNode, type RefObject } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, hairline, useStyles, useTheme, type Palette } from '../theme';

export type Tab = 'market' | 'tripwires';

type Props = {
  tab: Tab;
  armedCount: number;
  onChange: (tab: Tab) => void;
  /** The BlurTargetView wrapping the screens. Android blurs whatever sits inside it. */
  blurTarget: RefObject<ComponentRef<typeof View> | null>;
};

const INSET = 6;
const BAR_HEIGHT = 60;

// "Reduce Transparency" is an iOS setting; other platforms have no equivalent to honour.
function useReduceTransparency(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AccessibilityInfo.isReduceTransparencyEnabled().then(setReduce, () => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

/**
 * A floating capsule of navigation. Glass belongs on this layer only: it
 * floats over the content and the content stays flat.
 *  - iOS 26+: native Liquid Glass.
 *  - Android and older iOS: a blurred, tinted capsule.
 *  - Reduce Transparency: a solid capsule.
 */
export function FloatingTabs({ tab, armedCount, onChange, blurTarget }: Props) {
  const { scheme } = useTheme();
  const styles = useStyles(createStyles);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduce = useReduceTransparency();

  const barWidth = Math.min(width - 40, 340);
  const tabWidth = (barWidth - INSET * 2) / 2;
  const slide = useRef(new Animated.Value(tab === 'market' ? 0 : 1)).current;

  useEffect(() => {
    Animated.spring(slide, {
      toValue: tab === 'market' ? 0 : 1,
      damping: 18,
      stiffness: 220,
      mass: 0.9,
      useNativeDriver: true,
    }).start();
  }, [tab, slide]);

  const items: { id: Tab; label: string }[] = [
    { id: 'market', label: 'MARKET' },
    { id: 'tripwires', label: armedCount > 0 ? `TRIPWIRES · ${armedCount}` : 'TRIPWIRES' },
  ];

  const row = (
    <View style={styles.inner}>
      <Animated.View
        style={[
          styles.pill,
          {
            width: tabWidth,
            transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, tabWidth] }) }],
          },
        ]}
      />
      {items.map((item) => {
        const on = tab === item.id;
        return (
          <Pressable
            key={item.id}
            onPress={() => onChange(item.id)}
            style={[styles.tab, { width: tabWidth }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const shape = [styles.bar, { width: barWidth }];
  let surface: ReactNode;
  if (reduce) {
    surface = <View style={[shape, styles.solid]}>{row}</View>;
  } else if (Platform.OS === 'ios' && isLiquidGlassAvailable()) {
    surface = (
      <GlassView style={shape} glassEffectStyle="regular" colorScheme={scheme}>
        {row}
      </GlassView>
    );
  } else {
    surface = (
      <BlurView
        blurTarget={blurTarget}
        blurMethod="dimezisBlurViewSdk31Plus"
        intensity={55}
        tint={scheme}
        style={[shape, styles.frosted]}
      >
        {row}
      </BlurView>
    );
  }

  return <View style={[styles.dock, { bottom: Math.max(insets.bottom, 12) + 4 }]}>{surface}</View>;
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    dock: { position: 'absolute', left: 0, right: 0, alignItems: 'center', pointerEvents: 'box-none' },
    bar: { height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, overflow: 'hidden' },
    frosted: { backgroundColor: c.glassFill, borderWidth: hairline, borderColor: c.glassEdge },
    solid: { backgroundColor: c.surface, borderWidth: hairline, borderColor: c.line },
    inner: { flex: 1, flexDirection: 'row', padding: INSET },
    pill: {
      position: 'absolute',
      left: INSET,
      top: INSET,
      bottom: INSET,
      borderRadius: (BAR_HEIGHT - INSET * 2) / 2,
      backgroundColor: c.glassActive,
      borderWidth: hairline,
      borderColor: c.amberText,
    },
    tab: { alignItems: 'center', justifyContent: 'center' },
    label: { fontFamily: fonts.monoMedium, fontSize: 12, letterSpacing: 1.6, color: c.dim },
    labelOn: { color: c.text },
  });
