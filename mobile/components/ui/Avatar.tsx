import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../../theme/ThemeContext';
import type { ChipTint } from '../../theme/tokens';

interface AvatarProps {
  name: string;
  uri?: string | null;
  size?: number;
  tint?: ChipTint;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export function Avatar({ name, uri, size = 40, tint = 'blue' }: AvatarProps) {
  const { colors } = useTheme();
  const pair = colors.tint[tint];

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
        transition={150}
        accessibilityLabel={name}
      />
    );
  }
  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: pair.bg },
      ]}
      accessibilityLabel={name}
    >
      <Text style={{ color: pair.fg, fontSize: size * 0.38, fontWeight: '700' }}>{initialsOf(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
