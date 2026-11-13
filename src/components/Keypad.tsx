import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { KeyId } from '../domain/format';
import { fonts, hairline, useStyles, useTheme, type Palette } from '../theme';

const ROWS: KeyId[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'back'],
];

function BackIcon({ color }: { color: string }) {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6}>
      <Path d="M9.5 5.5H20.5V18.5H9.5L3.5 12L9.5 5.5Z" strokeLinejoin="round" />
      <Path d="M13.2 9.2L17.4 14.8M17.4 9.2L13.2 14.8" strokeLinecap="round" />
    </Svg>
  );
}

type Props = {
  onKey: (key: KeyId) => void;
  keyHeight: number;
};

/**
 * An in-app number pad. It never resizes the screen, formats as you type, and
 * behaves the same on every phone and keyboard locale. Hold backspace to clear.
 */
export function Keypad({ onKey, keyHeight }: Props) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();

  return (
    <View style={styles.grid}>
      {ROWS.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((key, i) => (
            <Pressable
              key={key}
              onPress={() => onKey(key)}
              onLongPress={key === 'back' ? () => onKey('clear') : undefined}
              delayLongPress={350}
              accessibilityRole="button"
              accessibilityLabel={key === 'back' ? 'Delete' : key === '.' ? 'Decimal point' : key}
              style={({ pressed }) => [
                styles.key,
                { height: keyHeight },
                i > 0 && styles.keyDivider,
                pressed && styles.keyDown,
              ]}
            >
              {key === 'back' ? <BackIcon color={colors.dim} /> : <Text style={styles.digit}>{key}</Text>}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    grid: { borderTopWidth: hairline, borderTopColor: c.line },
    row: { flexDirection: 'row', borderBottomWidth: hairline, borderBottomColor: c.line },
    key: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    keyDivider: { borderLeftWidth: hairline, borderLeftColor: c.line },
    keyDown: { backgroundColor: c.press },
    digit: { fontFamily: fonts.serif, fontSize: 32, color: c.text },
  });
