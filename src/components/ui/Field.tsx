import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleProp, StyleSheet, Text, TextInput, TextStyle, View, ViewStyle } from 'react-native';
import { motion, radius, space, Theme, type, useTheme, useThemedStyles } from '../../theme';

interface FieldProps extends React.ComponentProps<typeof TextInput> {
  /** Uppercase eyebrow above the input. Omit for a bare input. */
  label?: string;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

/**
 * Text input with an animated focus ring. Without colour to signal focus, the
 * ring darkening/brightening to near-full contrast is what tells you where
 * the caret is.
 */
export default function Field({ label, containerStyle, inputStyle, ...inputProps }: FieldProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const [focused, setFocused] = useState(false);
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(ring, {
      toValue: focused ? 1 : 0,
      duration: motion.duration.fast,
      easing: motion.easing.out,
      useNativeDriver: true,
    }).start();
  }, [focused, ring]);

  return (
    <View style={containerStyle}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View>
        <Animated.View pointerEvents="none" style={[styles.focusRing, { opacity: ring }]} />
        <TextInput
          placeholderTextColor={theme.ink.faint}
          {...inputProps}
          style={[styles.input, inputStyle]}
          onFocus={(e) => {
            setFocused(true);
            inputProps.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            inputProps.onBlur?.(e);
          }}
        />
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    label: {
      ...type.overline,
      color: t.ink.low,
      marginBottom: space.sm,
    },
    focusRing: {
      ...(StyleSheet.absoluteFill as object),
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.borders.active,
    },
    input: {
      backgroundColor: t.surfaces.sunken,
      borderWidth: 1,
      borderColor: t.borders.subtle,
      borderRadius: radius.md,
      color: t.ink.max,
      paddingHorizontal: space.base,
      paddingVertical: 13,
      fontSize: 14,
    },
  });
