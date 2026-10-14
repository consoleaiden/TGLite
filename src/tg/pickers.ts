/**
 * 相册 / 文件选择器的统一封装。
 *
 * 两个库的返回字段名不一致，这里统一成 PickedFile，
 * 上层就不用关心具体用的是哪个选择器。
 */
import { PermissionsAndroid, Platform } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import DocumentPicker from 'react-native-document-picker';

import type { PickedFile } from './media-transfer';

/**
 * 申请读取媒体所需的权限。
 *
 * Android 13+ 走系统照片选择器，不需要任何权限；
 * Android ≤12 才需要 READ_EXTERNAL_STORAGE，否则选择器会直接返回错误。
 * 用户拒绝时返回 false，由调用方给出友好提示。
 */
async function ensureMediaPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  // API 33 起系统选择器自己处理授权，这里不用管
  if (Number(Platform.Version) >= 33) return true;

  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    // 个别 ROM 上没有这个权限项，交给选择器自己处理
    return true;
  }
}

/**
 * 从相册选一张图片或一个视频。
 * 用户取消时返回 null（不是抛错），调用方据此跳过。
 */
export async function pickImage(): Promise<PickedFile | null> {
  const allowed = await ensureMediaPermission();
  if (!allowed) {
    throw new Error('没有相册读取权限，请到系统设置里授权后重试');
  }

  const result = await launchImageLibrary({
    mediaType: 'mixed',
    selectionLimit: 1,
    // 不开启 base64：大图会撑爆内存，我们只取 uri 再按需读取
    includeBase64: false,
    quality: 1,
  });

  if (result.didCancel) return null;
  if (result.errorCode) {
    throw new Error(`选择失败：${result.errorCode}`);
  }

  const asset = result.assets?.[0];
  if (!asset?.uri) return null;

  return {
    uri: asset.uri,
    name: asset.fileName || `media-${Date.now()}`,
    mimeType: asset.type,
    size: asset.fileSize,
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
  };
}

/**
 * 选任意类型的文件。
 * copyTo 用 'cachesDirectory' 是为了拿到一个稳定可读的本地 uri——
 * 某些 Android 提供商给的 content:// uri 在 fetch 时可能读不到内容。
 */
export async function pickDocument(): Promise<PickedFile | null> {
  const allowed = await ensureMediaPermission();
  if (!allowed) {
    throw new Error('没有文件读取权限，请到系统设置里授权后重试');
  }

  try {
    const result = await DocumentPicker.pick({
      type: [DocumentPicker.types.allFiles],
      copyTo: 'cachesDirectory',
    });

    const file = Array.isArray(result) ? result[0] : result;
    if (!file?.uri) return null;

    return {
      uri: file.fileCopyUri || file.uri,
      name: file.name || `file-${Date.now()}`,
      mimeType: file.type || undefined,
      size: file.size ?? undefined,
      asFile: true,
    };
  } catch (err: any) {
    // 取消选择是正常流程，不该弹错
    if (DocumentPicker.isCancel(err)) return null;
    throw err;
  }
}
