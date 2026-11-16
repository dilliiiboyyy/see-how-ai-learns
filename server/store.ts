import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { BUILT_IN_CATEGORIES } from './categories.ts';
import { hammingDistanceHex } from './imageValidator.ts';

export interface ImageRecord {
  imageId: string;
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  title: string;
  storagePath: string;
  thumbnailPath: string;
  url: string;
  thumbnailUrl: string;
  source: string;
  sourceUrl: string;
  license: string;
  width: number;
  height: number;
  format: 'jpeg' | 'png' | 'webp';
  sizeBytes: number;
  sha256: string;
  phash: string;
  qualityScore: number;
  blurScore: number;
  validationStatus: 'validated' | 'pending' | 'failed' | 'duplicate';
  datasetType: 'built-in' | 'user' | 'autonomous';
  projectId?: string;
  ownerId: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SavedModelVersion {
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
}

export interface SavedModelRecord {
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
  status: 'ready' | 'training' | 'archived';
  versions: SavedModelVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface StudioProjectRecord {
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

export interface LearningQueueItem {
  queueId: string;
  categorySlug: string;
  categoryName: string;
  imageId: string;
  source: string;
  sourceUrl: string;
  license: string;
  imageUrl: string;
  thumbnailUrl: string;
  qualityScore: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'trained';
  createdAt: string;
  updatedAt: string;
}

export interface UserCorrectionRecord {
  correctionId: string;
  modelId: string;
  ownerId: string;
  predictedCategory: string;
  predictedConfidence: number;
  isCorrect: boolean;
  correctedCategory?: string;
  status: 'pending' | 'verified' | 'applied';
  createdAt: string;
  updatedAt: string;
}

export interface SharedFeedbackRecord {
  feedbackId: string;
  modelId: string;
  predictedCategory: string;
  predictedConfidence: number;
  isCorrect: boolean;
  correctedCategory?: string;
  status: 'verified' | 'pending' | 'applied';
  createdAt: string;
  updatedAt: string;
}

export interface LearningActivityRecord {
  activityId: string;
  type: 'collection' | 'confusion' | 'dedup' | 'retrain' | 'evaluation' | 'rollback' | 'correction';
  title: string;
  detail: string;
  categorySlug?: string;
  modelId?: string;
  createdAt: string;
}

export interface SystemSettingsRecord {
  autonomousEnabled: boolean;
  autoCollectEnabled: boolean;
  autoRetrainEnabled: boolean;
  paused: boolean;
  maxDailyImages: number;
  retrainFrequencyHours: number;
  minConfidenceThreshold: number;
  minImprovementDelta: number;
  lastRunAt: string | null;
  dailyCollectedCount: number;
  dailyCollectedDate: string;
  updatedAt: string;
}

export interface EducatorSettingsRecord {
  sessionDurationMinutes: number;
  autoCleanupOnFinish: boolean;
  retainAnonymousFeedback: boolean;
  allowSharedModelPromotion: boolean;
  maxUploadImagesPerSession: number;
  updatedAt: string;
}

export interface SessionPredictionRecord {
  predictionId: string;
  modelId: string;
  modelName: string;
  predictedLabel: string;
  confidence: number;
  isUnknown: boolean;
  createdAt: string;
}

export interface SessionFeedbackRecord {
  feedbackId: string;
  modelId: string;
  predictedLabel: string;
  predictedConfidence: number;
  isCorrect: boolean;
  correctedCategory?: string;
  approvedForShared: boolean;
  sharedFeedbackId?: string;
  createdAt: string;
}

export interface ParticipantSessionRecord {
  sessionId: string;
  tokenHash: string;
  nickname: string;
  status: 'active' | 'finishing' | 'finished' | 'expired';
  categories: StudioProjectRecord['categories'];
  projects: StudioProjectRecord[];
  models: SavedModelRecord[];
  uploadedImageIds: string[];
  uploadedStoragePaths: string[];
  predictions: SessionPredictionRecord[];
  feedback: SessionFeedbackRecord[];
  modelsTested: string[];
  sessionSettings: {
    confidenceThreshold: number;
  };
  inFlightOps: number;
  createdAt: string;
  expiresAt: string;
  finishedAt?: string;
  updatedAt: string;
}

export interface SessionSummaryRecord {
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
  status: 'completed' | 'expired' | 'reset';
}

export interface CompletedNicknameRecord {
  nicknameId: string;
  nickname: string;
  sessionId: string;
  summaryId: string;
  status: 'completed' | 'expired' | 'reset';
  completedAt: string;
}

export interface SharedModelProposalRecord {
  proposalId: string;
  model: SavedModelRecord;
  submittedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedAt?: string;
}

export interface PlatformState {
  models: SavedModelRecord[];
  sharedModels: SavedModelRecord[];
  projects: StudioProjectRecord[];
  learningQueue: LearningQueueItem[];
  userCorrections: UserCorrectionRecord[];
  sharedFeedback: SharedFeedbackRecord[];
  learningActivity: LearningActivityRecord[];
  systemSettings: SystemSettingsRecord;
  educatorSettings: EducatorSettingsRecord;
  sessions: ParticipantSessionRecord[];
  sessionSummaries: SessionSummaryRecord[];
  completedNicknames: CompletedNicknameRecord[];
  pendingSharedProposals: SharedModelProposalRecord[];
  pendingValidations: number;
  failedUploads: number;
  lastAuditAt: string | null;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STORAGE_DIR = path.join(DATA_DIR, 'storage');
const MANIFEST_PATH = path.join(DATA_DIR, 'dataset-manifest.json');
const STATE_PATH = path.join(DATA_DIR, 'platform-state.json');

const DEFAULT_SETTINGS: SystemSettingsRecord = {
  autonomousEnabled: true,
  autoCollectEnabled: true,
  autoRetrainEnabled: true,
  paused: false,
  maxDailyImages: 30,
  retrainFrequencyHours: 6,
  minConfidenceThreshold: 0.62,
  minImprovementDelta: 0.01,
  lastRunAt: null,
  dailyCollectedCount: 0,
  dailyCollectedDate: new Date().toISOString().slice(0, 10),
  updatedAt: new Date().toISOString(),
};

const DEFAULT_EDUCATOR_SETTINGS: EducatorSettingsRecord = {
  sessionDurationMinutes: 60,
  autoCleanupOnFinish: true,
  retainAnonymousFeedback: true,
  allowSharedModelPromotion: true,
  maxUploadImagesPerSession: 40,
  updatedAt: new Date().toISOString(),
};

const DEFAULT_STATE: PlatformState = {
  models: [],
  sharedModels: [],
  projects: [],
  learningQueue: [],
  userCorrections: [],
  sharedFeedback: [],
  learningActivity: [],
  systemSettings: DEFAULT_SETTINGS,
  educatorSettings: DEFAULT_EDUCATOR_SETTINGS,
  sessions: [],
  sessionSummaries: [],
  completedNicknames: [],
  pendingSharedProposals: [],
  pendingValidations: 0,
  failedUploads: 0,
  lastAuditAt: null,
};

let writeLock: Promise<void> = Promise.resolve();

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export async function ensureDataDirs(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  await fs.mkdir(path.join(STORAGE_DIR, 'session-uploads'), { recursive: true });
  await fs.mkdir(path.join(STORAGE_DIR, 'shared-models'), { recursive: true });
  await fs.mkdir(path.join(STORAGE_DIR, 'shared-learning'), { recursive: true });
  for (const cat of BUILT_IN_CATEGORIES) {
    await fs.mkdir(path.join(STORAGE_DIR, 'built-in-dataset', cat.slug), { recursive: true });
    await fs.mkdir(path.join(STORAGE_DIR, 'thumbnails', cat.slug), { recursive: true });
    await fs.mkdir(path.join(STORAGE_DIR, 'autonomous-learning', cat.slug), { recursive: true });
  }
}

export function getStorageRoot(): string {
  return STORAGE_DIR;
}

export async function purgeSessionWorkspaceFiles(sessionId: string): Promise<void> {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) return;
  const sessionUploadDir = path.resolve(STORAGE_DIR, 'session-uploads', safeId);
  const sessionThumbDir = path.resolve(STORAGE_DIR, 'thumbnails', `session-${safeId}`);
  if (sessionUploadDir.startsWith(STORAGE_DIR + path.sep)) {
    await fs.rm(sessionUploadDir, { recursive: true, force: true }).catch(() => {});
  }
  if (sessionThumbDir.startsWith(STORAGE_DIR + path.sep)) {
    await fs.rm(sessionThumbDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function readManifest(): Promise<ImageRecord[]> {
  await writeLock.catch(() => {});
  try {
    const raw = await fs.readFile(MANIFEST_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function writeManifest(records: ImageRecord[]): Promise<void> {
  writeLock = writeLock.catch(() => {}).then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmpPath = `${MANIFEST_PATH}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(records, null, 2));
    await fs.rename(tmpPath, MANIFEST_PATH);
  });
  await writeLock;
}

export async function readState(): Promise<PlatformState> {
  await writeLock.catch(() => {});
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PlatformState>;
    const legacyModels = Array.isArray(parsed.models) ? parsed.models : [];
    const sharedModels = Array.isArray(parsed.sharedModels)
      ? parsed.sharedModels
      : legacyModels.filter((m) => m.isPublic || m.modelId === 'mdl_builtin_reference').map((m) => ({
          ...m,
          isShared: true,
        }));
    const legacyCorrections = Array.isArray(parsed.userCorrections) ? parsed.userCorrections : [];
    const sharedFeedback = Array.isArray(parsed.sharedFeedback)
      ? parsed.sharedFeedback
      : legacyCorrections.map((c) => ({
          feedbackId: c.correctionId,
          modelId: c.modelId,
          predictedCategory: c.predictedCategory,
          predictedConfidence: c.predictedConfidence,
          isCorrect: c.isCorrect,
          correctedCategory: c.correctedCategory,
          status: c.status,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        }));

    return {
      models: legacyModels,
      sharedModels,
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      learningQueue: Array.isArray(parsed.learningQueue) ? parsed.learningQueue : [],
      userCorrections: legacyCorrections,
      sharedFeedback,
      learningActivity: Array.isArray(parsed.learningActivity) ? parsed.learningActivity : [],
      systemSettings: { ...DEFAULT_SETTINGS, ...(parsed.systemSettings || {}) },
      educatorSettings: { ...DEFAULT_EDUCATOR_SETTINGS, ...(parsed.educatorSettings || {}) },
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      sessionSummaries: Array.isArray(parsed.sessionSummaries) ? parsed.sessionSummaries : [],
      completedNicknames: Array.isArray(parsed.completedNicknames) ? parsed.completedNicknames : [],
      pendingSharedProposals: Array.isArray(parsed.pendingSharedProposals) ? parsed.pendingSharedProposals : [],
      pendingValidations: parsed.pendingValidations ?? 0,
      failedUploads: parsed.failedUploads ?? 0,
      lastAuditAt: parsed.lastAuditAt ?? null,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code && code !== 'ENOENT') {
      throw err;
    }
    const initial = structuredClone(DEFAULT_STATE);
    await seedInitialState(initial);
    return initial;
  }
}

export async function writeState(state: PlatformState): Promise<void> {
  writeLock = writeLock.catch(() => {}).then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmpPath = `${STATE_PATH}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(state, null, 2));
    await fs.rename(tmpPath, STATE_PATH);
  });
  await writeLock;
}

async function seedInitialState(state: PlatformState): Promise<void> {
  const manifest = await readManifest();
  const now = new Date().toISOString();

  if (state.learningActivity.length === 0 && manifest.length > 0) {
    state.learningActivity.push({
      activityId: `act_${crypto.randomUUID().slice(0, 8)}`,
      type: 'collection',
      title: `Validated ${manifest.length} built-in images across ${BUILT_IN_CATEGORIES.length} categories`,
      detail: 'All images passed format decoding, resolution checks, SHA-256 and perceptual dHash deduplication, and reusable license verification.',
      createdAt: now,
    });
  }

  if (state.projects.length === 0 && manifest.length >= 24) {
    const deskSlugs = ['pens', 'pencils', 'cups', 'books'];
    const commuteSlugs = ['cars', 'backpacks', 'watches', 'mobile-phones'];

    const buildExample = (id: string, name: string, desc: string, slugs: string[]): StudioProjectRecord => {
      const categories = slugs.map((slug) => {
        const def = BUILT_IN_CATEGORIES.find((c) => c.slug === slug)!;
        const imgs = manifest.filter((m) => m.categorySlug === slug).slice(0, 10);
        return {
          categoryId: `proj_cat_${slug}`,
          name: def.name,
          slug: def.slug,
          images: imgs.map((m) => ({
            imageId: m.imageId,
            url: m.url,
            thumbnailUrl: m.thumbnailUrl,
            title: m.title,
            sha256: m.sha256,
            source: m.source,
          })),
        };
      });
      return {
        projectId: id,
        name,
        description: desc,
        ownerId: 'system_examples',
        isPublic: true,
        isExample: true,
        categories,
        status: 'ready',
        createdAt: now,
        updatedAt: now,
      };
    };

    state.projects.push(
      buildExample(
        'example_desk_objects',
        'Desk Objects Study',
        'Compare closely related stationery and tabletop items (Pen, Pencil, Cup, Book).',
        deskSlugs,
      ),
      buildExample(
        'example_everyday_carry',
        'Everyday Carry & Transit',
        'Train a classifier across outdoor and personal items (Car, Backpack, Watch, Mobile phone).',
        commuteSlugs,
      ),
    );
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

export function buildSessionSummary(
  session: ParticipantSessionRecord,
  status: 'completed' | 'expired' | 'reset',
): SessionSummaryRecord {
  const startedMs = new Date(session.createdAt).getTime();
  const endedMs = Date.now();
  const durationMinutes = Number(Math.max(0.1, (endedMs - startedMs) / 60000).toFixed(1));
  const customCategoriesCount = session.categories.length;
  const projectImagesCount = session.projects.reduce(
    (sum, p) => sum + p.categories.reduce((cs, c) => cs + c.images.length, 0),
    0,
  );
  const categoryImagesCount = session.categories.reduce((sum, c) => sum + c.images.length, 0);
  const imagesAdded = Math.max(session.uploadedImageIds.length, categoryImagesCount, projectImagesCount);
  const verifiedCorrectCount = session.feedback.filter((f) => f.isCorrect).length;
  const sharedFeedbackCount = session.feedback.filter((f) => f.approvedForShared).length;

  const nickname = (session.nickname || '').trim() || 'Anonymous Participant';

  return {
    summaryId: `sum_${crypto.randomUUID().slice(0, 8)}`,
    sessionId: session.sessionId,
    nickname,
    startedAt: session.createdAt,
    endedAt: new Date(endedMs).toISOString(),
    durationMinutes,
    categoriesCreated: customCategoriesCount,
    imagesAdded,
    modelsTrained: session.models.length,
    modelsTested: session.modelsTested.length,
    predictionsCount: session.predictions.length,
    verifiedCorrectCount,
    feedbackSubmittedCount: session.feedback.length,
    sharedFeedbackCount,
    status,
  };
}

export async function finalizeAndCleanupSession(
  state: PlatformState,
  session: ParticipantSessionRecord,
  finalStatus: 'finished' | 'expired',
  summaryStatus: 'completed' | 'expired' | 'reset',
): Promise<SessionSummaryRecord> {
  const summary = buildSessionSummary(session, summaryStatus);
  const existingSummaryIdx = state.sessionSummaries.findIndex((s) => s.sessionId === session.sessionId);
  if (existingSummaryIdx >= 0) {
    state.sessionSummaries[existingSummaryIdx] = summary;
  } else {
    state.sessionSummaries.unshift(summary);
    state.sessionSummaries = state.sessionSummaries.slice(0, 500);
  }

  // Save participant nickname permanently whenever a session completes
  const nicknameEntry: CompletedNicknameRecord = {
    nicknameId: `nick_${crypto.randomUUID().slice(0, 8)}`,
    nickname: summary.nickname,
    sessionId: session.sessionId,
    summaryId: summary.summaryId,
    status: summary.status,
    completedAt: summary.endedAt,
  };
  const existingNickIdx = state.completedNicknames.findIndex((n) => n.sessionId === session.sessionId);
  if (existingNickIdx >= 0) {
    state.completedNicknames[existingNickIdx] = {
      ...state.completedNicknames[existingNickIdx],
      ...nicknameEntry,
      nicknameId: state.completedNicknames[existingNickIdx].nicknameId,
    };
  } else {
    state.completedNicknames.unshift(nicknameEntry);
    state.completedNicknames = state.completedNicknames.slice(0, 1000);
  }

  // Persist any approved de-identified feedback that wasn't already synced
  if (state.educatorSettings.retainAnonymousFeedback) {
    for (const fb of session.feedback) {
      if (fb.approvedForShared && !fb.sharedFeedbackId) {
        const sharedId = `sfb_${crypto.randomUUID().slice(0, 8)}`;
        fb.sharedFeedbackId = sharedId;
        state.sharedFeedback.unshift({
          feedbackId: sharedId,
          modelId: fb.modelId,
          predictedCategory: fb.predictedLabel,
          predictedConfidence: fb.predictedConfidence,
          isCorrect: fb.isCorrect,
          correctedCategory: fb.correctedCategory,
          status: 'verified',
          createdAt: fb.createdAt,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    state.sharedFeedback = state.sharedFeedback.slice(0, 500);
  }

  if (state.educatorSettings.autoCleanupOnFinish) {
    await purgeSessionWorkspaceFiles(session.sessionId);
  }

  const now = new Date().toISOString();
  session.status = finalStatus;
  session.tokenHash = '';
  session.finishedAt = now;
  session.updatedAt = now;
  // Clear private workspace payload while preserving clean counts in sessionSummaries
  session.categories = [];
  session.projects = [];
  session.models = [];
  session.uploadedImageIds = [];
  session.uploadedStoragePaths = [];
  session.predictions = [];
  session.feedback = [];

  return summary;
}

export async function sweepExpiredSessions(): Promise<number> {
  const state = await readState();
  const nowMs = Date.now();
  let cleaned = 0;

  for (const session of state.sessions) {
    if (session.status !== 'active') continue;
    if (session.inFlightOps > 0) continue;
    const expMs = new Date(session.expiresAt).getTime();
    if (Number.isFinite(expMs) && nowMs > expMs) {
      await finalizeAndCleanupSession(state, session, 'expired', 'expired');
      cleaned++;
    }
  }

  if (cleaned > 0) {
    await writeState(state);
  }
  return cleaned;
}

export async function appendActivity(
  entry: Omit<LearningActivityRecord, 'activityId' | 'createdAt'>,
): Promise<LearningActivityRecord> {
  const state = await readState();
  const full: LearningActivityRecord = {
    ...entry,
    activityId: `act_${crypto.randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
  };
  state.learningActivity.unshift(full);
  state.learningActivity = state.learningActivity.slice(0, 200);
  await writeState(state);
  return full;
}

export async function getCategorySummaries() {
  const manifest = await readManifest();
  return BUILT_IN_CATEGORIES.map((cat) => {
    const items = manifest.filter((img) => img.categorySlug === cat.slug && img.validationStatus === 'validated');
    const builtInCount = items.filter((i) => i.datasetType === 'built-in').length;
    const userCount = items.filter((i) => i.datasetType === 'user').length;
    const autonomousCount = items.filter((i) => i.datasetType === 'autonomous').length;
    const avgQuality =
      items.length > 0
        ? Number((items.reduce((acc, i) => acc + i.qualityScore, 0) / items.length).toFixed(3))
        : 0;
    const totalBytes = items.reduce((acc, i) => acc + (i.sizeBytes || 0), 0);
    return {
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      targetCount: cat.targetCount,
      imageCount: items.length,
      builtInCount,
      userCount,
      autonomousCount,
      averageQuality: avgQuality,
      totalBytes,
      previewImages: items.slice(0, 4).map((i) => ({
        imageId: i.imageId,
        thumbnailUrl: i.thumbnailUrl,
        url: i.url,
        title: i.title,
      })),
    };
  });
}

export async function runDatasetQualityAudit() {
  const manifest = await readManifest();
  const state = await readState();

  const nearDuplicates: Array<{ imageA: string; imageB: string; category: string; distance: number }> = [];
  for (let i = 0; i < manifest.length; i++) {
    for (let j = i + 1; j < manifest.length; j++) {
      if (manifest[i].categorySlug !== manifest[j].categorySlug) continue;
      if (!manifest[i].phash || !manifest[j].phash) continue;
      const dist = hammingDistanceHex(manifest[i].phash, manifest[j].phash);
      if (dist <= 4) {
        nearDuplicates.push({
          imageA: manifest[i].imageId,
          imageB: manifest[j].imageId,
          category: manifest[i].categoryName,
          distance: dist,
        });
      }
    }
  }

  const lowQualityImages = manifest
    .filter((m) => m.qualityScore < 0.35 || m.blurScore < 6.0)
    .slice(0, 20)
    .map((m) => ({
      imageId: m.imageId,
      title: m.title,
      category: m.categoryName,
      qualityScore: m.qualityScore,
      blurScore: m.blurScore,
      thumbnailUrl: m.thumbnailUrl,
    }));

  const categorySummaries = await getCategorySummaries();
  const confusionCounts = new Map<string, number>();
  const allVerifiedFeedback = [
    ...state.sharedFeedback.map((f) => ({
      isCorrect: f.isCorrect,
      predictedCategory: f.predictedCategory,
      correctedCategory: f.correctedCategory,
    })),
    ...state.userCorrections.map((c) => ({
      isCorrect: c.isCorrect,
      predictedCategory: c.predictedCategory,
      correctedCategory: c.correctedCategory,
    })),
  ];

  for (const corr of allVerifiedFeedback) {
    if (!corr.isCorrect && corr.correctedCategory) {
      const key = [corr.predictedCategory, corr.correctedCategory].sort().join(' vs ');
      confusionCounts.set(key, (confusionCounts.get(key) ?? 0) + 1);
    }
  }

  const recommendations: Array<{ category: string; priority: 'high' | 'medium' | 'low'; reason: string }> = [];
  for (const cat of categorySummaries) {
    if (cat.imageCount < cat.targetCount) {
      recommendations.push({
        category: cat.name,
        priority: 'high',
        reason: `Has ${cat.imageCount} of ${cat.targetCount} target images. Collecting ${cat.targetCount - cat.imageCount} more examples improves class balance.`,
      });
    } else if (cat.averageQuality < 0.55) {
      recommendations.push({
        category: cat.name,
        priority: 'medium',
        reason: `Average visual contrast/sharpness score is ${(cat.averageQuality * 100).toFixed(0)}%. Adding crisp, well-lit examples will sharpen feature embeddings.`,
      });
    }
  }

  for (const [pair, count] of confusionCounts.entries()) {
    recommendations.unshift({
      category: pair,
      priority: 'high',
      reason: `Detected ${count} participant-verified confusion event(s) between ${pair}. Add diverse close-up angles distinguishing their visual silhouettes.`,
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      category: 'Pen vs Pencil',
      priority: 'low',
      reason: 'Dataset is balanced across all 12 categories. Adding varied lighting angles for slender objects (Pen, Pencil) further reduces edge-case ambiguity.',
    });
  }

  return {
    totalScanned: manifest.length,
    nearDuplicateCount: nearDuplicates.length,
    nearDuplicates: nearDuplicates.slice(0, 12),
    lowQualityCount: lowQualityImages.length,
    lowQualityImages,
    confusionPairs: Array.from(confusionCounts.entries()).map(([pair, count]) => ({ pair, count })),
    recommendations: recommendations.slice(0, 8),
    auditedAt: new Date().toISOString(),
  };
}
