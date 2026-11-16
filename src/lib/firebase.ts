import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);

export const EDUCATOR_EMAIL = 'dilshaanmuhvp@gmail.com';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export type FirestoreConnectionState = 'checking' | 'connected' | 'offline' | 'error';

export async function testFirestoreConnection(): Promise<FirestoreConnectionState> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return 'connected';
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      return 'offline';
    }
    if (error instanceof Error && error.message.toLowerCase().includes('permission')) {
      return 'connected';
    }
    return 'error';
  }
}

export function isEducatorUser(user: User | null): boolean {
  return Boolean(user && user.emailVerified && user.email?.toLowerCase() === EDUCATOR_EMAIL);
}

export async function getEducatorIdToken(): Promise<string | null> {
  const u = auth.currentUser;
  if (!u) return null;
  return u.getIdToken();
}

export async function signInWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  await ensureUserProfile(cred.user);
  return cred.user;
}

export async function signOutUser(): Promise<void> {
  await firebaseSignOut(auth);
}

export function subscribeToAuth(cb: (user: User | null) => void) {
  return onAuthStateChanged(auth, cb);
}

export async function ensureUserProfile(user: User): Promise<void> {
  const path = `users/${user.uid}`;
  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    const displayName = (user.displayName || user.email?.split('@')[0] || 'Educator').slice(0, 120);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        displayName,
        email: (user.email || '').slice(0, 200),
        photoUrl: (user.photoURL || '').slice(0, 500),
        role: 'learner',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        displayName,
        email: (user.email || '').slice(0, 200),
        photoUrl: (user.photoURL || '').slice(0, 500),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function tryUploadToFirebaseStorage(
  storagePath: string,
  fileBlob: Blob,
): Promise<{ uploaded: boolean; downloadUrl?: string; reason?: string }> {
  try {
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, fileBlob, { contentType: fileBlob.type || 'image/jpeg' });
    const downloadUrl = await getDownloadURL(storageRef);
    return { uploaded: true, downloadUrl };
  } catch (err) {
    return {
      uploaded: false,
      reason: err instanceof Error ? err.message : 'Firebase Storage bucket not active',
    };
  }
}

export async function syncSharedModelToFirestore(payload: {
  modelId: string;
  name: string;
  description: string;
  categories: string[];
  datasetSize: number;
  latestVersion: number;
  activeVersion: number;
  accuracy: number;
  precision: number;
  recall: number;
  latencyMs: number;
}): Promise<void> {
  if (!isEducatorUser(auth.currentUser)) return;
  const path = `sharedModels/${payload.modelId}`;
  try {
    const modelRef = doc(db, 'sharedModels', payload.modelId);
    const snap = await getDoc(modelRef);
    if (!snap.exists()) {
      await setDoc(modelRef, {
        modelId: payload.modelId,
        name: payload.name.slice(0, 120),
        description: (payload.description || '').slice(0, 400),
        categories: payload.categories.slice(0, 24),
        datasetSize: payload.datasetSize,
        latestVersion: payload.latestVersion,
        activeVersion: payload.activeVersion,
        accuracy: payload.accuracy,
        precision: payload.precision,
        recall: payload.recall,
        latencyMs: payload.latencyMs,
        isApproved: true,
        isPublic: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(modelRef, {
        name: payload.name.slice(0, 120),
        description: (payload.description || '').slice(0, 400),
        categories: payload.categories.slice(0, 24),
        datasetSize: payload.datasetSize,
        latestVersion: payload.latestVersion,
        activeVersion: payload.activeVersion,
        accuracy: payload.accuracy,
        precision: payload.precision,
        recall: payload.recall,
        latencyMs: payload.latencyMs,
        isApproved: true,
        isPublic: true,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncEducatorSettingsToFirestore(settings: {
  sessionDurationMinutes: number;
  autoCleanupOnFinish: boolean;
  retainAnonymousFeedback: boolean;
  allowSharedModelPromotion: boolean;
  maxUploadImagesPerSession: number;
}): Promise<void> {
  if (!isEducatorUser(auth.currentUser)) return;
  const path = 'educatorSettings/default';
  try {
    await setDoc(doc(db, 'educatorSettings', 'default'), {
      settingId: 'default',
      sessionDurationMinutes: settings.sessionDurationMinutes,
      autoCleanupOnFinish: settings.autoCleanupOnFinish,
      retainAnonymousFeedback: settings.retainAnonymousFeedback,
      allowSharedModelPromotion: settings.allowSharedModelPromotion,
      maxUploadImagesPerSession: settings.maxUploadImagesPerSession,
      isPublic: true,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncSessionSummaryToFirestore(summary: {
  summaryId: string;
  sessionId: string;
  nickname?: string;
  categoriesCreated: number;
  imagesAdded: number;
  modelsTested: number;
  predictionsCount: number;
  verifiedCorrectCount: number;
  feedbackSubmittedCount: number;
}): Promise<void> {
  if (!isEducatorUser(auth.currentUser)) return;
  const path = `sessionSummaries/${summary.summaryId}`;
  try {
    await setDoc(doc(db, 'sessionSummaries', summary.summaryId), {
      summaryId: summary.summaryId,
      sessionId: summary.sessionId,
      nickname: (summary.nickname || 'Anonymous Participant').slice(0, 60),
      categoriesCreated: summary.categoriesCreated,
      imagesAdded: summary.imagesAdded,
      modelsTested: summary.modelsTested,
      predictionsCount: summary.predictionsCount,
      verifiedCorrectCount: summary.verifiedCorrectCount,
      feedbackSubmittedCount: summary.feedbackSubmittedCount,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export { firebaseConfig };
