import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Avatar from '../components/Avatar';
import Button from '../components/Button';
import TextField from '../components/TextField';
import type { RootStackParamList } from '../navigation';
import { useAppStore } from '../store';
import type { ChatInfo, ParticipantItem } from '../tg/groups';
import {
  deleteChat,
  editChatAbout,
  editChatTitle,
  leaveChat,
  loadChatInfo,
  loadParticipants,
} from '../tg/groups';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatInfo'>;

export default function ChatInfoScreen({ navigation, route }: Props) {
  const { peerKey } = route.params;
  const insets = useSafeAreaInsets();
  const removeDialog = useAppStore((state) => state.removeDialog);
  const requestDialogsRefresh = useAppStore((state) => state.requestDialogsRefresh);

  const [info, setInfo] = useState<ChatInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [members, setMembers] = useState<ParticipantItem[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');

  const [editing, setEditing] = useState<'none' | 'title' | 'about'>('none');
  const [draft, setDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await loadChatInfo(peerKey);
      setInfo(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [peerKey]);

  const loadMembers = useCallback(
    async (query: string) => {
      setMembersLoading(true);
      try {
        const list = await loadParticipants(peerKey, 50, query);
        setMembers(list);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setMembersLoading(false);
      }
    },
    [peerKey],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!info) return;
    if (info.kind === 'user') return;
    const timer = setTimeout(() => loadMembers(memberQuery), memberQuery ? 400 : 0);
    return () => clearTimeout(timer);
  }, [info, memberQuery, loadMembers]);

  async function handleSaveEdit() {
    if (!info) return;
    setBusy(true);
    try {
      if (editing === 'title') {
        await editChatTitle(peerKey, draft);
        setInfo({ ...info, title: draft.trim() });
      } else {
        await editChatAbout(peerKey, draft);
        setInfo({ ...info, about: draft.trim() });
      }
      setEditing('none');
      requestDialogsRefresh();
    } catch (err) {
      Alert.alert('保存失败', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleLeave() {
    setBusy(true);
    try {
      await leaveChat(peerKey);
      removeDialog(peerKey);
      requestDialogsRefresh();
      Alert.alert('已退出', '你已离开该会话。', [{ text: '好', onPress: () => navigation.goBack() }]);
    } catch (err) {
      Alert.alert('退出失败', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteChat(peerKey);
      removeDialog(peerKey);
      requestDialogsRefresh();
      Alert.alert('已解散', '该频道已被删除。', [{ text: '好', onPress: () => navigation.goBack() }]);
    } catch (err) {
      Alert.alert('解散失败', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function confirmLeave() {
    Alert.alert('退出会话', `确定退出「${info?.title || '该会话'}」？退出后需要重新加入才能看到消息。`, [
      { text: '取消', style: 'cancel' },
      { text: '退出', style: 'destructive', onPress: handleLeave },
    ]);
  }

  function confirmDelete() {
    Alert.alert(
      '解散并删除',
      `这会为所有成员删除「${info?.title || '该频道'}」，且不可恢复。确定继续？`,
      [
        { text: '取消', style: 'cancel' },
        { text: '解散', style: 'destructive', onPress: handleDelete },
      ],
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerRow}>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          群组与频道管理
        </Text>
        <View style={styles.backSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.centerText}>正在读取会话信息…</Text>
        </View>
      ) : (
        <>
          <View style={styles.hero}>
            <Avatar title={info?.title || '会话'} seed={peerKey} />
            <Text style={styles.heroTitle}>{info?.title || '未知会话'}</Text>
            <Text style={styles.heroSub}>
              {kindLabel(info)}
              {info?.username ? ` · ${info.username}` : ''}
            </Text>
            {info && info.kind !== 'user' ? (
              <Text style={styles.heroMeta}>
                {info.membersCount > 0 ? `${info.membersCount} 位成员` : '成员数未知'}
                {info.creator ? ' · 我是创建者' : info.admin ? ' · 我是管理员' : ''}
              </Text>
            ) : null}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {info && info.kind !== 'user' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>基本信息</Text>

              {editing === 'title' ? (
                <>
                  <TextField label="新标题" value={draft} onChangeText={setDraft} placeholder="输入新的群组/频道名称" />
                  <View style={styles.editActions}>
                    <Button label="保存" onPress={handleSaveEdit} loading={busy} style={styles.flex} />
                    <Button label="取消" variant="ghost" onPress={() => setEditing('none')} style={styles.flex} />
                  </View>
                </>
              ) : (
                <InfoRow
                  label="标题"
                  value={info.title}
                  editable={info.canEditTitle}
                  onEdit={() => {
                    setDraft(info.title);
                    setEditing('title');
                  }}
                />
              )}

              {editing === 'about' ? (
                <>
                  <TextField
                    label="新简介"
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="介绍一下这个群组/频道"
                    multiline
                    numberOfLines={4}
                    maxLength={255}
                  />
                  <View style={styles.editActions}>
                    <Button label="保存" onPress={handleSaveEdit} loading={busy} style={styles.flex} />
                    <Button label="取消" variant="ghost" onPress={() => setEditing('none')} style={styles.flex} />
                  </View>
                </>
              ) : (
                <InfoRow
                  label="简介"
                  value={info.about || '（未设置）'}
                  editable={info.canEditAbout}
                  onEdit={() => {
                    setDraft(info.about);
                    setEditing('about');
                  }}
                />
              )}

              <InfoRow label="类型" value={kindLabel(info)} />
              <InfoRow label="成员数" value={info.membersCount > 0 ? String(info.membersCount) : '未知'} />
              {info.slowmodeSeconds > 0 ? (
                <InfoRow label="慢速模式" value={`${info.slowmodeSeconds} 秒`} />
              ) : null}
              <InfoRow label="用户名" value={info.username || '私有（无公开用户名）'} />
            </View>
          ) : null}

          {info && info.kind !== 'user' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>成员</Text>
              <TextField
                label="搜索成员"
                value={memberQuery}
                onChangeText={setMemberQuery}
                placeholder="按昵称或用户名搜索"
              />
              {membersLoading ? (
                <ActivityIndicator color={colors.primary} style={styles.membersLoading} />
              ) : null}
              {members.length ? (
                members.map((member) => (
                  <View key={member.key} style={styles.memberRow}>
                    <Avatar title={member.name} seed={member.key} size={34} />
                    <View style={styles.memberBody}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {member.name}
                      </Text>
                      {member.username ? (
                        <Text style={styles.memberUsername} numberOfLines={1}>
                          {member.username}
                        </Text>
                      ) : null}
                    </View>
                    {member.role !== 'member' ? (
                      <Text style={styles.memberRole}>{member.role === 'creator' ? '创建者' : '管理员'}</Text>
                    ) : null}
                  </View>
                ))
              ) : (
                <Text style={styles.centerText}>
                  {membersLoading ? '正在加载成员…' : memberQuery ? '没有匹配的成员' : '没有可见的成员'}
                </Text>
              )}
              <Text style={styles.hint}>最多展示前 50 位；Telegram 默认隐藏部分成员，属于服务端行为。</Text>
            </View>
          ) : null}

          {info && info.kind !== 'user' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>危险操作</Text>
              {info.canLeave ? (
                <Button label="退出群组 / 频道" variant="danger" onPress={confirmLeave} disabled={busy} />
              ) : null}
              {info.canDelete ? (
                <Button label="解散并删除频道" variant="danger" onPress={confirmDelete} disabled={busy} />
              ) : null}
              {!info.canDelete ? (
                <Text style={styles.hint}>只有频道创建者可以解散频道；基础群请直接退出。</Text>
              ) : null}
            </View>
          ) : null}

          {info && info.kind === 'user' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>私聊</Text>
              <Text style={styles.hint}>
                这是与用户的私聊，没有成员管理、退出等概念。长按消息可以复制内容。
              </Text>
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function kindLabel(info: ChatInfo | null): string {
  if (!info) return '-';
  if (info.kind === 'user') return '私聊';
  if (info.kind === 'channel') return '广播频道';
  return info.isMegagroup ? '超级群' : '群组';
}

function InfoRow({
  label,
  value,
  editable,
  onEdit,
}: {
  label: string;
  value: string;
  editable?: boolean;
  onEdit?: () => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
      {editable && onEdit ? (
        <Pressable accessibilityRole="button" onPress={onEdit} hitSlop={8}>
          <Text style={styles.rowEdit}>修改</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgAlt,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  back: {
    fontSize: 15,
    color: colors.primary,
    minWidth: 52,
  },
  backSpacer: {
    minWidth: 52,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  heroTitle: {
    marginTop: spacing.sm,
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  heroSub: {
    fontSize: 13,
    color: colors.primaryDark,
  },
  heroMeta: {
    fontSize: 12,
    color: colors.textMuted,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 4,
  },
  rowLabel: {
    width: 64,
    fontSize: 13,
    color: colors.textMuted,
  },
  rowValue: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
  },
  rowEdit: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  editActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 6,
  },
  memberBody: {
    flex: 1,
  },
  memberName: {
    fontSize: 15,
    color: colors.text,
  },
  memberUsername: {
    fontSize: 12,
    color: colors.textFaint,
  },
  memberRole: {
    fontSize: 11,
    color: colors.primaryDark,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  membersLoading: {
    marginVertical: spacing.sm,
  },
  center: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  centerText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  error: {
    fontSize: 13,
    color: colors.danger,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textFaint,
  },
});
