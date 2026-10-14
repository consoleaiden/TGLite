import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors } from '../theme';

interface SwitchProps {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

/** 自绘开关：RN 的 Switch 在各平台观感差异大，这里统一成一套 */
export default function Switch({ value, onChange, disabled = false }: SwitchProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={[styles.track, value ? styles.trackOn : styles.trackOff, disabled ? styles.disabled : null]}
    >
      <View style={[styles.thumb, value ? styles.thumbOn : styles.thumbOff]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 50,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  trackOn: {
    backgroundColor: colors.primary,
  },
  trackOff: {
    backgroundColor: '#D0D5DD',
  },
  disabled: {
    opacity: 0.5,
  },
  thumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  thumbOn: {
    alignSelf: 'flex-end',
  },
  thumbOff: {
    alignSelf: 'flex-start',
  },
});
