import { PermissionsAndroid, Platform } from 'react-native';
import {
  launchCamera,
  launchImageLibrary,
  Asset,
  ImageLibraryOptions,
  CameraOptions,
} from 'react-native-image-picker';
import apiClient from '../api';
import { saveCachedMedia } from '../db';

export interface PickedImage {
  uri: string;
  /** Data URI of the resized image — shown instantly and cached locally */
  dataUri: string;
  fileName: string;
  type: string;
  width?: number;
  height?: number;
  fileSize?: number;
}

/**
 * Photos are downscaled before they ever leave the picker. This keeps the
 * upload small, keeps the base64 copy that gets cached in SQLite manageable,
 * and strips nothing else — the server stores exactly what it is handed.
 */
const PICKER_OPTIONS = {
  mediaType: 'photo' as const,
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 0.8 as const,
  includeBase64: true,
  // EXIF can carry GPS coordinates; a disappearing-photo app should not ship
  // the sender's location along with the picture.
  includeExtra: false,
};

const toPickedImage = (asset?: Asset): PickedImage | null => {
  if (!asset?.uri || !asset.base64) return null;

  const type = asset.type || 'image/jpeg';
  return {
    uri: asset.uri,
    dataUri: `data:${type};base64,${asset.base64}`,
    fileName: asset.fileName || `photo-${Date.now()}.jpg`,
    type,
    width: asset.width,
    height: asset.height,
    fileSize: asset.fileSize,
  };
};

/** Android below 33 needs an explicit grant before the camera can be opened. */
const ensureCameraPermission = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return true;

  const permission = PermissionsAndroid.PERMISSIONS.CAMERA;
  if (await PermissionsAndroid.check(permission)) return true;

  const result = await PermissionsAndroid.request(permission, {
    title: 'Camera access',
    message: 'Allow the app to take a photo to send.',
    buttonPositive: 'Allow',
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
};

export const pickImageFromGallery = async (): Promise<PickedImage | null> => {
  const options: ImageLibraryOptions = { ...PICKER_OPTIONS, selectionLimit: 1 };
  const response = await launchImageLibrary(options);

  if (response.didCancel) return null;
  if (response.errorCode) {
    throw new Error(response.errorMessage || 'Could not open the gallery');
  }
  return toPickedImage(response.assets?.[0]);
};

export const takePhotoWithCamera = async (): Promise<PickedImage | null> => {
  if (!(await ensureCameraPermission())) {
    throw new Error('Camera permission denied');
  }

  const options: CameraOptions = { ...PICKER_OPTIONS, saveToPhotos: false };
  const response = await launchCamera(options);

  if (response.didCancel) return null;
  if (response.errorCode) {
    throw new Error(response.errorMessage || 'Could not open the camera');
  }
  return toPickedImage(response.assets?.[0]);
};

/**
 * Send the file to the server's upload folder and get back the attachment id
 * that the chat message will reference. React Native's FormData takes the file
 * URI directly, so the bytes never pass through JS.
 */
export const uploadImage = async (
  image: PickedImage,
  conversationId: string,
  clientMsgId: string
): Promise<string> => {
  const form = new FormData();
  form.append('image', {
    uri: image.uri,
    name: image.fileName,
    type: image.type,
  } as any);
  form.append('conversation_id', conversationId);
  form.append('client_msg_id', clientMsgId);
  if (image.width) form.append('width', String(image.width));
  if (image.height) form.append('height', String(image.height));

  const response = await apiClient.post('/media/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // A photo on a slow connection needs longer than a JSON round-trip
    timeout: 60000,
  });

  const attachmentId = response.data?.attachmentId;
  if (!attachmentId) throw new Error('Upload did not return an attachment id');
  return String(attachmentId);
};

/**
 * Fetch a received photo and cache it against the message. Returns null when
 * the server says the image is already burned, so the bubble can show that
 * rather than retrying forever.
 */
export const downloadImage = async (
  attachmentId: string,
  clientMsgId: string
): Promise<string | null> => {
  try {
    const response = await apiClient.get(`/media/${attachmentId}`, {
      params: { format: 'base64' },
      timeout: 60000,
    });

    const dataUri: string | undefined = response.data?.dataUri;
    if (!dataUri) return null;

    await saveCachedMedia(clientMsgId, dataUri);
    return dataUri;
  } catch (error: any) {
    if (error?.response?.status === 410) {
      console.log('🔥 Photo was already burned on the server');
      return null;
    }
    throw error;
  }
};
