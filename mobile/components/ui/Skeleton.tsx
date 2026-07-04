import { useEffect } from 'react';
import { type DimensionValue } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: object;
}

/** Pulsing skeleton block — loading states use these, never full-screen spinners. */
export function Skeleton({ width = '100%', height = 16, borderRadius, style }: SkeletonProps) {
  const { colors, radius, mode } = useTheme();
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(withTiming(1, { duration: 650 }), withTiming(0.5, { duration: 650 })),
      -1,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: borderRadius ?? radius.sm,
          backgroundColor: mode === 'dark' ? colors.line : colors.tint.neutral.bg,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** Standard card-shaped loading block row. */
export function SkeletonCard({ height = 104 }: { height?: number }) {
  const { radius } = useTheme();
  return <Skeleton height={height} borderRadius={radius.lg} />;
}
