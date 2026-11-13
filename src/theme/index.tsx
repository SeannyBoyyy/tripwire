import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SystemUI from 'expo-system-ui';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Appearance, StyleSheet, useColorScheme } from 'react-native';

export type Mode = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

export interface Palette {
  bg: string; // page
  surface: string; // sheets and panels
  press: string; // pressed rows
  line: string; // hairlines
  text: string;
  dim: string; // secondary text, 5:1+ on bg
  faint: string; // decorative only (ranks, captions, placeholders)
  amber: string; // fills: buttons, rules
  amberText: string; // amber used as *text* on bg
  onAmber: string; // text on an amber fill
  gain: string;
  loss: string;
  scrim: string;
  glassFill: string; // fallback fill when glass/blur isn't available
  glassEdge: string;
  glassActive: string; // selected tab pill
}

// Warm ink, bone paper, one caution-tape amber. Every text role is >= 4.5:1
// on its background (faint excepted: it is never used for anything essential).
const dark: Palette = {
  bg: '#0E0D0B',
  surface: '#161410',
  press: '#1D1A14',
  line: '#2B2822',
  text: '#EFE9DA',
  dim: '#8D8777',
  faint: '#6C6757',
  amber: '#F7B500',
  amberText: '#F7B500',
  onAmber: '#0E0D0B',
  gain: '#9AD17A',
  loss: '#FF5C3A',
  scrim: 'rgba(0,0,0,0.64)',
  glassFill: 'rgba(22,20,16,0.62)',
  glassEdge: 'rgba(239,233,218,0.16)',
  glassActive: 'rgba(247,181,0,0.20)',
};

const light: Palette = {
  bg: '#F4EFE3',
  surface: '#FBF8F0',
  press: '#EAE3D2',
  line: '#DAD2BF',
  text: '#16140F',
  dim: '#625C4C',
  faint: '#8A8370',
  amber: '#F7B500',
  amberText: '#8A5A00',
  onAmber: '#16140F',
  gain: '#2C7A3F',
  loss: '#C23A1C',
  scrim: 'rgba(22,18,10,0.42)',
  glassFill: 'rgba(251,248,240,0.70)',
  glassEdge: 'rgba(22,20,15,0.10)',
  glassActive: 'rgba(247,181,0,0.30)',
};

export const fonts = {
  serif: 'InstrumentSerif_400Regular',
  serifItalic: 'InstrumentSerif_400Regular_Italic',
  mono: 'DMMono_400Regular',
  monoMedium: 'DMMono_500Medium',
} as const;

export const hairline = StyleSheet.hairlineWidth;
export const gutter = 20;
/** Bottom space screens reserve so their last row clears the floating tab bar. */
export const TAB_BAR_CLEARANCE = 96;

const KEY = 'tripwire.mode.v1';

type ThemeValue = {
  mode: Mode;
  scheme: Scheme;
  colors: Palette;
  setMode: (mode: Mode) => void;
};

const ThemeContext = createContext<ThemeValue | null>(null);

// Also pushes the choice to the OS so native chrome (alerts, status bar) agrees.
// Not every platform implements the override (react-native-web doesn't), and the
// in-app palette must switch regardless.
const applyToSystem = (mode: Mode) => {
  try {
    Appearance.setColorScheme(mode === 'system' ? 'auto' : mode);
  } catch {
    // unsupported here; the palette still follows `mode`
  }
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<Mode>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((saved) => {
        const next: Mode = saved === 'light' || saved === 'dark' ? saved : 'system';
        applyToSystem(next);
        setModeState(next);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  const setMode = useCallback((next: Mode) => {
    applyToSystem(next);
    setModeState(next);
    AsyncStorage.setItem(KEY, next).catch(() => undefined);
  }, []);

  const scheme: Scheme = mode === 'system' ? (system === 'light' ? 'light' : 'dark') : mode;
  const value = useMemo<ThemeValue>(
    () => ({ mode, scheme, colors: scheme === 'light' ? light : dark, setMode }),
    [mode, scheme, setMode],
  );

  // Keeps the native root view (overscroll, keyboard-free gaps) the same colour as the page.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(value.colors.bg).catch(() => undefined);
  }, [value.colors.bg]);

  if (!ready) return null;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}

/** `make` must be a module-level function so the styles are only rebuilt when the palette changes. */
export function useStyles<T>(make: (colors: Palette) => T): T {
  const { colors } = useTheme();
  return useMemo(() => make(colors), [make, colors]);
}
