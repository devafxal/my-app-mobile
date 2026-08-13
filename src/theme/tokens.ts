import { Easing, TextStyle, ViewStyle } from 'react-native';

/**
 * ─── MONOCHROME DESIGN SYSTEM ──────────────────────────────────────────────
 *
 * One hue: none. Hierarchy comes from *lightness, weight and elevation*
 * instead of colour, in both light and dark mode.
 *
 * Everything that changes between modes lives in `Theme`. Everything that
 * doesn't — spacing, radii, type scale, motion — is a shared constant, so a
 * component can import those directly and only subscribe to the theme for
 * colour.
 */

/* ── Mode-independent scales ─────────────────────────────────────────────── */

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  huge: 44,
} as const;

export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  sheet: 28,
  pill: 999,
} as const;

/**
 * Type scale. Sizes run deliberately small and tight — the previous pass was
 * a couple of points too large everywhere, which read as clumsy rather than
 * dense. Refinement here comes from line-height and tracking, not size.
 */
export const type = {
  display: { fontSize: 30, fontWeight: '700', letterSpacing: -0.7, lineHeight: 36 },
  title: { fontSize: 21, fontWeight: '700', letterSpacing: -0.4, lineHeight: 26 },
  heading: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2, lineHeight: 21 },
  body: { fontSize: 14, fontWeight: '400', letterSpacing: -0.1, lineHeight: 19 },
  bodyStrong: { fontSize: 14, fontWeight: '600', letterSpacing: -0.1, lineHeight: 19 },
  callout: { fontSize: 13, fontWeight: '400', letterSpacing: -0.05, lineHeight: 18 },
  caption: { fontSize: 11, fontWeight: '500', letterSpacing: 0 },
  micro: { fontSize: 10, fontWeight: '500', letterSpacing: 0.1 },
  overline: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
} as const satisfies Record<string, TextStyle>;

/**
 * Chat chrome (timestamps, ticks, counters) is tiny by design. Let the OS
 * text-size setting enlarge it a little, but not so much that it wraps and
 * breaks bubble layout — message bodies scale freely.
 */
export const CHROME_FONT_CAP = 1.3;

export const motion = {
  duration: {
    instant: 120,
    fast: 200,
    normal: 320,
    slow: 480,
  },
  easing: {
    out: Easing.bezier(0.16, 1, 0.3, 1),
    in: Easing.bezier(0.5, 0, 0.75, 0),
    inOut: Easing.bezier(0.65, 0, 0.35, 1),
    overshoot: Easing.bezier(0.34, 1.56, 0.64, 1),
  },
  spring: {
    snappy: { friction: 9, tension: 180 },
    gentle: { friction: 10, tension: 90 },
    bouncy: { friction: 6, tension: 140 },
  },
  stagger: (index: number, step = 45, max = 8) => Math.min(index, max) * step,
} as const;

/* ── Theme shape ─────────────────────────────────────────────────────────── */

export interface Theme {
  mode: 'light' | 'dark';

  /** Raw anchors. `accent` is the high-contrast colour used for primary
   *  surfaces; `onAccent` is what sits on top of it. */
  palette: {
    accent: string;
    onAccent: string;
    white: string;
    black: string;
  };

  /** Foreground emphasis ladder, highest first. */
  ink: {
    max: string;
    high: string;
    mid: string;
    low: string;
    faint: string;
    ghost: string;
  };

  /** Foreground for content sitting on an accent-filled surface. */
  inkInverse: {
    max: string;
    high: string;
    mid: string;
    low: string;
  };

  surfaces: {
    canvas: string;
    card: string;
    raised: string;
    sunken: string;
    wash: string;
    washStrong: string;
    scrim: string;
    /** Translucent bar backgrounds (chat header / input bar) */
    bar: string;
  };

  borders: {
    subtle: string;
    default: string;
    strong: string;
    active: string;
  };

  /** Severity without hue — louder = more contrast against the canvas. */
  severity: {
    critical: string;
    high: string;
    normal: string;
    muted: string;
  };

  /** Chat-specific surfaces. Outgoing messages are always the high-contrast
   *  pair, incoming the quiet one, in both modes. */
  chat: {
    canvas: string;
    outBubble: string;
    outText: string;
    outMeta: string;
    outQuoteBg: string;
    outQuoteBar: string;
    inBubble: string;
    inText: string;
    inMeta: string;
    inQuoteBg: string;
    inQuoteBar: string;
    inBorder: string;
    /** Read receipt. WhatsApp turns these blue; here they go to full contrast
     *  against the bubble instead, so the system stays hueless. */
    tickRead: string;
  };

  elevation: {
    none: ViewStyle;
    sm: ViewStyle;
    md: ViewStyle;
    lg: ViewStyle;
    glow: ViewStyle;
  };
}

/* ── Dark ────────────────────────────────────────────────────────────────── */

export const darkTheme: Theme = {
  mode: 'dark',

  palette: {
    accent: '#FFFFFF',
    onAccent: '#0B0B0D',
    white: '#FFFFFF',
    black: '#000000',
  },

  ink: {
    max: '#FFFFFF',
    high: 'rgba(255,255,255,0.82)',
    mid: 'rgba(255,255,255,0.56)',
    low: 'rgba(255,255,255,0.38)',
    faint: 'rgba(255,255,255,0.22)',
    ghost: 'rgba(255,255,255,0.10)',
  },

  inkInverse: {
    max: '#0B0B0D',
    high: 'rgba(11,11,13,0.78)',
    mid: 'rgba(11,11,13,0.55)',
    low: 'rgba(11,11,13,0.38)',
  },

  surfaces: {
    canvas: '#0B0B0D',
    card: '#141417',
    raised: '#1A1A1E',
    sunken: 'rgba(0,0,0,0.35)',
    wash: 'rgba(255,255,255,0.04)',
    washStrong: 'rgba(255,255,255,0.08)',
    scrim: 'rgba(0,0,0,0.72)',
    bar: '#121215',
  },

  borders: {
    subtle: 'rgba(255,255,255,0.07)',
    default: 'rgba(255,255,255,0.12)',
    strong: 'rgba(255,255,255,0.22)',
    active: 'rgba(255,255,255,0.85)',
  },

  severity: {
    critical: '#FFFFFF',
    high: 'rgba(255,255,255,0.68)',
    normal: 'rgba(255,255,255,0.38)',
    muted: 'rgba(255,255,255,0.18)',
  },

  chat: {
    canvas: '#0B0B0D',
    outBubble: '#EDEDED',
    outText: '#0B0B0D',
    outMeta: 'rgba(11,11,13,0.45)',
    outQuoteBg: 'rgba(11,11,13,0.07)',
    outQuoteBar: 'rgba(11,11,13,0.45)',
    inBubble: '#1C1C20',
    inText: 'rgba(255,255,255,0.92)',
    inMeta: 'rgba(255,255,255,0.40)',
    inQuoteBg: 'rgba(255,255,255,0.06)',
    inQuoteBar: 'rgba(255,255,255,0.45)',
    inBorder: 'rgba(255,255,255,0.06)',
    tickRead: '#0B0B0D',
  },

  elevation: {
    none: {},
    sm: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.35,
      shadowRadius: 6,
      elevation: 2,
    },
    md: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.45,
      shadowRadius: 14,
      elevation: 6,
    },
    lg: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 14 },
      shadowOpacity: 0.55,
      shadowRadius: 28,
      elevation: 14,
    },
    glow: {
      shadowColor: '#FFFFFF',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.22,
      shadowRadius: 16,
      elevation: 8,
    },
  },
};

/* ── Light ───────────────────────────────────────────────────────────────── */

export const lightTheme: Theme = {
  mode: 'light',

  palette: {
    accent: '#0B0B0D',
    onAccent: '#FFFFFF',
    white: '#FFFFFF',
    black: '#000000',
  },

  ink: {
    max: '#0B0B0D',
    high: 'rgba(11,11,13,0.80)',
    mid: 'rgba(11,11,13,0.56)',
    low: 'rgba(11,11,13,0.40)',
    faint: 'rgba(11,11,13,0.26)',
    ghost: 'rgba(11,11,13,0.10)',
  },

  inkInverse: {
    max: '#FFFFFF',
    high: 'rgba(255,255,255,0.82)',
    mid: 'rgba(255,255,255,0.60)',
    low: 'rgba(255,255,255,0.42)',
  },

  surfaces: {
    // Slightly off-white so white cards still read as raised against it
    canvas: '#F4F4F5',
    card: '#FFFFFF',
    raised: '#FFFFFF',
    sunken: 'rgba(11,11,13,0.045)',
    wash: 'rgba(11,11,13,0.04)',
    washStrong: 'rgba(11,11,13,0.08)',
    scrim: 'rgba(0,0,0,0.42)',
    bar: '#FFFFFF',
  },

  borders: {
    subtle: 'rgba(11,11,13,0.08)',
    default: 'rgba(11,11,13,0.14)',
    strong: 'rgba(11,11,13,0.26)',
    active: 'rgba(11,11,13,0.85)',
  },

  severity: {
    critical: '#0B0B0D',
    high: 'rgba(11,11,13,0.62)',
    normal: 'rgba(11,11,13,0.36)',
    muted: 'rgba(11,11,13,0.18)',
  },

  chat: {
    canvas: '#EFEFF0',
    outBubble: '#1F1F23',
    outText: '#FFFFFF',
    outMeta: 'rgba(255,255,255,0.55)',
    outQuoteBg: 'rgba(255,255,255,0.12)',
    outQuoteBar: 'rgba(255,255,255,0.60)',
    inBubble: '#FFFFFF',
    inText: '#0B0B0D',
    inMeta: 'rgba(11,11,13,0.42)',
    inQuoteBg: 'rgba(11,11,13,0.05)',
    inQuoteBar: 'rgba(11,11,13,0.40)',
    inBorder: 'rgba(11,11,13,0.06)',
    tickRead: '#FFFFFF',
  },

  elevation: {
    none: {},
    sm: {
      shadowColor: '#0B0B0D',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 3,
      elevation: 1,
    },
    md: {
      shadowColor: '#0B0B0D',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.10,
      shadowRadius: 12,
      elevation: 4,
    },
    lg: {
      shadowColor: '#0B0B0D',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.16,
      shadowRadius: 24,
      elevation: 12,
    },
    glow: {
      shadowColor: '#0B0B0D',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.22,
      shadowRadius: 12,
      elevation: 6,
    },
  },
};

export const themes = { light: lightTheme, dark: darkTheme } as const;
