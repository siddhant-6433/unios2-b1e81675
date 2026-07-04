import { type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { PressableScale } from './PressableScale';

interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  subtle?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Card({ children, onPress, subtle, padded = true, style }: CardProps) {
  const { colors, radius, spacing } = useTheme();
  const cardStyle: StyleProp<ViewStyle> = [
    {
      backgroundColor: subtle ? colors.cardSubtle : colors.card,
      borderRadius: radius.lg,
      padding: padded ? spacing.md : 0,
      overflow: 'hidden',
    },
    style,
  ];

  if (onPress) {
    return (
      <PressableScale onPress={onPress} style={cardStyle}>
        {children}
      </PressableScale>
    );
  }
  return <View style={cardStyle}>{children}</View>;
}
