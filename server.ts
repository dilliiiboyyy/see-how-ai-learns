import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { z } from 'zod';
import { GoogleGenAI } from '@google/genai';
import { BUILT_IN_CATEGORIES } from './server/categories.ts';
import { validateAndProcessImage, hammingDistanceHex } from './server/imageValidator.ts';
import {
  ensureDataDirs,
  getStorageRoot,
  readManifest,
  writeManifest,
  readState,
  writeState,
  appendActivity,
  getCategorySummaries,
  runDatasetQualityAudit,
  hashSessionToken,
  buildSessionSummary,
  finalizeAndCleanupSession,
  sweepExpiredSessions,
  type ImageRecord,
  type ParticipantSessionRecord,
  type PlatformState,
  type SavedModelRecord,
  type SavedModelVersion,
} from './server/store.ts';
import { runAutonomousCycle, startAutonomousScheduler } from './server/autonomousWorker.ts';

const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = 'dilshaanmuhvp@gmail.com';
const app = express();
app.use(express.json({ limit: '15mb' }));

// Cached Firebase config for server-side ID token verification
let cachedFirebaseConfig: { apiKey: string; projectId: string; firestoreDatabaseId: string; storageBucket: string } | null = null;
async function getFirebaseConfig() {
  if (cachedFirebaseConfig) return cachedFirebaseConfig;
  try {
    const raw = await fs.readFile(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    cachedFirebaseConfig = {
      apiKey: parsed.apiKey || '',
      projectId: parsed.projectId || 'midyear-retina-mmln4',
      firestoreDatabaseId: parsed.firestoreDatabaseId || '',
      storageBucket: parsed.storageBucket || 'midyear-retina-mmln4.firebasestorage.app',
    };
    return cachedFirebaseConfig;
  } catch {
    return {
      apiKey: '',
      projectId: 'midyear-retina-mmln4',
      firestoreDatabaseId: '',
      storageBucket: 'midyear-retina-mmln4.firebasestorage.app',
    };
  }
}

// Per-session file HMAC helper so session-uploaded images only resolve while session is active
function signSessionAsset(sessionId: string, tokenHash: string): string {
  return crypto.createHmac('sha256', tokenHash).update(sessionId).digest('hex').slice(0, 24);
}

// Simple sliding-window rate limiter
const rateBuckets = new Map<string, number[]>();
function rateLimit(maxRequests: number, windowMs: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || 'local';
    const key = `${req.path}:${ip}`;
    const now = Date.now();
    const history = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
    if (history.length >= maxRequests) {
      res.status(429).json({ error: 'Rate limit exceeded. Please pause briefly and try again.' });
      return;
    }
    history.push(now);
    rateBuckets.set(key, history);
    next();
  };
}

// Multer configuration for safe image uploads (max 10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are supported.'));
    }
  },
});

async function verifySessionFromHeaders(
  req: express.Request,
  state: PlatformState,
): Promise<{ session: ParticipantSessionRecord | null; error?: string; status?: number }> {
  const sessionId = String(req.header('x-session-id') || '').trim();
  const rawToken = String(req.header('x-session-token') || '').trim();
  if (!sessionId || !rawToken) {
    return { session: null, error: 'Active participant session required.', status: 401 };
  }
  const session = state.sessions.find((s) => s.sessionId === sessionId);
  if (!session || session.status !== 'active' || !session.tokenHash) {
    return { session: null, error: 'Session is invalid or has already ended.', status: 401 };
  }
  const incomingHash = hashSessionToken(rawToken);
  if (incomingHash !== session.tokenHash) {
    return { session: null, error: 'Session authorization token mismatch.', status: 403 };
  }
  if (Date.now() > new Date(session.expiresAt).getTime()) {
    await finalizeAndCleanupSession(state, session, 'expired', 'expired');
    await writeState(state);
    return { session: null, error: 'Session has expired. Please start a fresh session.', status: 401 };
  }
  return { session };
}

async function verifyAdminRequest(req: express.Request): Promise<{ ok: boolean; email?: string; error?: string; status: number }> {
  const authHeader = String(req.header('authorization') || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!idToken) {
    return { ok: false, error: 'Educator authentication required.', status: 401 };
  }
  const cfg = await getFirebaseConfig();
  if (!cfg.apiKey) {
    return { ok: false, error: 'Firebase API key not configured.', status: 500 };
  }
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) {
      return { ok: false, error: 'Invalid or expired educator credentials.', status: 401 };
    }
    const data = (await res.json()) as {
      users?: Array<{ email?: string; emailVerified?: boolean }>;
    };
    const u = data.users?.[0];
    if (!u || !u.emailVerified || u.email?.toLowerCase() !== ADMIN_EMAIL) {
      return { ok: false, error: 'Access restricted to verified platform educators.', status: 403 };
    }
    return { ok: true, email: u.email, status: 200 };
  } catch {
    return { ok: false, error: 'Failed to verify educator token.', status: 401 };
  }
}

let cachedStorageCheck: { checkedAt: number; bucketExists: boolean; bucketName: string; detail: string } | null = null;
async function checkFirebaseStorageBucket() {
  if (cachedStorageCheck && Date.now() - cachedStorageCheck.checkedAt < 5 * 60 * 1000) {
    return cachedStorageCheck;
  }
  const cfg = await getFirebaseConfig();
  const bucketName = cfg.storageBucket;
  try {
    const res = await fetch(`https://firebasestorage.googleapis.com/v0/b/${bucketName}/o?maxResults=1`);
    const bucketExists = res.status !== 404;
    cachedStorageCheck = {
      checkedAt: Date.now(),
      bucketExists,
      bucketName,
      detail: bucketExists
        ? 'Firebase Cloud Storage bucket is active.'
        : 'Cloud Storage bucket is not yet enabled in Firebase Console; local persistent mirror is active with identical storage hierarchy.',
    };
  } catch {
    cachedStorageCheck = {
      checkedAt: Date.now(),
      bucketExists: false,
      bucketName,
      detail: 'Unable to reach Cloud Storage endpoint; local persistent mirror is active.',
    };
  }
  return cachedStorageCheck;
}

// Safe static serving for stored images & thumbnails with strict session-upload isolation
app.get(/^\/api\/storage\/(.+)$/, async (req, res) => {
  try {
    const relPath = decodeURIComponent(req.params[0] || '');
    const storageRoot = getStorageRoot();
    const resolved = path.resolve(storageRoot, relPath);
    if (!resolved.startsWith(storageRoot + path.sep)) {
      res.status(403).json({ error: 'Invalid storage path' });
      return;
    }

    // Enforce isolation on private session uploads and private session thumbnails
    let sessionMatch = relPath.match(/^session-uploads\/([^/]+)\//);
    if (!sessionMatch) {
      sessionMatch = relPath.match(/^thumbnails\/session-([^/]+)\//);
    }
    if (sessionMatch) {
      const targetSessionId = sessionMatch[1];
      const state = await readState();
      const session = state.sessions.find((s) => s.sessionId === targetSessionId);
      if (!session || session.status !== 'active' || !session.tokenHash) {
        res.status(403).json({ error: 'Session media is no longer active.' });
        return;
      }
      const sig = typeof req.query.sig === 'string' ? req.query.sig : '';
      const headerToken = String(req.header('x-session-token') || '');
      const validSig = sig && sig === signSessionAsset(targetSessionId, session.tokenHash);
      const validHeader = headerToken && hashSessionToken(headerToken) === session.tokenHash;
      if (!validSig && !validHeader) {
        res.status(403).json({ error: 'Unauthorized session media access.' });
        return;
      }
    }

    const data = await fs.readFile(resolved);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', sessionMatch ? 'private, no-store' : 'public, max-age=86400');
    res.send(data);
  } catch {
    res.status(404).json({ error: 'Image not found' });
  }
});

app.get('/api/health', async (_req, res) => {
  const manifest = await readManifest();
  res.json({ ok: true, datasetCount: manifest.length, timestamp: new Date().toISOString() });
});

app.get('/api/firebase/status', async (_req, res) => {
  const [manifest, state, categories, storageInfo, cfg] = await Promise.all([
    readManifest(),
    readState(),
    getCategorySummaries(),
    checkFirebaseStorageBucket(),
    getFirebaseConfig(),
  ]);

  const builtInCount = manifest.filter((i) => i.datasetType === 'built-in').length;
  const userCount = manifest.filter((i) => i.datasetType === 'user').length;
  const autonomousCount = manifest.filter((i) => i.datasetType === 'autonomous').length;
  const totalBytes = manifest.reduce((acc, i) => acc + (i.sizeBytes || 0), 0);

  res.json({
    projectId: cfg.projectId,
    firestoreDatabaseId: cfg.firestoreDatabaseId,
    storageBucket: storageInfo.bucketName,
    storageBucketEnabled: storageInfo.bucketExists,
    storageDetail: storageInfo.detail,
    totalImages: manifest.length,
    builtInCount,
    userCount,
    autonomousCount,
    pendingValidation: state.pendingValidations + state.learningQueue.filter((q) => q.status === 'pending').length,
    failedUploads: state.failedUploads,
    storageUsageBytes: totalBytes,
    storageUsageMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
    categories,
    modelsCount: state.sharedModels.length,
    projectsCount: state.projects.filter((p) => p.isPublic || p.isExample).length,
    activeSessionsCount: state.sessions.filter((s) => s.status === 'active').length,
  });
});

// ==================== PARTICIPANT SESSION API ====================

app.post('/api/sessions/start', rateLimit(30, 60_000), async (req, res) => {
  const schema = z.object({
    nickname: z.string().max(48).optional(),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid participant details.' });
    return;
  }

  await sweepExpiredSessions();
  const state = await readState();
  const nowMs = Date.now();
  const createdAt = new Date(nowMs).toISOString();
  const durationMinutes = state.educatorSettings.sessionDurationMinutes || 60;
  const expiresAt = new Date(nowMs + durationMinutes * 60 * 1000).toISOString();
  const sessionId = `sess_${crypto.randomUUID().slice(0, 10)}`;
  const rawToken = crypto.randomBytes(24).toString('hex');
  const tokenHash = hashSessionToken(rawToken);

  const nickname = (parsed.data.nickname || '').trim().slice(0, 48);

  const storageRoot = getStorageRoot();
  await fs.mkdir(path.join(storageRoot, 'session-uploads', sessionId), { recursive: true });

  const newSession: ParticipantSessionRecord = {
    sessionId,
    tokenHash,
    nickname,
    status: 'active',
    categories: [
      { categoryId: 'cat_1', name: 'Pen', slug: 'pens', images: [] },
      { categoryId: 'cat_2', name: 'Cup', slug: 'cups', images: [] },
    ],
    projects: [],
    models: [],
    uploadedImageIds: [],
    uploadedStoragePaths: [],
    predictions: [],
    feedback: [],
    modelsTested: [],
    sessionSettings: {
      confidenceThreshold: state.systemSettings.minConfidenceThreshold || 0.62,
    },
    inFlightOps: 0,
    createdAt,
    expiresAt,
    updatedAt: createdAt,
  };

  state.sessions.unshift(newSession);
  // Keep history bounded cleanly
  state.sessions = state.sessions.slice(0, 300);
  await writeState(state);

  res.status(201).json({
    sessionToken: rawToken,
    session: {
      sessionId: newSession.sessionId,
      nickname: newSession.nickname,
      status: newSession.status,
      categories: newSession.categories,
      projects: newSession.projects,
      models: newSession.models,
      predictionsCount: 0,
      feedbackCount: 0,
      verifiedCorrectCount: 0,
      modelsTested: [],
      sessionSettings: newSession.sessionSettings,
      createdAt: newSession.createdAt,
      expiresAt: newSession.expiresAt,
    },
    educatorSettings: state.educatorSettings,
  });
});

app.get('/api/sessions/current', async (req, res) => {
  const state = await readState();
  const authCheck = await verifySessionFromHeaders(req, state);
  if (!authCheck.session) {
    res.status(authCheck.status || 401).json({ error: authCheck.error });
    return;
  }
  const s = authCheck.session;
  res.json({
    session: {
      sessionId: s.sessionId,
      nickname: s.nickname,
      status: s.status,
      categories: s.categories,
      projects: s.projects,
      models: s.models,
      predictionsCount: s.predictions.length,
      feedbackCount: s.feedback.length,
      verifiedCorrectCount: s.feedback.filter((f) => f.isCorrect).length,
      modelsTested: s.modelsTested,
      sessionSettings: s.sessionSettings,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    },
    educatorSettings: state.educatorSettings,
  });
});

app.patch('/api/sessions/workspace', async (req, res) => {
  const state = await readState();
  const authCheck = await verifySessionFromHeaders(req, state);
  if (!authCheck.session) {
    res.status(authCheck.status || 401).json({ error: authCheck.error });
    return;
  }

  const schema = z.object({
    categories: z
      .array(
        z.object({
          categoryId: z.string().min(1).max(128),
          name: z.string().min(1).max(80),
          slug: z.string().min(1).max(80),
          images: z.array(
            z.object({
              imageId: z.string(),
              url: z.string(),
              thumbnailUrl: z.string(),
              title: z.string(),
              sha256: z.string().optional(),
              source: z.string().optional(),
            }),
          ),
        }),
      )
      .optional(),
    project: z
      .object({
        projectId: z.string().min(1).max(128),
        name: z.string().min(1).max(120),
        description: z.string().max(500).optional(),
        categories: z.array(z.any()),
        status: z.enum(['draft', 'ready', 'trained']).optional(),
        activeModelId: z.string().optional(),
      })
      .optional(),
    sessionSettings: z
      .object({
        confidenceThreshold: z.number().min(0.3).max(0.95).optional(),
      })
      .optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid session workspace update.' });
    return;
  }

  const s = authCheck.session;
  s.inFlightOps += 1;
  try {
    if (parsed.data.categories) {
      s.categories = parsed.data.categories;
    }
    if (parsed.data.project) {
      const p = parsed.data.project;
      const now = new Date().toISOString();
      const idx = s.projects.findIndex((x) => x.projectId === p.projectId);
      const record = {
        projectId: p.projectId,
        name: p.name,
        description: p.description || '',
        ownerId: s.sessionId,
        isPublic: false,
        categories: p.categories,
        status: p.status || 'ready',
        activeModelId: p.activeModelId,
        createdAt: idx >= 0 ? s.projects[idx].createdAt : now,
        updatedAt: now,
      };
      if (idx >= 0) s.projects[idx] = record;
      else s.projects.unshift(record);
    }
    if (parsed.data.sessionSettings?.confidenceThreshold !== undefined) {
      s.sessionSettings.confidenceThreshold = parsed.data.sessionSettings.confidenceThreshold;
    }
    s.updatedAt = new Date().toISOString();
  } finally {
    s.inFlightOps = Math.max(0, s.inFlightOps - 1);
  }
  await writeState(state);
  res.json({ ok: true, updatedAt: s.updatedAt });
});

app.post('/api/sessions/upload', rateLimit(50, 60_000), upload.single('image'), async (req, res) => {
  const initialState = await readState();
  const authCheck = await verifySessionFromHeaders(req, initialState);
  if (!authCheck.session) {
    res.status(authCheck.status || 401).json({ error: authCheck.error });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: 'No image file provided.' });
    return;
  }

  const targetSessionId = authCheck.session.sessionId;
  if (authCheck.session.uploadedImageIds.length >= initialState.educatorSettings.maxUploadImagesPerSession) {
    res.status(429).json({
      error: `Session upload limit (${initialState.educatorSettings.maxUploadImagesPerSession} images) reached.`,
    });
    return;
  }

  // Mark in-flight operation so Finish Session waits cleanly before wiping files
  authCheck.session.inFlightOps += 1;
  await writeState(initialState);

  try {
    const categorySlugInput = String(req.body.categorySlug || 'custom').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const categoryName = String(req.body.categoryName || categorySlugInput).trim().slice(0, 80);
    const title = String(req.body.title || req.file.originalname || 'Session Upload')
      .replace(/\.[^.]+$/, '')
      .slice(0, 110);

    const validated = await validateAndProcessImage(req.file.buffer);
    if (!validated.valid) {
      const s2 = await readState();
      s2.failedUploads += 1;
      await writeState(s2);
      res.status(422).json({ error: validated.reason || 'Image failed quality validation.' });
      return;
    }

    const state = await readState();
    const session = state.sessions.find((x) => x.sessionId === targetSessionId);
    if (!session || session.status !== 'active') {
      res.status(409).json({ error: 'Session closed while uploading.' });
      return;
    }

    // Deduplicate within THIS session's own workspace only (no cross-session leakage)
    const sessionShaSet = new Set(
      session.categories.flatMap((c) => c.images.map((i) => i.sha256).filter(Boolean) as string[]),
    );
    if (sessionShaSet.has(validated.sha256)) {
      res.status(409).json({ error: 'Duplicate image already exists in this session.' });
      return;
    }

    const imageId = `img_sess_${crypto.randomUUID().slice(0, 10)}`;
    const storageRoot = getStorageRoot();
    const storagePath = `session-uploads/${session.sessionId}/${categorySlugInput}/${imageId}.jpg`;
    const thumbnailPath = `thumbnails/session-${session.sessionId}/${imageId}.jpg`;

    await fs.mkdir(path.dirname(path.join(storageRoot, storagePath)), { recursive: true });
    await fs.mkdir(path.dirname(path.join(storageRoot, thumbnailPath)), { recursive: true });
    await fs.writeFile(path.join(storageRoot, storagePath), validated.normalizedBuffer);
    await fs.writeFile(path.join(storageRoot, thumbnailPath), validated.thumbnailBuffer);

    const sig = signSessionAsset(session.sessionId, session.tokenHash);
    const now = new Date().toISOString();

    session.uploadedImageIds.push(imageId);
    session.uploadedStoragePaths.push(storagePath, thumbnailPath);
    session.updatedAt = now;
    await writeState(state);

    res.status(201).json({
      image: {
        imageId,
        categorySlug: categorySlugInput,
        categoryName,
        title,
        storagePath,
        thumbnailPath,
        url: `/api/storage/${storagePath}?sig=${sig}`,
        thumbnailUrl: `/api/storage/${thumbnailPath}?sig=${sig}`,
        width: validated.width,
        height: validated.height,
        sizeBytes: validated.sizeBytes,
        sha256: validated.sha256,
        qualityScore: validated.qualityScore,
        blurScore: validated.blurScore,
        validationStatus: 'validated',
        createdAt: now,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Session upload failed' });
  } finally {
    const sFin = await readState();
    const sess = sFin.sessions.find((x) => x.sessionId === targetSessionId);
    if (sess) {
      sess.inFlightOps = Math.max(0, sess.inFlightOps - 1);
      await writeState(sFin);
    }
  }
});

app.post('/api/sessions/models', async (req, res) => {
  const state = await readState();
  const authCheck = await verifySessionFromHeaders(req, state);
  if (!authCheck.session) {
    res.status(authCheck.status || 401).json({ error: authCheck.error });
    return;
  }

  const schema = z.object({
    modelId: z.string().min(1).max(128).optional(),
    name: z.string().min(1).max(120),
    description: z.string().max(400).optional(),
    projectId: z.string().min(1).max(128),
    categories: z.array(z.string()).min(1).max(24),
    datasetSize: z.number().int().min(1),
    accuracy: z.number().min(0).max(1),
    valAccuracy: z.number().min(0).max(1),
    testAccuracy: z.number().min(0).max(1),
    precision: z.number().min(0).max(1),
    recall: z.number().min(0).max(1),
    latencyMs: z.number().min(0),
    confusionMatrix: z.array(z.array(z.number())).optional(),
    classMetrics: z
      .array(
        z.object({
          label: z.string(),
          precision: z.number(),
          recall: z.number(),
          support: z.number(),
        }),
      )
      .optional(),
    epochHistory: z
      .array(
        z.object({
          epoch: z.number(),
          trainAcc: z.number(),
          valAcc: z.number(),
          loss: z.number(),
        }),
      )
      .optional(),
    serializedModelJson: z.string().max(4_000_000).optional(),
    proposeForShared: z.boolean().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid model payload' });
    return;
  }

  const d = parsed.data;
  const s = authCheck.session;
  s.inFlightOps += 1;
  const now = new Date().toISOString();

  try {
    const existing = d.modelId ? s.models.find((m) => m.modelId === d.modelId) : undefined;
    let savedModel: SavedModelRecord;

    if (!existing) {
      const modelId = d.modelId || `smdl_${crypto.randomUUID().slice(0, 8)}`;
      const version: SavedModelVersion = {
        versionId: `ver_${crypto.randomUUID().slice(0, 8)}`,
        modelId,
        version: 1,
        accuracy: d.accuracy,
        valAccuracy: d.valAccuracy,
        testAccuracy: d.testAccuracy,
        precision: d.precision,
        recall: d.recall,
        latencyMs: d.latencyMs,
        datasetSize: d.datasetSize,
        isDeployed: true,
        trigger: 'manual',
        confusionMatrix: d.confusionMatrix,
        classMetrics: d.classMetrics,
        epochHistory: d.epochHistory,
        serializedModelJson: d.serializedModelJson,
        createdAt: now,
      };
      savedModel = {
        modelId,
        name: d.name,
        description: d.description || `Session classifier over ${d.categories.join(', ')}`,
        ownerId: s.sessionId,
        projectId: d.projectId,
        isPublic: false,
        isShared: false,
        categories: d.categories,
        datasetSize: d.datasetSize,
        latestVersion: 1,
        activeVersion: 1,
        accuracy: d.testAccuracy,
        precision: d.precision,
        recall: d.recall,
        latencyMs: d.latencyMs,
        status: 'ready',
        versions: [version],
        createdAt: now,
        updatedAt: now,
      };
      s.models.unshift(savedModel);
    } else {
      const nextVer = existing.latestVersion + 1;
      for (const v of existing.versions) v.isDeployed = false;
      existing.versions.unshift({
        versionId: `ver_${crypto.randomUUID().slice(0, 8)}`,
        modelId: existing.modelId,
        version: nextVer,
        accuracy: d.accuracy,
        valAccuracy: d.valAccuracy,
        testAccuracy: d.testAccuracy,
        precision: d.precision,
        recall: d.recall,
        latencyMs: d.latencyMs,
        datasetSize: d.datasetSize,
        isDeployed: true,
        trigger: 'manual',
        confusionMatrix: d.confusionMatrix,
        classMetrics: d.classMetrics,
        epochHistory: d.epochHistory,
        serializedModelJson: d.serializedModelJson,
        createdAt: now,
      });
      existing.latestVersion = nextVer;
      existing.activeVersion = nextVer;
      existing.accuracy = d.testAccuracy;
      existing.precision = d.precision;
      existing.recall = d.recall;
      existing.latencyMs = d.latencyMs;
      existing.datasetSize = d.datasetSize;
      existing.categories = d.categories;
      existing.updatedAt = now;
      savedModel = existing;
    }

    // Optional evaluated proposal to Shared Model Library (never overwrites existing shared models!)
    let proposalStatus: 'not_requested' | 'submitted' | 'below_threshold' | 'disabled' = 'not_requested';
    if (d.proposeForShared) {
      if (!state.educatorSettings.allowSharedModelPromotion) {
        proposalStatus = 'disabled';
      } else if (d.testAccuracy < 0.65 || d.datasetSize < 6) {
        proposalStatus = 'below_threshold';
      } else {
        const cleanSharedCandidate: SavedModelRecord = {
          ...structuredClone(savedModel),
          modelId: `shared_${crypto.randomUUID().slice(0, 8)}`,
          ownerId: 'shared_library',
          projectId: 'shared_curated',
          isPublic: true,
          isShared: true,
          description: `${savedModel.description} (Evaluated candidate)`,
        };
        state.pendingSharedProposals.unshift({
          proposalId: `prop_${crypto.randomUUID().slice(0, 8)}`,
          model: cleanSharedCandidate,
          submittedAt: now,
          status: 'pending',
        });
        state.pendingSharedProposals = state.pendingSharedProposals.slice(0, 100);
        proposalStatus = 'submitted';
      }
    }

    s.updatedAt = now;
    await writeState(state);
    res.status(201).json({ model: savedModel, proposalStatus });
  } finally {
    s.inFlightOps = Math.max(0, s.inFlightOps - 1);
    await writeState(state);
  }
});

app.post('/api/sessions/predictions', async (req, res) => {
  const state = await readState();
  const authCheck = await verifySessionFromHeaders(req, state);
  if (!authCheck.session) {
    res.status(authCheck.status || 401).json({ error: authCheck.error });
    return;
  }

  const schema = z.object({
    modelId: z.string().min(1).max(128),
    modelName: z.string().min(1).max(120),
    predictedLabel: z.string().min(1).max(80),
    confidence: z.number().min(0).max(1),
    isUnknown: z.boolean(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid prediction log.' });
    return;
  }

  const s = authCheck.session;
  const now = new Date().toISOString();
  s.predictions.unshift({
    predictionId: `pred_${crypto.randomUUID().slice(0, 8)}`,
    ...parsed.data,
    createdAt: now,
  });
  s.predictions = s.predictions.slice(0, 200);
  if (!s.modelsTested.includes(parsed.data.modelName)) {
    s.modelsTested.push(parsed.data.modelName);
  }
  s.updatedAt = now;
  await writeState(state);
  res.status(201).json({ predictionsCount: s.predictions.length, modelsTested: s.modelsTested });
});

app.post('/api/sessions/feedback', async (req, res) => {
  const state = await readState();
  const authCheck = await verifySessionFromHeaders(req, state);
  if (!authCheck.session) {
    res.status(authCheck.status || 401).json({ error: authCheck.error });
    return;
  }

  const schema = z.object({
    modelId: z.string().min(1).max(128),
    predictedLabel: z.string().min(1).max(80),
    predictedConfidence: z.number().min(0).max(1),
    isCorrect: z.boolean(),
    correctedCategory: z.string().max(80).optional(),
    approveForShared: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid feedback payload.' });
    return;
  }

  const d = parsed.data;
  const s = authCheck.session;
  const now = new Date().toISOString();
  const approvedForShared = Boolean(d.approveForShared ?? true) && state.educatorSettings.retainAnonymousFeedback;
  let sharedFeedbackId: string | undefined;

  if (approvedForShared) {
    sharedFeedbackId = `sfb_${crypto.randomUUID().slice(0, 8)}`;
    // Strictly de-identified: no sessionId or nickname stored
    state.sharedFeedback.unshift({
      feedbackId: sharedFeedbackId,
      modelId: d.modelId,
      predictedCategory: d.predictedLabel,
      predictedConfidence: d.predictedConfidence,
      isCorrect: d.isCorrect,
      correctedCategory: d.correctedCategory,
      status: 'verified',
      createdAt: now,
      updatedAt: now,
    });
    state.sharedFeedback = state.sharedFeedback.slice(0, 500);

    if (!d.isCorrect && d.correctedCategory) {
      const pairCount = state.sharedFeedback.filter(
        (c) =>
          !c.isCorrect &&
          ((c.predictedCategory === d.predictedLabel && c.correctedCategory === d.correctedCategory) ||
            (c.predictedCategory === d.correctedCategory && c.correctedCategory === d.predictedLabel)),
      ).length;

      state.learningActivity.unshift({
        activityId: `act_${crypto.randomUUID().slice(0, 8)}`,
        type: pairCount >= 2 ? 'confusion' : 'correction',
        title:
          pairCount >= 2
            ? `Detected confusion between ${d.predictedLabel} and ${d.correctedCategory}`
            : `Recorded de-identified correction: ${d.predictedLabel} → ${d.correctedCategory}`,
        detail: `Verified feedback (${(d.predictedConfidence * 100).toFixed(0)}% confidence) saved to shared learning memory without session identity.`,
        categorySlug: d.correctedCategory.toLowerCase().replace(/\s+/g, '-'),
        modelId: d.modelId,
        createdAt: now,
      });
    } else if (d.isCorrect) {
      state.learningActivity.unshift({
        activityId: `act_${crypto.randomUUID().slice(0, 8)}`,
        type: 'correction',
        title: `Confirmed prediction for ${d.predictedLabel}`,
        detail: `De-identified verification recorded at ${(d.predictedConfidence * 100).toFixed(0)}% confidence.`,
        modelId: d.modelId,
        createdAt: now,
      });
    }
    state.learningActivity = state.learningActivity.slice(0, 200);
  }

  const fbRecord = {
    feedbackId: `fb_${crypto.randomUUID().slice(0, 8)}`,
    modelId: d.modelId,
    predictedLabel: d.predictedLabel,
    predictedConfidence: d.predictedConfidence,
    isCorrect: d.isCorrect,
    correctedCategory: d.correctedCategory,
    approvedForShared,
    sharedFeedbackId,
    createdAt: now,
  };
  s.feedback.unshift(fbRecord);
  s.updatedAt = now;
  await writeState(state);

  res.status(201).json({ feedback: fbRecord, sharedFeedbackSaved: Boolean(sharedFeedbackId) });
});

app.get('/api/sessions/summary', async (req, res) => {
  const state = await readState();
  const authCheck = await verifySessionFromHeaders(req, state);
  if (!authCheck.session) {
    res.status(authCheck.status || 401).json({ error: authCheck.error });
    return;
  }
  const s = authCheck.session;
  const summary = buildSessionSummary(s, 'completed');

  const takeaways: string[] = [];
  if (summary.imagesAdded > 0) {
    takeaways.push(`Curated and validated ${summary.imagesAdded} training examples across ${summary.categoriesCreated} object categories.`);
  }
  if (summary.modelsTrained > 0) {
    const best = Math.max(...s.models.map((m) => m.accuracy));
    takeaways.push(`Trained ${summary.modelsTrained} custom vision model(s) reaching up to ${(best * 100).toFixed(1)}% held-out test accuracy.`);
  }
  if (summary.predictionsCount > 0) {
    takeaways.push(`Tested ${Math.max(1, summary.modelsTested)} model(s) across ${summary.predictionsCount} live recognition runs.`);
  }
  if (summary.sharedFeedbackCount > 0) {
    takeaways.push(`Contributed ${summary.sharedFeedbackCount} de-identified verification(s) to improve shared AI learning.`);
  }
  if (takeaways.length === 0) {
    takeaways.push('Explored the platform workspace and ready for the next session.');
  }

  res.json({ summary, takeaways });
});

app.post('/api/sessions/finish', async (req, res) => {
  let state = await readState();
  const authCheck = await verifySessionFromHeaders(req, state);
  if (!authCheck.session) {
    // Allow graceful finish even if just expired
    res.status(authCheck.status || 401).json({ error: authCheck.error });
    return;
  }

  const targetSessionId = authCheck.session.sessionId;
  // Wait briefly if any upload or save operation is currently in-flight
  for (let i = 0; i < 15; i++) {
    state = await readState();
    const sCheck = state.sessions.find((x) => x.sessionId === targetSessionId);
    if (!sCheck || sCheck.inFlightOps <= 0) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  state = await readState();
  const session = state.sessions.find((x) => x.sessionId === targetSessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }

  const summary = await finalizeAndCleanupSession(state, session, 'finished', 'completed');
  await writeState(state);

  res.json({
    ok: true,
    summary,
    cleanedUp: state.educatorSettings.autoCleanupOnFinish,
    sharedFeedbackRetained: state.educatorSettings.retainAnonymousFeedback,
  });
});

// ==================== DATASET & EXPLORE API ====================

app.get('/api/dataset/categories', async (_req, res) => {
  const summaries = await getCategorySummaries();
  res.json({ categories: summaries });
});

app.get('/api/dataset/images', async (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category.trim().toLowerCase() : '';
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  const datasetType = typeof req.query.datasetType === 'string' ? req.query.datasetType.trim() : '';
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 24)));

  let items = await readManifest();
  items = items.filter((i) => i.validationStatus === 'validated');

  if (category && category !== 'all') {
    items = items.filter((i) => i.categorySlug === category || i.categoryName.toLowerCase() === category);
  }
  if (datasetType && datasetType !== 'all') {
    items = items.filter((i) => i.datasetType === datasetType);
  }
  if (search) {
    items = items.filter(
      (i) =>
        i.title.toLowerCase().includes(search) ||
        i.categoryName.toLowerCase().includes(search) ||
        i.source.toLowerCase().includes(search) ||
        i.license.toLowerCase().includes(search),
    );
  }

  const total = items.length;
  const start = (page - 1) * limit;
  const paged = items.slice(start, start + limit);

  res.json({
    images: paged,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

app.post('/api/dataset/upload', rateLimit(40, 60_000), upload.single('image'), async (req, res) => {
  // Require verified Educator or valid active session when contributing shared Explore examples;
  // session-isolated Studio uploads go through /api/sessions/upload
  const state = await readState();
  const admin = await verifyAdminRequest(req);
  const sess = await verifySessionFromHeaders(req, state);
  if (!admin.ok && !sess.session) {
    res.status(401).json({ error: 'Start a participant session or sign in as an educator to upload images.' });
    return;
  }

  try {
    if (!req.file) {
      res.status(400).json({ error: 'No image file provided.' });
      return;
    }

    const categorySlugInput = String(req.body.categorySlug || 'custom').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const categoryName = String(req.body.categoryName || categorySlugInput).trim().slice(0, 80);
    const title = String(req.body.title || req.file.originalname || 'Uploaded Object')
      .replace(/\.[^.]+$/, '')
      .slice(0, 110);

    const validated = await validateAndProcessImage(req.file.buffer);
    if (!validated.valid) {
      state.failedUploads += 1;
      await writeState(state);
      res.status(422).json({ error: validated.reason || 'Image failed quality validation.' });
      return;
    }

    const manifest = await readManifest();
    const isExactDup = manifest.some((m) => m.sha256 === validated.sha256 && m.categorySlug === categorySlugInput);
    const isNearDup = manifest.some(
      (m) => m.categorySlug === categorySlugInput && m.phash && hammingDistanceHex(m.phash, validated.phash) <= 3,
    );

    if (isExactDup || isNearDup) {
      await appendActivity({
        type: 'dedup',
        title: `Blocked duplicate upload in ${categoryName}`,
        detail: `Perceptual dHash and SHA-256 verification prevented duplicate training sample "${title}".`,
        categorySlug: categorySlugInput,
      });
      res.status(409).json({ error: 'Duplicate or near-identical image already exists in this category.' });
      return;
    }

    const imageId = `img_usr_${crypto.randomUUID().slice(0, 10)}`;
    const storageRoot = getStorageRoot();
    const storagePath = `shared-learning/${categorySlugInput}/${imageId}.jpg`;
    const thumbnailPath = `thumbnails/${categorySlugInput}/${imageId}.jpg`;

    await fs.mkdir(path.dirname(path.join(storageRoot, storagePath)), { recursive: true });
    await fs.mkdir(path.dirname(path.join(storageRoot, thumbnailPath)), { recursive: true });
    await fs.writeFile(path.join(storageRoot, storagePath), validated.normalizedBuffer);
    await fs.writeFile(path.join(storageRoot, thumbnailPath), validated.thumbnailBuffer);

    const catDef = BUILT_IN_CATEGORIES.find((c) => c.slug === categorySlugInput);
    const now = new Date().toISOString();
    const record: ImageRecord = {
      imageId,
      categoryId: catDef?.id || `cat_${categorySlugInput}`,
      categorySlug: categorySlugInput,
      categoryName: catDef?.name || categoryName,
      title,
      storagePath,
      thumbnailPath,
      url: `/api/storage/${storagePath}`,
      thumbnailUrl: `/api/storage/${thumbnailPath}`,
      source: admin.ok ? 'Educator Contribution' : 'Participant Approved Sample',
      sourceUrl: '',
      license: 'Approved Reusable Contribution',
      width: validated.width,
      height: validated.height,
      format: 'jpeg',
      sizeBytes: validated.sizeBytes,
      sha256: validated.sha256,
      phash: validated.phash,
      qualityScore: validated.qualityScore,
      blurScore: validated.blurScore,
      validationStatus: 'validated',
      datasetType: 'user',
      ownerId: admin.ok ? 'educator' : 'shared_anonymous',
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    };

    manifest.unshift(record);
    await writeManifest(manifest);

    await appendActivity({
      type: 'collection',
      title: `Added verified ${record.categoryName.toLowerCase()} example to shared dataset`,
      detail: `Stored ${record.width}×${record.height} JPEG (quality ${(record.qualityScore * 100).toFixed(0)}%) at ${record.storagePath}.`,
      categorySlug: record.categorySlug,
    });

    res.status(201).json({ image: record });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Upload failed' });
  }
});

app.get('/api/dataset/quality', async (_req, res) => {
  const report = await runDatasetQualityAudit();
  res.json(report);
});

// ==================== SHARED MODEL LIBRARY & PROJECTS ====================

app.get('/api/projects', async (req, res) => {
  const state = await readState();
  const exampleProjects = state.projects.filter((p) => p.isPublic || p.isExample);
  const authCheck = await verifySessionFromHeaders(req, state);
  const sessionProjects = authCheck.session ? authCheck.session.projects : [];
  res.json({ projects: [...sessionProjects, ...exampleProjects] });
});

app.get('/api/shared-models', async (_req, res) => {
  const state = await readState();
  res.json({ sharedModels: state.sharedModels });
});

app.get('/api/models', async (req, res) => {
  const state = await readState();
  const authCheck = await verifySessionFromHeaders(req, state);
  const sessionModels = authCheck.session ? authCheck.session.models : [];
  res.json({
    sharedModels: state.sharedModels,
    sessionModels,
    models: [...sessionModels, ...state.sharedModels],
  });
});

// Register/hydrate the baseline 12-object shared reference model once if it doesn't exist yet (never overwrites existing shared models!)
app.post('/api/shared-models/bootstrap', async (req, res) => {
  const state = await readState();
  if (state.sharedModels.some((m) => m.modelId === 'mdl_builtin_reference')) {
    res.json({ model: state.sharedModels.find((m) => m.modelId === 'mdl_builtin_reference'), created: false });
    return;
  }
  const schema = z.object({
    categories: z.array(z.string()).min(2),
    datasetSize: z.number().int().min(4),
    accuracy: z.number().min(0).max(1),
    valAccuracy: z.number().min(0).max(1),
    testAccuracy: z.number().min(0).max(1),
    precision: z.number().min(0).max(1),
    recall: z.number().min(0).max(1),
    latencyMs: z.number().min(0),
    confusionMatrix: z.array(z.array(z.number())).optional(),
    classMetrics: z.array(z.any()).optional(),
    epochHistory: z.array(z.any()).optional(),
    serializedModelJson: z.string().max(4_000_000),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid reference model payload' });
    return;
  }
  const d = parsed.data;
  const now = new Date().toISOString();
  const refModel: SavedModelRecord = {
    modelId: 'mdl_builtin_reference',
    name: '12-Object Reference Model',
    description: 'Shared baseline MobileNetV2 classifier across all 12 built-in everyday object categories.',
    ownerId: 'system_dataset',
    projectId: 'example_builtin_12',
    isPublic: true,
    isShared: true,
    categories: d.categories,
    datasetSize: d.datasetSize,
    latestVersion: 1,
    activeVersion: 1,
    accuracy: d.testAccuracy,
    precision: d.precision,
    recall: d.recall,
    latencyMs: d.latencyMs,
    status: 'ready',
    versions: [
      {
        versionId: `ver_${crypto.randomUUID().slice(0, 8)}`,
        modelId: 'mdl_builtin_reference',
        version: 1,
        accuracy: d.accuracy,
        valAccuracy: d.valAccuracy,
        testAccuracy: d.testAccuracy,
        precision: d.precision,
        recall: d.recall,
        latencyMs: d.latencyMs,
        datasetSize: d.datasetSize,
        isDeployed: true,
        trigger: 'manual',
        confusionMatrix: d.confusionMatrix,
        classMetrics: d.classMetrics,
        epochHistory: d.epochHistory,
        serializedModelJson: d.serializedModelJson,
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  state.sharedModels.unshift(refModel);
  await writeState(state);
  res.status(201).json({ model: refModel, created: true });
});

// ==================== AUTONOMOUS LEARNING & ACTIVITY ====================

app.get('/api/autonomous/status', async (_req, res) => {
  const state = await readState();
  res.json({
    settings: state.systemSettings,
    queue: state.learningQueue,
    activity: state.learningActivity,
    sharedFeedbackCount: state.sharedFeedback.length,
    correctionsCount: state.sharedFeedback.length,
  });
});

app.patch('/api/autonomous/settings', async (req, res) => {
  const admin = await verifyAdminRequest(req);
  if (!admin.ok) {
    res.status(admin.status).json({ error: admin.error });
    return;
  }
  const schema = z.object({
    autonomousEnabled: z.boolean().optional(),
    autoCollectEnabled: z.boolean().optional(),
    autoRetrainEnabled: z.boolean().optional(),
    paused: z.boolean().optional(),
    maxDailyImages: z.number().int().min(1).max(500).optional(),
    retrainFrequencyHours: z.number().int().min(1).max(168).optional(),
    minConfidenceThreshold: z.number().min(0.3).max(0.99).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid settings update' });
    return;
  }
  const state = await readState();
  state.systemSettings = {
    ...state.systemSettings,
    ...parsed.data,
    updatedAt: new Date().toISOString(),
  };
  await writeState(state);
  res.json({ settings: state.systemSettings });
});

app.post('/api/autonomous/run', rateLimit(12, 60_000), async (req, res) => {
  const admin = await verifyAdminRequest(req);
  if (!admin.ok) {
    res.status(admin.status).json({ error: admin.error });
    return;
  }
  const targetCategorySlug = typeof req.body?.targetCategorySlug === 'string' ? req.body.targetCategorySlug : undefined;
  const maxCollect = typeof req.body?.maxCollect === 'number' ? Math.min(8, Math.max(1, req.body.maxCollect)) : 4;
  const result = await runAutonomousCycle({ targetCategorySlug, maxCollect });
  res.json(result);
});

app.post('/api/autonomous/queue/:queueId/review', async (req, res) => {
  const admin = await verifyAdminRequest(req);
  if (!admin.ok) {
    res.status(admin.status).json({ error: admin.error });
    return;
  }
  const action = req.body?.action;
  if (!['approve', 'reject'].includes(action)) {
    res.status(400).json({ error: 'Action must be approve or reject' });
    return;
  }
  const state = await readState();
  const item = state.learningQueue.find((q) => q.queueId === req.params.queueId);
  if (!item) {
    res.status(404).json({ error: 'Queue item not found' });
    return;
  }
  item.status = action === 'approve' ? 'approved' : 'rejected';
  item.updatedAt = new Date().toISOString();
  state.learningActivity.unshift({
    activityId: `act_${crypto.randomUUID().slice(0, 8)}`,
    type: action === 'approve' ? 'collection' : 'dedup',
    title: `${action === 'approve' ? 'Approved' : 'Rejected'} autonomous candidate for ${item.categoryName}`,
    detail: `Educator marked ${item.imageId} as ${item.status}.`,
    categorySlug: item.categorySlug,
    createdAt: item.updatedAt,
  });
  await writeState(state);
  res.json({ item });
});

app.get('/api/activity', async (_req, res) => {
  const state = await readState();
  res.json({ activity: state.learningActivity });
});

// ==================== PROTECTED EDUCATOR / ADMIN API ====================

app.get('/api/admin/overview', async (req, res) => {
  const admin = await verifyAdminRequest(req);
  if (!admin.ok) {
    res.status(admin.status).json({ error: admin.error });
    return;
  }
  await sweepExpiredSessions();
  const state = await readState();

  const activeSessions = state.sessions
    .filter((s) => s.status === 'active')
    .map((s) => ({
      sessionId: s.sessionId,
      nickname: s.nickname || 'Anonymous Participant',
      status: s.status,
      categoriesCount: s.categories.length,
      uploadedImagesCount: s.uploadedImageIds.length,
      modelsCount: s.models.length,
      predictionsCount: s.predictions.length,
      feedbackCount: s.feedback.length,
      inFlightOps: s.inFlightOps,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      updatedAt: s.updatedAt,
    }));

  const completedSummaries = state.sessionSummaries.map((sum) => {
    const sess = state.sessions.find((s) => s.sessionId === sum.sessionId);
    return {
      ...sum,
      nickname: sum.nickname || sess?.nickname || 'Anonymous Participant',
    };
  });
  const totalSessions = state.sessions.length;
  const aggregate = {
    totalSessions,
    activeSessionsCount: activeSessions.length,
    completedSessionsCount: state.sessions.filter((s) => s.status === 'finished').length,
    expiredSessionsCount: state.sessions.filter((s) => s.status === 'expired').length,
    totalPredictions:
      completedSummaries.reduce((acc, s) => acc + s.predictionsCount, 0) +
      activeSessions.reduce((acc, s) => acc + s.predictionsCount, 0),
    totalFeedback: state.sharedFeedback.length,
    sharedModelsCount: state.sharedModels.length,
    pendingProposalsCount: state.pendingSharedProposals.filter((p) => p.status === 'pending').length,
  };

  res.json({
    educatorEmail: admin.email,
    aggregate,
    activeSessions,
    recentSummaries: completedSummaries.slice(0, 50),
    completedNicknames: state.completedNicknames.slice(0, 200),
    sharedFeedback: state.sharedFeedback.slice(0, 100),
    sharedModels: state.sharedModels,
    pendingProposals: state.pendingSharedProposals.filter((p) => p.status === 'pending'),
    educatorSettings: state.educatorSettings,
    autonomousSettings: state.systemSettings,
    learningActivity: state.learningActivity.slice(0, 80),
  });
});

app.post('/api/admin/sessions/:sessionId/reset', async (req, res) => {
  const admin = await verifyAdminRequest(req);
  if (!admin.ok) {
    res.status(admin.status).json({ error: admin.error });
    return;
  }
  const state = await readState();
  const session = state.sessions.find((s) => s.sessionId === req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }
  if (session.status !== 'active') {
    res.json({ ok: true, alreadyEnded: true });
    return;
  }
  const summary = await finalizeAndCleanupSession(state, session, 'finished', 'reset');
  await writeState(state);
  res.json({ ok: true, summary });
});

app.patch('/api/admin/settings', async (req, res) => {
  const admin = await verifyAdminRequest(req);
  if (!admin.ok) {
    res.status(admin.status).json({ error: admin.error });
    return;
  }
  const schema = z.object({
    sessionDurationMinutes: z.number().int().min(5).max(480).optional(),
    autoCleanupOnFinish: z.boolean().optional(),
    retainAnonymousFeedback: z.boolean().optional(),
    allowSharedModelPromotion: z.boolean().optional(),
    maxUploadImagesPerSession: z.number().int().min(5).max(200).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid educator settings.' });
    return;
  }
  const state = await readState();
  state.educatorSettings = {
    ...state.educatorSettings,
    ...parsed.data,
    updatedAt: new Date().toISOString(),
  };
  await writeState(state);
  res.json({ educatorSettings: state.educatorSettings });
});

app.post('/api/admin/proposals/:proposalId/review', async (req, res) => {
  const admin = await verifyAdminRequest(req);
  if (!admin.ok) {
    res.status(admin.status).json({ error: admin.error });
    return;
  }
  const action = req.body?.action;
  if (!['approve', 'reject'].includes(action)) {
    res.status(400).json({ error: 'Action must be approve or reject.' });
    return;
  }
  const state = await readState();
  const proposal = state.pendingSharedProposals.find((p) => p.proposalId === req.params.proposalId);
  if (!proposal) {
    res.status(404).json({ error: 'Proposal not found.' });
    return;
  }
  const now = new Date().toISOString();
  proposal.status = action === 'approve' ? 'approved' : 'rejected';
  proposal.reviewedAt = now;

  if (action === 'approve') {
    state.sharedModels.unshift({
      ...proposal.model,
      isPublic: true,
      isShared: true,
      updatedAt: now,
    });
    state.learningActivity.unshift({
      activityId: `act_${crypto.randomUUID().slice(0, 8)}`,
      type: 'evaluation',
      title: `Approved shared model "${proposal.model.name}"`,
      detail: `Educator approved evaluated candidate (${(proposal.model.accuracy * 100).toFixed(1)}% test accuracy across ${proposal.model.categories.length} categories).`,
      modelId: proposal.model.modelId,
      createdAt: now,
    });
  }
  await writeState(state);
  res.json({ proposal, sharedModelsCount: state.sharedModels.length });
});

app.delete('/api/admin/shared-models/:modelId', async (req, res) => {
  const admin = await verifyAdminRequest(req);
  if (!admin.ok) {
    res.status(admin.status).json({ error: admin.error });
    return;
  }
  if (req.params.modelId === 'mdl_builtin_reference') {
    res.status(400).json({ error: 'The built-in 12-object reference model cannot be deleted.' });
    return;
  }
  const state = await readState();
  const before = state.sharedModels.length;
  state.sharedModels = state.sharedModels.filter((m) => m.modelId !== req.params.modelId);
  if (state.sharedModels.length === before) {
    res.status(404).json({ error: 'Shared model not found.' });
    return;
  }
  await writeState(state);
  res.json({ ok: true });
});

app.patch('/api/admin/shared-feedback/:feedbackId', async (req, res) => {
  const admin = await verifyAdminRequest(req);
  if (!admin.ok) {
    res.status(admin.status).json({ error: admin.error });
    return;
  }
  const status = req.body?.status;
  if (!['verified', 'pending', 'applied'].includes(status)) {
    res.status(400).json({ error: 'Invalid feedback status.' });
    return;
  }
  const state = await readState();
  const item = state.sharedFeedback.find((f) => f.feedbackId === req.params.feedbackId);
  if (!item) {
    res.status(404).json({ error: 'Shared feedback item not found.' });
    return;
  }
  item.status = status;
  item.updatedAt = new Date().toISOString();
  await writeState(state);
  res.json({ item });
});

app.delete('/api/admin/shared-feedback/:feedbackId', async (req, res) => {
  const admin = await verifyAdminRequest(req);
  if (!admin.ok) {
    res.status(admin.status).json({ error: admin.error });
    return;
  }
  const state = await readState();
  const before = state.sharedFeedback.length;
  state.sharedFeedback = state.sharedFeedback.filter((f) => f.feedbackId !== req.params.feedbackId);
  if (state.sharedFeedback.length === before) {
    res.status(404).json({ error: 'Shared feedback item not found.' });
    return;
  }
  await writeState(state);
  res.json({ ok: true });
});

// Server-side Gemini educational insight endpoint
app.post('/api/explain', rateLimit(20, 60_000), async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'GEMINI_API_KEY is not configured in environment secrets.' });
    return;
  }
  const schema = z.object({
    topic: z.string().min(1).max(300),
    metricsSummary: z.string().max(1500).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }
  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Explain clearly in 2-3 concise, warm educational sentences without jargon: ${parsed.data.topic}\n${parsed.data.metricsSummary || ''}`,
      config: {
        systemInstruction: 'You are an approachable machine learning educator on "See How AI Learns." Give concrete, accurate guidance grounded in the provided metrics.',
      },
    });
    res.json({ explanation: response.text || '' });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Gemini request failed' });
  }
});

async function startServer() {
  await ensureDataDirs();
  await sweepExpiredSessions();
  startAutonomousScheduler();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`See How AI Learns server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
