import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { view } from '../domain/testAlert';
import { useTestAlert } from '../hooks/useTestAlert';
import { serverConfigured, type ServerState } from '../services/sync';
import { fonts, hairline, useStyles, useTheme, type Palette } from '../theme';

/**
 * The test button and everything it has to say. It always answers: pressed,
 * sending, on its way (with a countdown), received, or, if it didn't work, why
 * and what to try.
 */
export function TestAlert({ server }: { server: ServerState }) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const connected = server === 'connected';
  const { state, now, start } = useTestAlert(connected);
  const v = view(state, { serverConfigured, serverConnected: connected, now });

  const accent = { neutral: colors.faint, active: colors.amberText, good: colors.gain, bad: colors.loss }[v.tone];

  // Smooth bar: each ~250ms update glides to the next value instead of stepping.
  const bar = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (v.progress === undefined) {
      bar.setValue(0);
      return;
    }
    Animated.timing(bar, { toValue: v.progress, duration: 260, easing: Easing.linear, useNativeDriver: false }).start();
  }, [v.progress, bar]);

  return (
    <View>
      <Pressable
        onPress={start}
        disabled={v.busy}
        accessibilityRole="button"
        accessibilityState={{ busy: v.busy, disabled: v.busy }}
        style={({ pressed }) => [
          styles.button,
          { borderColor: accent },
          pressed && styles.down,
        ]}
      >
        {state.phase === 'sending' && <ActivityIndicator size="small" color={accent} />}
        <Text style={[styles.label, v.tone !== 'neutral' && { color: accent }]}>{v.label}</Text>
        <Animated.View
          style={[
            styles.fill,
            { backgroundColor: accent, width: bar.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
          ]}
        />
      </Pressable>

      {(v.note !== '' || v.tips.length > 0) && (
        <View style={styles.message} accessibilityLiveRegion="polite">
          {v.note !== '' && <Text style={styles.note}>{v.note}</Text>}
          {v.tips.map((tip) => (
            <View key={tip} style={styles.tipRow}>
              <Text style={styles.tip}>–</Text>
              <Text style={[styles.tip, styles.tipText]}>{tip}</Text>
            </View>
          ))}
        </View>
      )}

      {v.action === 'open-settings' && (
        <Pressable
          onPress={() => void Linking.openSettings()}
          accessibilityRole="button"
          hitSlop={10}
          style={({ pressed }) => [styles.link, pressed && styles.linkDown]}
        >
          <Text style={styles.linkText}>OPEN SETTINGS</Text>
        </Pressable>
      )}
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingVertical: 14,
      borderWidth: hairline,
      overflow: 'hidden',
    },
    down: { backgroundColor: c.press, transform: [{ scale: 0.985 }] },
    label: { fontFamily: fonts.monoMedium, fontSize: 12, letterSpacing: 1.6, color: c.text },
    fill: { position: 'absolute', left: 0, bottom: 0, height: 2 },
    message: { marginTop: 10, gap: 6 },
    note: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: c.dim },
    tipRow: { flexDirection: 'row', gap: 10 },
    tip: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: c.dim },
    tipText: { flex: 1 },
    link: { marginTop: 12, alignSelf: 'flex-start' },
    linkDown: { opacity: 0.5 },
    linkText: { fontFamily: fonts.monoMedium, fontSize: 11, letterSpacing: 1.4, color: c.amberText },
  });
