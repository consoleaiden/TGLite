import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { avatarColorFor, colors, initialsOf } from '../theme';

interface AvatarProps {
  title: string;
  seed: string;
  size?: number;
  unread?: number;
}

export default function Avatar({ title, seed, size = 52, unread = 0 }: AvatarProps) {
  const badgeSize = Math.max(18, Math.round(size * 0.38));

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.circle,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: avatarColorFor(seed) },
        ]}
      >
        <Text style={[styles.initials, { fontSize: Math.round(size * 0.38) }]} numberOfLines={1}>
          {initialsOf(title)}
        </Text>
      </View>

      {unread > 0 ? (
        <View
          style={[
            styles.badge,
            {
              minWidth: badgeSize,
              height: badgeSize,
              borderRadius: badgeSize / 2,
              paddingHorizontal: unread > 9 ? 4 : 0,
            },
          ]}
        >
          <Text style={[styles.badgeText, { fontSize: Math.round(badgeSize * 0.62) }]}>
            {unread > 99 ? '99+' : unread}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: '#FFFFFF',
    fontWeight: '600',
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    backgroundColor: colors.badge,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  badgeText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
