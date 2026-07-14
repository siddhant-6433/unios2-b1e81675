import { Linking, StyleSheet, Text, View } from 'react-native';
import { Smartphone } from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { isStaffApp } from '../../lib/appVariant';
import { Button } from '../../components/ui/Button';

/** Shown when a family account signs into the staff app or vice versa. */
export default function WrongApp() {
  const { signOut } = useAuth();
  const { colors, spacing, type } = useTheme();

  const otherApp = isStaffApp ? 'NIMT Campus' : 'NIMT Staff';
  const message = isStaffApp
    ? 'This account is a student or parent account. Please use the NIMT Campus app.'
    : 'This account is a staff account. Please use the NIMT Staff app.';

  return (
    <View style={[styles.wrap, { backgroundColor: colors.canvas, padding: spacing.xl }]}>
      <View style={[styles.icon, { backgroundColor: colors.tint.orange.bg }]}>
        <Smartphone size={30} color={colors.tint.orange.fg} />
      </View>
      <Text style={[type.h2, { color: colors.ink, marginTop: spacing.md, textAlign: 'center' }]}>
        Wrong app for this account
      </Text>
      <Text style={[type.body, { color: colors.inkSecondary, marginTop: spacing.xs, textAlign: 'center' }]}>
        {message}
      </Text>
      <View style={{ marginTop: spacing.xl, gap: spacing.sm, alignSelf: 'stretch' }}>
        <Button label={`Get ${otherApp}`} onPress={() => Linking.openURL('https://uni.nimt.ac.in/app')} />
        <Button label="Sign out" variant="secondary" onPress={signOut} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
});
