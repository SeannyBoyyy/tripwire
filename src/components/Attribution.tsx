import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import { fonts, gutter, useStyles, type Palette } from '../theme';

/** CoinGecko's free plans require visible, linked attribution wherever its data is shown. */
export function Attribution() {
  const styles = useStyles(createStyles);
  return (
    <Pressable
      onPress={() => void Linking.openURL('https://www.coingecko.com')}
      accessibilityRole="link"
      accessibilityLabel="Data provided by CoinGecko. Opens coingecko.com"
      hitSlop={10}
      style={styles.wrap}
    >
      <Text style={styles.text}>DATA PROVIDED BY COINGECKO</Text>
    </Pressable>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { marginTop: 32, paddingHorizontal: gutter, alignSelf: 'flex-start' },
    text: {
      fontFamily: fonts.mono,
      fontSize: 11,
      letterSpacing: 1.4,
      color: c.dim,
      textDecorationLine: 'underline',
    },
  });
