import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

export interface GreetingSegment {
  text: string;
  emphasis?: boolean;
  accent?: boolean;
}

interface GreetingHeroProps {
  /** e.g. "Good morning," */
  eyebrow?: string;
  /** the serif-italic display name (Voiceon reference) */
  name?: string;
  /** inline-emphasis sentence: muted base with highlighted key segments */
  segments: GreetingSegment[];
  /** staff Me tab renders on the dark inverse panel */
  onInverse?: boolean;
  children?: ReactNode;
}

/**
 * Editorial greeting headline with inline emphasis (Figura/Lukas references):
 * muted base text, key numbers/words highlighted in ink or accent.
 */
export function GreetingHero({ eyebrow, name, segments, onInverse, children }: GreetingHeroProps) {
  const { colors, spacing, type } = useTheme();

  const base = onInverse ? 'rgba(244, 243, 241, 0.55)' : colors.inkMuted;
  const strong = onInverse ? colors.inverseInk : colors.ink;
  const accent = onInverse ? '#9DB2FF' : colors.accent;

  return (
    <View style={{ gap: spacing.xs }}>
      {(eyebrow || name) && (
        <View style={styles.nameRow}>
          {eyebrow ? <Text style={[type.h2, { color: base }]}>{eyebrow} </Text> : null}
          {name ? <Text style={[type.displaySerif, { fontSize: 22, lineHeight: 28, color: strong }]}>{name}</Text> : null}
        </View>
      )}
      <Text style={[type.display, { color: base }]}>
        {segments.map((segment, i) => (
          <Text
            key={i}
            style={segment.emphasis ? { color: segment.accent ? accent : strong } : undefined}
          >
            {segment.text}
          </Text>
        ))}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  nameRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
});
