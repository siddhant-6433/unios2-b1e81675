import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import type { ChipTint } from '../../theme/tokens';

interface TickBarProps {
  /** 0..1 completion ratio */
  progress: number;
  tint?: ChipTint;
  segments?: number;
  height?: number;
}

/** Segmented tick-bar progress (Aster/upload reference) — replaces plain progress bars. */
export function TickBar({ progress, tint = 'green', segments = 32, height = 18 }: TickBarProps) {
  const { colors, mode } = useTheme();
  const filled = Math.round(Math.min(Math.max(progress, 0), 1) * segments);
  const activeColor = colors.tint[tint].fg;
  const idleColor = mode === 'dark' ? colors.line : colors.tint.neutral.bg;

  return (
    <View style={[styles.row, { height }]} accessibilityRole="progressbar">
      {Array.from({ length: segments }, (_, i) => (
        <View
          key={i}
          style={[
            styles.tick,
            { backgroundColor: i < filled ? activeColor : idleColor, height },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 3, flex: 1 },
  tick: { flex: 1, borderRadius: 2, minWidth: 2 },
});
