import { StyleSheet, Text, View, Pressable } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

interface SegmentedControlProps<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}

/** Pill segmented control — active segment is an ink pill with inverse text (Aster reference). */
export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  const { colors, radius } = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: colors.cardSubtle, borderRadius: radius.full }]}>
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            style={[
              styles.segment,
              { borderRadius: radius.full },
              isActive && { backgroundColor: colors.pillBg },
            ]}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: isActive ? colors.pillFg : colors.inkSecondary,
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', padding: 4, gap: 4 },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 34 },
});
