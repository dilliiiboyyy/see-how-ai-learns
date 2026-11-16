import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import type { User } from 'firebase/auth';
import {
  subscribeToAuth,
  signInWithGoogle,
  signOutUser,
  testFirestoreConnection,
  isEducatorUser,
  getEducatorIdToken,
  type FirestoreConnectionState,
} from '../lib/firebase';
import {
  hydrateSerializedClassifier,
  trainTransferClassifier,
  getCachedModelLocally,
  cacheModelLocally,
  type LoadedClassifier,
  type SerializedClassifierModel,
} from '../ml/visionEngine';

export type AppPage = 'home' | 'explore' | 'learn' | 'studio' | 'test' | 'models' | 'educator';

const SESSION_STORAGE_KEY = 'edex_session_auth';
const SESSION_NAV_STORAGE_KEY = 'edex_session_nav';

export interface FirebaseStatusSummary {
  projectId: string;
  firestoreDatabaseId: string;
  storageBucket: string;
  storageBucketEnabled: boolean;
  storageDetail: string;
  totalImages: number;
  builtInCount: number;
  userCount: number;
  autonomousCount: number;
  pendingValidation: number;
  failedUploads: number;
  storageUsageBytes: number;
  storageUsageMB: number;
  categories: Array<{
    id: string;
    name: string;
    slug: string;
    description: string;
    targetCount: number;
    imageCount: number;
    builtInCount: number;
    userCount: number;
    autonomousCount: number;
    averageQuality: number;
    totalBytes: number;
    previewImages: Array<{ imageId: string; thumbnailUrl: string; url: string; title: string }>;
  }>;
  modelsCount: number;
  projectsCount: number;
  activeSessionsCount?: number;
}

export interface SavedModelItem {
  modelId: string;
  name: string;
  description: string;
  ownerId: string;
  projectId: string;
  isPublic: boolean;
  isShared?: boolean;
  categories: string[];
  datasetSize: number;
  latestVersion: number;
  activeVersion: number;
  accuracy: number;
  precision: number;
  recall: number;
  latencyMs: number;
  status: string;
  versions: Array<{
    versionId: string;
    modelId: string;
    version: number;
    accuracy: number;
    valAccuracy: number;
    testAccuracy: number;
    precision: number;
    recall: number;
    latencyMs: number;
    datasetSize: number;
    isDeployed: boolean;
    trigger: 'manual' | 'autonomous';
    confusionMatrix?: number[][];
    classMetrics?: Array<{ label: string; precision: number; recall: number; support: number }>;
    epochHistory?: Array<{ epoch: number; trainAcc: number; valAcc: number; loss: number }>;
    serializedModelJson?: string;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface StudioProjectItem {
  projectId: string;
  name: string;
  description: string;
  ownerId: string;
  isPublic: boolean;
  isExample?: boolean;
  categories: Array<{
    categoryId: string;
    name: string;
    slug: string;
    images: Array<{
      imageId: string;
      url: string;
      thumbnailUrl: string;
      title: string;
      sha256?: string;
      source?: string;
    }>;
  }>;
  activeModelId?: string;
  status: 'draft' | 'ready' | 'trained';
  createdAt: string;
  updatedAt: string;
}

export interface ActiveParticipantSession {
  sessionId: string;
  nickname: string;
  status: 'active' | 'finishing' | 'finished' | 'expired';
  categories: StudioProjectItem['categories'];
  projects: StudioProjectItem[];
  models: SavedModelItem[];
  predictionsCount: number;
  feedbackCount: number;
  verifiedCorrectCount: number;
  modelsTested: string[];
  sessionSettings: {
    confidenceThreshold: number;
  };
  createdAt: string;
  expiresAt: string;
}

export interface SessionSummaryData {
  summaryId: string;
  sessionId: string;
  nickname: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  categoriesCreated: number;
  imagesAdded: number;
  modelsTrained: number;
  modelsTested: number;
  predictionsCount: number;
  verifiedCorrectCount: number;
  feedbackSubmittedCount: number;
  sharedFeedbackCount: number;
  status: string;
}

export interface EducatorSettingsData {
  sessionDurationMinutes: number;
  autoCleanupOnFinish: boolean;
  retainAnonymousFeedback: boolean;
  allowSharedModelPromotion: boolean;
  maxUploadImagesPerSession: number;
}

interface PlatformContextValue {
  page: AppPage;
  navigate: (page: AppPage, options?: { projectId?: string; modelId?: string; categorySlug?: string }) => void;
  navParams: { projectId?: string; modelId?: string; categorySlug?: string };
  user: User | null;
  authReady: boolean;
  isEducator: boolean;
  getIdToken: () => Promise<string | null>;
  firestoreState: FirestoreConnectionState;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  firebaseStatus: FirebaseStatusSummary | null;
  refreshFirebaseStatus: () => Promise<void>;
  sharedModels: SavedModelItem[];
  sessionModels: SavedModelItem[];
  savedModels: SavedModelItem[];
  refreshModels: () => Promise<void>;
  projects: StudioProjectItem[];
  refreshProjects: () => Promise<void>;
  activeClassifier: LoadedClassifier | null;
  activeModelMeta: { modelId: string; name: string; version: number; isShared?: boolean } | null;
  setActiveModelFromSaved: (model: SavedModelItem, versionNum?: number) => boolean;
  setLiveClassifier: (
    classifier: LoadedClassifier,
    meta: { modelId: string; name: string; version: number; isShared?: boolean },
  ) => void;
  starterStatus: { loading: boolean; progress: number; phase: string; error?: string };
  ensureStarterModel: () => Promise<LoadedClassifier | null>;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  // EdEx Multi-Participant Session State
  session: ActiveParticipantSession | null;
  sessionToken: string | null;
  sessionInitializing: boolean;
  sessionNotice: string;
  setSessionNotice: (msg: string) => void;
  educatorSettings: EducatorSettingsData | null;
  startSession: (opts?: { nickname?: string }) => Promise<ActiveParticipantSession>;
  refreshSession: () => Promise<void>;
  syncSessionWorkspace: (payload: {
    categories?: StudioProjectItem['categories'];
    project?: Omit<StudioProjectItem, 'ownerId' | 'isPublic' | 'createdAt' | 'updatedAt'>;
    sessionSettings?: { confidenceThreshold?: number };
  }) => Promise<void>;
  saveTrainedModel: (args: {
    modelId?: string;
    name: string;
    description?: string;
    projectId: string;
    serialized: SerializedClassifierModel;
    proposeForShared?: boolean;
  }) => Promise<{ model: SavedModelItem; proposalStatus?: string }>;
  recordSessionPrediction: (args: {
    modelId: string;
    modelName: string;
    predictedLabel: string;
    confidence: number;
    isUnknown: boolean;
  }) => Promise<void>;
  submitSessionFeedback: (args: {
    modelId: string;
    predictedLabel: string;
    predictedConfidence: number;
    isCorrect: boolean;
    correctedCategory?: string;
    approveForShared?: boolean;
  }) => Promise<{ sharedFeedbackSaved: boolean }>;
  fetchSessionSummary: () => Promise<{ summary: SessionSummaryData; takeaways: string[] } | null>;
  finishModalOpen: boolean;
  setFinishModalOpen: (open: boolean) => void;
  finishSession: () => Promise<{ summary: SessionSummaryData | null; sharedFeedbackRetained: boolean }>;
  registerStopHandler: (id: string, fn: () => void) => () => void;
  stopAllActiveProcessing: () => void;
  beginInFlightOp: () => void;
  endInFlightOp: () => void;
  inFlightCount: number;
  sessionHeaders: () => Record<string, string>;
}

const PlatformContext = createContext<PlatformContextValue | null>(null);

export function PlatformProvider({ children }: { children: React.ReactNode }) {
  const [page, setPage] = useState<AppPage>('home');
  const [navParams, setNavParams] = useState<{ projectId?: string; modelId?: string; categorySlug?: string }>({});
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [firestoreState, setFirestoreState] = useState<FirestoreConnectionState>('checking');
  const [firebaseStatus, setFirebaseStatus] = useState<FirebaseStatusSummary | null>(null);

  const [sharedModels, setSharedModels] = useState<SavedModelItem[]>([]);
  const [sessionModels, setSessionModels] = useState<SavedModelItem[]>([]);
  const [projects, setProjects] = useState<StudioProjectItem[]>([]);
  const [activeClassifier, setActiveClassifier] = useState<LoadedClassifier | null>(null);
  const [activeModelMeta, setActiveModelMeta] = useState<{
    modelId: string;
    name: string;
    version: number;
    isShared?: boolean;
  } | null>(null);
  const [starterStatus, setStarterStatus] = useState<{
    loading: boolean;
    progress: number;
    phase: string;
    error?: string;
  }>({
    loading: false,
    progress: 0,
    phase: '',
  });
  const [settingsOpen, setSettingsOpen] = useState(false);

  // EdEx Session state
  const [session, setSession] = useState<ActiveParticipantSession | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [sessionInitializing, setSessionInitializing] = useState(true);
  const [sessionNotice, setSessionNotice] = useState('');
  const [educatorSettings, setEducatorSettings] = useState<EducatorSettingsData | null>(null);
  const [finishModalOpen, setFinishModalOpen] = useState(false);

  const stopHandlersRef = useRef<Map<string, () => void>>(new Map());
  const inFlightRef = useRef(0);
  const [inFlightCount, setInFlightCount] = useState(0);

  const registerStopHandler = useCallback((id: string, fn: () => void) => {
    stopHandlersRef.current.set(id, fn);
    return () => {
      stopHandlersRef.current.delete(id);
    };
  }, []);

  const stopAllActiveProcessing = useCallback(() => {
    for (const fn of stopHandlersRef.current.values()) {
      try {
        fn();
      } catch {
        // ignore handler cleanup errors
      }
    }
  }, []);

  const beginInFlightOp = useCallback(() => {
    inFlightRef.current += 1;
    setInFlightCount(inFlightRef.current);
  }, []);

  const endInFlightOp = useCallback(() => {
    inFlightRef.current = Math.max(0, inFlightRef.current - 1);
    setInFlightCount(inFlightRef.current);
  }, []);

  const sessionHeaders = useCallback((): Record<string, string> => {
    if (!session?.sessionId || !sessionToken) return {};
    return {
      'x-session-id': session.sessionId,
      'x-session-token': sessionToken,
    };
  }, [session?.sessionId, sessionToken]);

  const navigate = useCallback(
    (nextPage: AppPage, options?: { projectId?: string; modelId?: string; categorySlug?: string }) => {
      setPage(nextPage);
      const nextParams = options || {};
      setNavParams(nextParams);
      try {
        sessionStorage.setItem(SESSION_NAV_STORAGE_KEY, JSON.stringify({ page: nextPage, navParams: nextParams }));
      } catch {
        // ignore storage quota errors
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [],
  );

  const refreshFirebaseStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/firebase/status');
      if (res.ok) {
        const data = (await res.json()) as FirebaseStatusSummary;
        setFirebaseStatus(data);
      }
    } catch {
      // ignore transient error
    }
  }, []);

  const refreshModels = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (session?.sessionId && sessionToken) {
        headers['x-session-id'] = session.sessionId;
        headers['x-session-token'] = sessionToken;
      }
      const res = await fetch('/api/models', { headers });
      if (res.ok) {
        const data = (await res.json()) as {
          sharedModels?: SavedModelItem[];
          sessionModels?: SavedModelItem[];
          models?: SavedModelItem[];
        };
        setSharedModels(data.sharedModels || []);
        setSessionModels(data.sessionModels || []);
      }
    } catch {
      // ignore
    }
  }, [session?.sessionId, sessionToken]);

  const refreshProjects = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (session?.sessionId && sessionToken) {
        headers['x-session-id'] = session.sessionId;
        headers['x-session-token'] = sessionToken;
      }
      const res = await fetch('/api/projects', { headers });
      if (res.ok) {
        const data = (await res.json()) as { projects: StudioProjectItem[] };
        setProjects(data.projects || []);
      }
    } catch {
      // ignore
    }
  }, [session?.sessionId, sessionToken]);

  const refreshSession = useCallback(async () => {
    if (!session?.sessionId || !sessionToken) return;
    const res = await fetch('/api/sessions/current', {
      headers: {
        'x-session-id': session.sessionId,
        'x-session-token': sessionToken,
      },
    });
    if (res.ok) {
      const data = await res.json();
      setSession(data.session);
      setSessionModels(data.session.models || []);
      if (data.educatorSettings) setEducatorSettings(data.educatorSettings);
    } else if (res.status === 401 || res.status === 403) {
      // Session expired or reset by educator
      stopAllActiveProcessing();
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      setSession(null);
      setSessionToken(null);
      setSessionModels([]);
      setActiveClassifier(null);
      setActiveModelMeta(null);
      setSessionNotice('Your previous session ended or timed out. Ready for a new participant.');
    }
  }, [session?.sessionId, sessionToken, stopAllActiveProcessing]);

  // Boot: Firebase auth, connection check, and recover active session from sessionStorage if present
  useEffect(() => {
    const unsub = subscribeToAuth((u) => {
      setUser(u);
      setAuthReady(true);
    });
    testFirestoreConnection().then(setFirestoreState).catch(() => setFirestoreState('error'));

    const restoreSession = async () => {
      try {
        const savedRaw = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (savedRaw) {
          const parsed = JSON.parse(savedRaw) as { sessionId?: string; sessionToken?: string };
          if (parsed.sessionId && parsed.sessionToken) {
            const res = await fetch('/api/sessions/current', {
              headers: {
                'x-session-id': parsed.sessionId,
                'x-session-token': parsed.sessionToken,
              },
            });
            if (res.ok) {
              const data = await res.json();
              setSession(data.session);
              setSessionToken(parsed.sessionToken);
              setSessionModels(data.session.models || []);
              if (data.educatorSettings) setEducatorSettings(data.educatorSettings);
              try {
                const navRaw = sessionStorage.getItem(SESSION_NAV_STORAGE_KEY);
                if (navRaw) {
                  const navParsed = JSON.parse(navRaw) as {
                    page?: AppPage;
                    navParams?: { projectId?: string; modelId?: string; categorySlug?: string };
                  };
                  if (navParsed.page) setPage(navParsed.page);
                  if (navParsed.navParams) setNavParams(navParsed.navParams);
                }
              } catch {
                // ignore
              }
            } else {
              sessionStorage.removeItem(SESSION_STORAGE_KEY);
              sessionStorage.removeItem(SESSION_NAV_STORAGE_KEY);
            }
          }
        }
      } catch {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        sessionStorage.removeItem(SESSION_NAV_STORAGE_KEY);
      } finally {
        setSessionInitializing(false);
      }
    };
    void restoreSession();

    return () => unsub();
  }, []);

  // Ensure camera streams stop on pagehide (tab close / navigation away)
  useEffect(() => {
    const handlePageHide = () => {
      stopAllActiveProcessing();
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [stopAllActiveProcessing]);

  useEffect(() => {
    void refreshFirebaseStatus();
    void refreshModels();
    void refreshProjects();
  }, [refreshFirebaseStatus, refreshModels, refreshProjects]);

  const startSession = useCallback(
    async (opts?: { nickname?: string }) => {
      stopAllActiveProcessing();
      setActiveClassifier(null);
      setActiveModelMeta(null);
      setSessionNotice('');
      const res = await fetch('/api/sessions/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts || {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to start participant session');
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({ sessionId: data.session.sessionId, sessionToken: data.sessionToken }),
      );
      sessionStorage.removeItem(SESSION_NAV_STORAGE_KEY);
      setSessionToken(data.sessionToken);
      setSession(data.session);
      setSessionModels([]);
      if (data.educatorSettings) setEducatorSettings(data.educatorSettings);
      setPage('home');
      setNavParams({});
      return data.session as ActiveParticipantSession;
    },
    [stopAllActiveProcessing],
  );

  const syncSessionWorkspace = useCallback(
    async (payload: {
      categories?: StudioProjectItem['categories'];
      project?: Omit<StudioProjectItem, 'ownerId' | 'isPublic' | 'createdAt' | 'updatedAt'>;
      sessionSettings?: { confidenceThreshold?: number };
    }) => {
      if (!session?.sessionId || !sessionToken) return;
      beginInFlightOp();
      try {
        const res = await fetch('/api/sessions/workspace', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-session-id': session.sessionId,
            'x-session-token': sessionToken,
          },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          await refreshSession();
          await refreshProjects();
        }
      } finally {
        endInFlightOp();
      }
    },
    [session?.sessionId, sessionToken, beginInFlightOp, endInFlightOp, refreshSession, refreshProjects],
  );

  const signIn = useCallback(async () => {
    await signInWithGoogle();
  }, []);

  const signOut = useCallback(async () => {
    await signOutUser();
  }, []);

  const setLiveClassifier = useCallback(
    (classifier: LoadedClassifier, meta: { modelId: string; name: string; version: number; isShared?: boolean }) => {
      setActiveClassifier(classifier);
      setActiveModelMeta(meta);
    },
    [],
  );

  const setActiveModelFromSaved = useCallback((model: SavedModelItem, versionNum?: number) => {
    const targetVer =
      model.versions.find((v) => v.version === (versionNum ?? model.activeVersion)) || model.versions[0];
    if (!targetVer?.serializedModelJson) return false;
    try {
      const parsed = JSON.parse(targetVer.serializedModelJson) as SerializedClassifierModel;
      const hydrated = hydrateSerializedClassifier(parsed);
      setActiveClassifier(hydrated);
      setActiveModelMeta({
        modelId: model.modelId,
        name: model.name,
        version: targetVer.version,
        isShared: model.isShared ?? model.isPublic,
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  const ensureStarterModel = useCallback(async (): Promise<LoadedClassifier | null> => {
    if (activeClassifier) return activeClassifier;

    const existingRef = sharedModels.find((m) => m.modelId === 'mdl_builtin_reference');
    if (existingRef) {
      const targetVer = existingRef.versions.find((v) => v.version === existingRef.activeVersion) || existingRef.versions[0];
      if (targetVer?.serializedModelJson) {
        try {
          const hydrated = hydrateSerializedClassifier(
            JSON.parse(targetVer.serializedModelJson) as SerializedClassifierModel,
          );
          setActiveClassifier(hydrated);
          setActiveModelMeta({
            modelId: existingRef.modelId,
            name: existingRef.name,
            version: targetVer.version,
            isShared: true,
          });
          return hydrated;
        } catch {
          // fall through
        }
      }
    }

    const cached = await getCachedModelLocally('built_in_12_cat_v1');
    if (cached && cached.labels.length >= 2) {
      const hydrated = hydrateSerializedClassifier(cached);
      setActiveClassifier(hydrated);
      setActiveModelMeta({
        modelId: 'mdl_builtin_reference',
        name: '12-Object Reference Model',
        version: 1,
        isShared: true,
      });
      return hydrated;
    }

    setStarterStatus({ loading: true, progress: 3, phase: 'Loading validated dataset examples...' });
    try {
      const catRes = await fetch('/api/dataset/categories');
      const catData = (await catRes.json()) as { categories: FirebaseStatusSummary['categories'] };
      const availableCats = (catData.categories || []).filter((c) => c.imageCount >= 4);
      if (availableCats.length < 2) {
        setStarterStatus({
          loading: false,
          progress: 0,
          phase: '',
          error: 'Built-in dataset is still populating. Refresh in a moment.',
        });
        return null;
      }

      const samples: Array<{ imageId: string; label: string; url: string; sha256?: string }> = [];
      await Promise.all(
        availableCats.map(async (cat) => {
          const imgRes = await fetch(`/api/dataset/images?category=${encodeURIComponent(cat.slug)}&limit=8`);
          const imgData = (await imgRes.json()) as {
            images: Array<{ imageId: string; url: string; sha256: string }>;
          };
          for (const im of imgData.images || []) {
            samples.push({
              imageId: im.imageId,
              label: cat.name,
              url: im.url,
              sha256: im.sha256,
            });
          }
        }),
      );

      const { classifier, serialized } = await trainTransferClassifier(samples, {
        epochs: 18,
        learningRate: 0.002,
        onProgress: (info) => {
          setStarterStatus({ loading: true, progress: info.percent, phase: info.phase });
        },
      });

      await cacheModelLocally('built_in_12_cat_v1', serialized);

      await fetch('/api/shared-models/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categories: serialized.labels,
          datasetSize: serialized.metrics.datasetSize,
          accuracy: serialized.metrics.trainAccuracy,
          valAccuracy: serialized.metrics.valAccuracy,
          testAccuracy: serialized.metrics.testAccuracy,
          precision: serialized.metrics.precision,
          recall: serialized.metrics.recall,
          latencyMs: serialized.metrics.latencyMs,
          confusionMatrix: serialized.metrics.confusionMatrix,
          classMetrics: serialized.metrics.classMetrics,
          epochHistory: serialized.metrics.epochHistory,
          serializedModelJson: JSON.stringify(serialized),
        }),
      }).catch(() => {});

      await refreshModels();
      setActiveClassifier(classifier);
      setActiveModelMeta({
        modelId: 'mdl_builtin_reference',
        name: '12-Object Reference Model',
        version: 1,
        isShared: true,
      });
      setStarterStatus({ loading: false, progress: 100, phase: 'Ready' });
      return classifier;
    } catch (err) {
      setStarterStatus({
        loading: false,
        progress: 0,
        phase: '',
        error: err instanceof Error ? err.message : 'Unable to train reference model',
      });
      return null;
    }
  }, [activeClassifier, refreshModels, sharedModels]);

  const saveTrainedModel = useCallback(
    async (args: {
      modelId?: string;
      name: string;
      description?: string;
      projectId: string;
      serialized: SerializedClassifierModel;
      proposeForShared?: boolean;
    }) => {
      if (!session?.sessionId || !sessionToken) {
        throw new Error('Start a participant session before saving a model.');
      }
      beginInFlightOp();
      try {
        const weightsJson = JSON.stringify(args.serialized);
        const res = await fetch('/api/sessions/models', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-session-id': session.sessionId,
            'x-session-token': sessionToken,
          },
          body: JSON.stringify({
            modelId: args.modelId,
            name: args.name,
            description: args.description,
            projectId: args.projectId,
            categories: args.serialized.labels,
            datasetSize: args.serialized.metrics.datasetSize,
            accuracy: args.serialized.metrics.trainAccuracy,
            valAccuracy: args.serialized.metrics.valAccuracy,
            testAccuracy: args.serialized.metrics.testAccuracy,
            precision: args.serialized.metrics.precision,
            recall: args.serialized.metrics.recall,
            latencyMs: args.serialized.metrics.latencyMs,
            confusionMatrix: args.serialized.metrics.confusionMatrix,
            classMetrics: args.serialized.metrics.classMetrics,
            epochHistory: args.serialized.metrics.epochHistory,
            serializedModelJson: weightsJson,
            proposeForShared: args.proposeForShared,
          }),
        });
        const data = (await res.json()) as {
          model: SavedModelItem;
          proposalStatus?: string;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || 'Failed to save session model');

        await refreshSession();
        await refreshModels();
        await refreshFirebaseStatus();
        return data;
      } finally {
        endInFlightOp();
      }
    },
    [session?.sessionId, sessionToken, beginInFlightOp, endInFlightOp, refreshSession, refreshModels, refreshFirebaseStatus],
  );

  const recordSessionPrediction = useCallback(
    async (args: {
      modelId: string;
      modelName: string;
      predictedLabel: string;
      confidence: number;
      isUnknown: boolean;
    }) => {
      if (!session?.sessionId || !sessionToken) return;
      const res = await fetch('/api/sessions/predictions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': session.sessionId,
          'x-session-token': sessionToken,
        },
        body: JSON.stringify(args),
      });
      if (res.ok) {
        const data = await res.json();
        setSession((prev) =>
          prev
            ? {
                ...prev,
                predictionsCount: data.predictionsCount,
                modelsTested: data.modelsTested,
              }
            : null,
        );
      }
    },
    [session?.sessionId, sessionToken],
  );

  const submitSessionFeedback = useCallback(
    async (args: {
      modelId: string;
      predictedLabel: string;
      predictedConfidence: number;
      isCorrect: boolean;
      correctedCategory?: string;
      approveForShared?: boolean;
    }) => {
      if (!session?.sessionId || !sessionToken) {
        throw new Error('Start a session to submit feedback.');
      }
      beginInFlightOp();
      try {
        const res = await fetch('/api/sessions/feedback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-session-id': session.sessionId,
            'x-session-token': sessionToken,
          },
          body: JSON.stringify(args),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to submit feedback');
        await refreshSession();
        return { sharedFeedbackSaved: Boolean(data.sharedFeedbackSaved) };
      } finally {
        endInFlightOp();
      }
    },
    [session?.sessionId, sessionToken, beginInFlightOp, endInFlightOp, refreshSession],
  );

  const fetchSessionSummary = useCallback(async () => {
    if (!session?.sessionId || !sessionToken) return null;
    const res = await fetch('/api/sessions/summary', {
      headers: {
        'x-session-id': session.sessionId,
        'x-session-token': sessionToken,
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as { summary: SessionSummaryData; takeaways: string[] };
  }, [session?.sessionId, sessionToken]);

  const finishSession = useCallback(async () => {
    // 1. Synchronously halt webcam streams, inference loops, and cancel active training hooks
    stopAllActiveProcessing();

    // 2. Wait briefly for any in-flight save or upload before purging
    for (let i = 0; i < 15; i++) {
      if (inFlightRef.current <= 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    let finalSummary: SessionSummaryData | null = null;
    let sharedFeedbackRetained = false;

    if (session?.sessionId && sessionToken) {
      try {
        const res = await fetch('/api/sessions/finish', {
          method: 'POST',
          headers: {
            'x-session-id': session.sessionId,
            'x-session-token': sessionToken,
          },
        });
        if (res.ok) {
          const data = await res.json();
          finalSummary = data.summary || null;
          sharedFeedbackRetained = Boolean(data.sharedFeedbackRetained);
        }
      } catch {
        // Proceed with local workspace cleanup regardless
      }
    }

    // 3. Wipe participant workspace & session-scoped frontend state cleanly
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    sessionStorage.removeItem(SESSION_NAV_STORAGE_KEY);
    setSession(null);
    setSessionToken(null);
    setSessionModels([]);
    setActiveClassifier(null);
    setActiveModelMeta(null);
    setFinishModalOpen(false);
    setNavParams({});
    setPage('home');
    setSessionNotice('Previous session finished and temporary workspace cleared. Ready for the next participant.');

    void refreshModels();
    void refreshProjects();
    void refreshFirebaseStatus();

    return { summary: finalSummary, sharedFeedbackRetained };
  }, [session?.sessionId, sessionToken, stopAllActiveProcessing, refreshModels, refreshProjects, refreshFirebaseStatus]);

  const savedModels = [...sessionModels, ...sharedModels];
  const isEducator = isEducatorUser(user);

  return (
    <PlatformContext.Provider
      value={{
        page,
        navigate,
        navParams,
        user,
        authReady,
        isEducator,
        getIdToken: getEducatorIdToken,
        firestoreState,
        signIn,
        signOut,
        firebaseStatus,
        refreshFirebaseStatus,
        sharedModels,
        sessionModels,
        savedModels,
        refreshModels,
        projects,
        refreshProjects,
        activeClassifier,
        activeModelMeta,
        setActiveModelFromSaved,
        setLiveClassifier,
        starterStatus,
        ensureStarterModel,
        settingsOpen,
        setSettingsOpen,
        session,
        sessionToken,
        sessionInitializing,
        sessionNotice,
        setSessionNotice,
        educatorSettings,
        startSession,
        refreshSession,
        syncSessionWorkspace,
        saveTrainedModel,
        recordSessionPrediction,
        submitSessionFeedback,
        fetchSessionSummary,
        finishModalOpen,
        setFinishModalOpen,
        finishSession,
        registerStopHandler,
        stopAllActiveProcessing,
        beginInFlightOp,
        endInFlightOp,
        inFlightCount,
        sessionHeaders,
      }}
    >
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform() {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error('usePlatform must be used within PlatformProvider');
  return ctx;
}
