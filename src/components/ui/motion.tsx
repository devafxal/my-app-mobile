import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { motion, radius as radii, useTheme } from '../../theme';

/**
 * Shared motion primitives. Screens compose these rather than hand-rolling
 * Animated.Value plumbing, which keeps timing and easing identical everywhere
 * — the thing that actually makes an interface feel "smooth" is consistency,
 * not any single animation.
 */

/* ── PressableScale ───────────────────────────────────────────────────────
   Every tappable surface dips slightly under the finger and springs back. */

/**
 * The pressable and the animated node have to be the *same* element.
 *
 * Wrapping an Animated.View inside a plain Pressable puts the caller's layout
 * style (flex, width, padding) on the inner node while the Pressable — the
 * actual flex child of the parent row — is left unstyled, so it collapses to
 * its content width and `flex: 1` silently does nothing. Animating the
 * Pressable itself keeps layout and hit area on one node.
 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PressableScaleProps extends PressableProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** How far to dip. 1 = no movement. */
  activeScale?: number;
  /** Dim as well as shrink — good for large surfaces like cards */
  dimOnPress?: boolean;
  haptic?: () => void;
}

export function PressableScale({
  children,
  style,
  activeScale = 0.96,
  dimOnPress = false,
  haptic,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const animateTo = (toScale: number, toOpacity: number) => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: toScale,
        ...motion.spring.snappy,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: toOpacity,
        duration: motion.duration.instant,
        useNativeDriver: true,
      }),
    ]).start();
  };

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      style={[style, { transform: [{ scale }], opacity }]}
      onPressIn={(e) => {
        if (!disabled) {
          animateTo(activeScale, dimOnPress ? 0.75 : 1);
          haptic?.();
        }
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        animateTo(1, 1);
        onPressOut?.(e);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}

/* ── FadeSlideIn ──────────────────────────────────────────────────────────
   Content arrives by rising a few pixels while fading in. Pass an index to
   stagger a group so a list assembles itself instead of snapping in flat. */

interface FadeSlideInProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Position in a staggered group */
  index?: number;
  /** Explicit delay in ms — overrides `index` */
  delay?: number;
  /** Travel distance. Negative slides down from above. */
  offsetY?: number;
  offsetX?: number;
  duration?: number;
  /** Also scale up from slightly small */
  scaleFrom?: number;
}

export function FadeSlideIn({
  children,
  style,
  index = 0,
  delay,
  offsetY = 16,
  offsetX = 0,
  duration = motion.duration.normal,
  scaleFrom,
}: FadeSlideInProps) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const wait = delay ?? motion.stagger(index);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay: wait,
      easing: motion.easing.out,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, delay, index, duration]);

  const transform: any[] = [];
  if (offsetY) {
    transform.push({
      translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [offsetY, 0] }),
    });
  }
  if (offsetX) {
    transform.push({
      translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [offsetX, 0] }),
    });
  }
  if (scaleFrom !== undefined) {
    transform.push({
      scale: progress.interpolate({ inputRange: [0, 1], outputRange: [scaleFrom, 1] }),
    });
  }

  return (
    <Animated.View style={[style, { opacity: progress, transform }]}>
      {children}
    </Animated.View>
  );
}

/* ── Shimmer ──────────────────────────────────────────────────────────────
   Loading placeholder. A monochrome UI can't tint a spinner, so an
   indeterminate sweep across a neutral block carries the waiting state. */

export function Shimmer({
  width,
  height,
  style,
  radius: r = radii.sm,
}: {
  width: number | `${number}%`;
  height: number;
  style?: StyleProp<ViewStyle>;
  radius?: number;
}) {
  const theme = useTheme();
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  return (
    <View
      style={[
        {
          width,
          height,
          borderRadius: r,
          backgroundColor: theme.surfaces.wash,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: theme.surfaces.washStrong,
            opacity: sweep.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [0.25, 1, 0.25],
            }),
            transform: [
              {
                translateX: sweep.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-160, 160],
                }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}

/* ── Pulse ────────────────────────────────────────────────────────────────
   A slow breathing ring. Used for "live" indicators where colour would
   normally do the signalling. */

export function Pulse({
  size,
  style,
  active = true,
  color,
}: {
  size: number;
  style?: StyleProp<ViewStyle>;
  active?: boolean;
  color?: string;
}) {
  const theme = useTheme();
  const beat = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      beat.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(beat, {
          toValue: 1,
          duration: 1600,
          easing: motion.easing.out,
          useNativeDriver: true,
        }),
        Animated.timing(beat, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [beat, active]);

  if (!active) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1,
          borderColor: color ?? theme.borders.strong,
          opacity: beat.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
          transform: [
            { scale: beat.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) },
          ],
        },
        style,
      ]}
    />
  );
}

/* ── AnimatedSwap ─────────────────────────────────────────────────────────
   Cross-fades content when a value changes, so counters tick rather than
   pop. Wraps whatever node you hand it. */

export function AnimatedSwap({
  swapKey,
  children,
  style,
}: {
  /** Change this to trigger the cross-fade */
  swapKey: string | number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const fade = useRef(new Animated.Value(1)).current;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    Animated.sequence([
      Animated.timing(fade, {
        toValue: 0,
        duration: motion.duration.instant,
        easing: motion.easing.in,
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: 1,
        duration: motion.duration.fast,
        easing: motion.easing.out,
        useNativeDriver: true,
      }),
    ]).start();
  }, [swapKey, fade]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: fade,
          transform: [
            { translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
