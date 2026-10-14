import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { bootstrapApp } from './boot';
import type { RootStackParamList } from './navigation';
import ApiCredentialsScreen from './screens/ApiCredentialsScreen';
import ChatInfoScreen from './screens/ChatInfoScreen';
import ChatListScreen from './screens/ChatListScreen';
import ChatScreen from './screens/ChatScreen';
import CodeScreen from './screens/CodeScreen';
import CommentsScreen from './screens/CommentsScreen';
import FiltersScreen from './screens/FiltersScreen';
import ForwardScreen from './screens/ForwardScreen';
import JoinScreen from './screens/JoinScreen';
import LoginScreen from './screens/LoginScreen';
import NetworkScreen from './screens/NetworkScreen';
import PasswordScreen from './screens/PasswordScreen';
import SettingsScreen from './screens/SettingsScreen';
import { useAppStore } from './store';
import { colors } from './theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.border,
  },
};

export default function RootNavigator() {
  const stage = useAppStore((state) => state.stage);

  useEffect(() => {
    bootstrapApp();
  }, []);

  if (stage === 'booting') {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.bootText}>正在恢复会话…</Text>
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        {stage === 'ready' ? (
          <>
            <Stack.Screen name="Chats" component={ChatListScreen} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="ChatInfo" component={ChatInfoScreen} />
            <Stack.Screen name="Join" component={JoinScreen} />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ animation: 'slide_from_bottom' }}
            />
            <Stack.Screen name="Filters" component={FiltersScreen} />
            <Stack.Screen name="Network" component={NetworkScreen} />
            <Stack.Screen name="Forward" component={ForwardScreen} />
            <Stack.Screen name="Comments" component={CommentsScreen} />
            <Stack.Screen name="ApiCredentials" component={ApiCredentialsScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Code" component={CodeScreen} />
            <Stack.Screen name="Password" component={PasswordScreen} />
            {/*
              登录前也要能配代理：在没有代理就打不开 Telegram 的网络里，
              用户连登录页都过不去。preLogin 参数让这个页面知道
              当前没有客户端、保存时只落盘不重连。
            */}
            <Stack.Screen name="Network" component={NetworkScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: colors.bg,
  },
  bootText: {
    fontSize: 14,
    color: colors.textMuted,
  },
});
