import type { ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '../lib/theme';

type Variant = 'primary' | 'secondary' | 'danger';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  style,
  small,
  icon,
}: {
  title: string;
  /** Optional picture before the label, tinted like the text. */
  icon?: ImageSourcePropType;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const bg = variant === 'primary' ? colors.accent : variant === 'danger' ? 'transparent' : colors.border;
  const fg = variant === 'primary' ? colors.accentText : variant === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        small && styles.small,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        variant === 'danger' && { borderWidth: 1, borderColor: colors.danger },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icon && <Image source={icon} style={{ width: small ? 18 : 22, height: small ? 18 : 22, tintColor: colors.accent }} resizeMode="contain" />}
          <Text style={[styles.buttonText, small && { fontSize: 14 }, { color: fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** A large square-ish button with an icon above its label. */
export function IconTile({
  icon,
  title,
  note,
  onPress,
  style,
}: {
  icon: ImageSourcePropType;
  title: string;
  note?: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.75 : 1 }, style]} accessibilityLabel={title}>
      <Image source={icon} style={{ width: 40, height: 40, tintColor: colors.accent }} resizeMode="contain" />
      <Text style={styles.tileText} numberOfLines={1}>
        {title}
      </Text>
      {!!note && (
        <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
          {note}
        </Text>
      )}
    </Pressable>
  );
}

/** A plain icon button for headers. */
export function IconButton({ icon, onPress, label, size = 28 }: { icon: ImageSourcePropType; onPress: () => void; label: string; size?: number }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })} accessibilityLabel={label}>
      <Image source={icon} style={{ width: size, height: size, tintColor: colors.text }} resizeMode="contain" />
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${Math.max(0, Math.min(1, value)) * 100}%` }]} />
    </View>
  );
}

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  h1: { color: colors.text, fontSize: 22, fontWeight: '700' },
  h2: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  text: { color: colors.text, fontSize: 15, lineHeight: 21 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 19 },
  input: {
    backgroundColor: colors.bg,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

const styles = StyleSheet.create({
  tile: {
    flexGrow: 1,
    flexBasis: '30%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    // Same height for every tile, with or without a note line.
    height: 124,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tileText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  button: { paddingVertical: 13, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  small: { paddingVertical: 8, paddingHorizontal: 12 },
  buttonText: { fontSize: 16, fontWeight: '700' },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent },
});
