import { type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import type { ChipTint } from '../../theme/tokens';
import { PressableScale } from './PressableScale';

type IconType = React.ComponentType<{ size?: number; color?: string }>;

interface StatTileProps {
  label: string;
  value: string;
  caption?: string;
  icon?: IconType;
  tint?: ChipTint;
  onPress?: () => void;
  /** children render below the value — e.g. a TickBar */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Bento stat tile with a big tabular numeral (portfolio-app / web pipeline reference). */
export function StatTile({ label, value, caption, icon: Icon, tint, onPress, children, style }: StatTileProps) {
  const { colors, radius, spacing, type } = useTheme();
  const iconPair = tint ? colors.tint[tint] : { bg: colors.cardSubtle, fg: colors.inkSecondary };

  const body = (
    <>
      <View style={styles.top}>
        <Text style={[type.captionMedium, { color: colors.inkSecondary }]} numberOfLines={1}>
          {label}
        </Text>
        {Icon && (
          <View style={[styles.icon, { backgroundColor: iconPair.bg }]}>
            <Icon size={16} color={iconPair.fg} />
          </View>
        )}
      </View>
      <Text style={[type.numeral, { color: colors.ink, marginTop: spacing.xxs }]} numberOfLines={1}>
        {value}
      </Text>
      {caption ? (
        <Text style={[type.caption, { color: colors.inkMuted, marginTop: 2 }]} numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
      {children ? <View style={{ marginTop: spacing.xs }}>{children}</View> : null}
    </>
  );

  const tileStyle: StyleProp<ViewStyle> = [
    styles.tile,
    { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md },
    style,
  ];

  if (onPress) {
    return (
      <PressableScale onPress={onPress} style={tileStyle} accessibilityLabel={`${label}: ${value}`}>
        {body}
      </PressableScale>
    );
  }
  return <View style={tileStyle}>{body}</View>;
}

const styles = StyleSheet.create({
  tile: { flex: 1, minHeight: 104, justifyContent: 'flex-start' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  icon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
