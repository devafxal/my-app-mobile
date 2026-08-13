import React from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * Icons drawn from plain Views rather than a vector library.
 *
 * `react-native-svg` would give cleaner geometry, but it's a native module —
 * adding it means every install needs a fresh gradle/pod build before the app
 * will even launch. These shapes keep the whole UI reloadable over Metro.
 *
 * The paper plane is built the way the shape actually reads: a solid
 * right-pointing triangle with a wedge of the *button's own colour* punched
 * into its left edge. That notch is what separates a send glyph from a plain
 * play triangle, and it's why these take a `color` (the mark) plus a
 * `notchColor` (whatever sits behind it).
 */

interface SendIconProps {
  size?: number;
  /** Colour of the plane itself */
  color: string;
  /** The surface behind it — used to carve the tail notch */
  notchColor: string;
}

export function SendIcon({ size = 20, color, notchColor }: SendIconProps) {
  // Proportions tuned against WhatsApp's glyph: a wide, shallow dart
  const h = size;
  const w = size * 1.05;

  return (
    <View style={{ width: w, height: h, justifyContent: 'center' }}>
      {/* Body: right-pointing triangle */}
      <View
        style={{
          width: 0,
          height: 0,
          borderTopWidth: h / 2,
          borderBottomWidth: h / 2,
          borderLeftWidth: w,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: color,
        }}
      />
      {/* Tail notch: a wedge of the background carved out of the left edge */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: h / 2 - h * 0.22,
          width: 0,
          height: 0,
          borderTopWidth: h * 0.22,
          borderBottomWidth: h * 0.22,
          borderLeftWidth: w * 0.42,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: notchColor,
        }}
      />
    </View>
  );
}

/**
 * Delivery ticks. One check for sent, two overlapping for delivered/read —
 * drawn as two rotated strokes so they stay crisp and can overlap the way
 * WhatsApp's do, which a "✓✓" text glyph can't.
 */
export function CheckTicks({
  double = false,
  color,
  size = 13,
}: {
  double?: boolean;
  color: string;
  size?: number;
}) {
  const stroke = Math.max(1.2, size * 0.11);

  const Check = ({ offset }: { offset: number }) => (
    <View style={{ position: 'absolute', left: offset, top: 0, width: size, height: size }}>
      {/* Short arm */}
      <View
        style={{
          position: 'absolute',
          left: size * 0.06,
          top: size * 0.52,
          width: size * 0.3,
          height: stroke,
          backgroundColor: color,
          borderRadius: stroke,
          transform: [{ rotate: '45deg' }],
        }}
      />
      {/* Long arm */}
      <View
        style={{
          position: 'absolute',
          left: size * 0.22,
          top: size * 0.44,
          width: size * 0.62,
          height: stroke,
          backgroundColor: color,
          borderRadius: stroke,
          transform: [{ rotate: '-45deg' }],
        }}
      />
    </View>
  );

  const width = double ? size * 1.35 : size;

  return (
    <View style={{ width, height: size }}>
      <Check offset={0} />
      {double && <Check offset={size * 0.35} />}
    </View>
  );
}

/** Small clock outline — a message still waiting to leave the device. */
export function PendingIcon({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.2,
        borderColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Hands */}
      <View
        style={{
          position: 'absolute',
          width: 1.2,
          height: size * 0.28,
          backgroundColor: color,
          top: size * 0.2,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: size * 0.22,
          height: 1.2,
          backgroundColor: color,
          left: size * 0.46,
          top: size * 0.46,
        }}
      />
    </View>
  );
}

/** Chevron used for back navigation. */
export function ChevronLeft({ color, size = 18 }: { color: string; size?: number }) {
  const stroke = Math.max(1.5, size * 0.1);
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: stroke,
          height: size * 0.46,
          backgroundColor: color,
          borderRadius: stroke,
          transform: [{ rotate: '45deg' }, { translateY: -size * 0.16 }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: stroke,
          height: size * 0.46,
          backgroundColor: color,
          borderRadius: stroke,
          transform: [{ rotate: '-45deg' }, { translateY: size * 0.16 }],
        }}
      />
    </View>
  );
}

/** Downward chevron for the scroll-to-latest button. */
export function ChevronDown({ color, size = 16 }: { color: string; size?: number }) {
  const stroke = Math.max(1.5, size * 0.11);
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: stroke,
          height: size * 0.5,
          backgroundColor: color,
          borderRadius: stroke,
          transform: [{ rotate: '45deg' }, { translateX: -size * 0.17 }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: stroke,
          height: size * 0.5,
          backgroundColor: color,
          borderRadius: stroke,
          transform: [{ rotate: '-45deg' }, { translateX: size * 0.17 }],
        }}
      />
    </View>
  );
}

/** Reply arrow for the swipe affordance. */
export function ReplyIcon({ color, size = 16 }: { color: string; size?: number }) {
  const stroke = Math.max(1.4, size * 0.1);
  return (
    <View style={{ width: size, height: size, justifyContent: 'center' }}>
      {/* Shaft */}
      <View
        style={{
          position: 'absolute',
          left: size * 0.18,
          top: size * 0.46,
          width: size * 0.64,
          height: stroke,
          backgroundColor: color,
          borderRadius: stroke,
        }}
      />
      {/* Curve down */}
      <View
        style={{
          position: 'absolute',
          right: size * 0.18,
          top: size * 0.46,
          width: stroke,
          height: size * 0.28,
          backgroundColor: color,
          borderRadius: stroke,
        }}
      />
      {/* Arrow head */}
      <View
        style={{
          position: 'absolute',
          left: size * 0.14,
          top: size * 0.28,
          width: 0,
          height: 0,
          borderTopWidth: size * 0.2,
          borderBottomWidth: size * 0.2,
          borderRightWidth: size * 0.26,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderRightColor: color,
        }}
      />
    </View>
  );
}

/** Close / dismiss cross. */
export function CloseIcon({ color, size = 12 }: { color: string; size?: number }) {
  const stroke = Math.max(1.3, size * 0.12);
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <View
        style={[
          StyleSheet.absoluteFill as any,
          {
            top: size / 2 - stroke / 2,
            height: stroke,
            backgroundColor: color,
            borderRadius: stroke,
            transform: [{ rotate: '45deg' }],
          },
        ]}
      />
      <View
        style={[
          StyleSheet.absoluteFill as any,
          {
            top: size / 2 - stroke / 2,
            height: stroke,
            backgroundColor: color,
            borderRadius: stroke,
            transform: [{ rotate: '-45deg' }],
          },
        ]}
      />
    </View>
  );
}

/** Attach-a-photo affordance in the composer: camera body, bump, and lens. */
export function CameraIcon({ color, size = 20 }: { color: string; size?: number }) {
  const stroke = Math.max(1.3, size * 0.08);
  const bodyTop = size * 0.26;
  const bodyHeight = size * 0.5;
  const lens = size * 0.26;

  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      {/* Viewfinder bump */}
      <View
        style={{
          position: 'absolute',
          top: bodyTop - size * 0.1,
          left: size * 0.3,
          width: size * 0.22,
          height: size * 0.12,
          borderTopLeftRadius: stroke * 2,
          borderTopRightRadius: stroke * 2,
          borderColor: color,
          borderWidth: stroke,
          borderBottomWidth: 0,
        }}
      />
      {/* Body */}
      <View
        style={{
          position: 'absolute',
          top: bodyTop,
          left: size * 0.08,
          width: size * 0.84,
          height: bodyHeight,
          borderRadius: size * 0.14,
          borderColor: color,
          borderWidth: stroke,
        }}
      />
      {/* Lens */}
      <View
        style={{
          position: 'absolute',
          top: bodyTop + bodyHeight / 2 - lens / 2,
          left: size / 2 - lens / 2,
          width: lens,
          height: lens,
          borderRadius: lens / 2,
          borderColor: color,
          borderWidth: stroke,
        }}
      />
    </View>
  );
}
