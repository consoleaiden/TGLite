import React from 'react';
import { StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { colors, radius, spacing } from '../theme';

interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  hint?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
  maxLength?: number;
  disabled?: boolean;
}

export default function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  secureTextEntry = false,
  keyboardType,
  autoCapitalize = 'none',
  autoCorrect = false,
  multiline = false,
  numberOfLines,
  maxLength,
  disabled = false,
}: TextFieldProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline ? styles.inputMultiline : null, disabled ? styles.disabled : null]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        multiline={multiline}
        numberOfLines={numberOfLines}
        maxLength={maxLength}
        editable={!disabled}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.bgAlt,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.text,
  },
  inputMultiline: {
    minHeight: 104,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  disabled: {
    opacity: 0.55,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textFaint,
  },
});
