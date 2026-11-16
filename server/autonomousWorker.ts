import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { BUILT_IN_CATEGORIES } from './categories.ts';
import { validateAndProcessImage, hammingDistanceHex } from './imageValidator.ts';
import {
  readManifest,
  writeManifest,
  readState,
  writeState,
  getStorageRoot,
  sweepExpiredSessions,
  type ImageRecord,
} from './store.ts';

const ALLOWED_LICENSES = ['cc0', 'cc-by', 'cc by', 'public domain', 'pd', 'gfdl', 'cc-by-sa', 'cc by-sa'];

function isReusableLicense(licenseShort: string): boolean {
  const lower = licenseShort.toLowerCase();
  if (!lower || lower.includes('non-free') || lower.includes('fair use') || lower.includes('copyrighted')) {
    return false;
  }
  return ALLOWED_LICENSES.some((a) => lower.includes(a));
}

interface WikimediaPage {
  pageid: number;
  title: string;
  imageinfo?: Array<{
    url?: string;
    thumburl?: string;
    descriptionurl?: string;
    mime?: string;
    extmetadata?: {
      LicenseShortName?: { value?: string };
    };
  }>;
}

export async function runAutonomousCycle(options?: { targetCategorySlug?: string; maxCollect?: number }) {
  const state = await readState();
  const settings = state.systemSettings;
  const today = new Date().toISOString().slice(0, 10);

  if (settings.dailyCollectedDate !== today) {
    settings.dailyCollectedDate = today;
    settings.dailyCollectedCount = 0;
  }

  if (!options?.targetCategorySlug && (!settings.autonomousEnabled || settings.paused)) {
    return { skipped: true, reason: settings.paused ? 'Autonomous learning is paused.' : 'Autonomous learning is disabled.' };
  }

  const manifest = await readManifest();
  const now = new Date().toISOString();

  // 1. Identify weakest or most-confused category using de-identified sharedFeedback + counts + quality
  let targetCat = BUILT_IN_CATEGORIES.find((c) => c.slug === options?.targetCategorySlug);
  let reasonText = 'Scheduled diversity expansion';

  if (!targetCat) {
    const correctionCounts = new Map<string, number>();
    for (const fb of state.sharedFeedback) {
      if (!fb.isCorrect && fb.correctedCategory && fb.status !== 'pending') {
        correctionCounts.set(
          fb.correctedCategory.toLowerCase(),
          (correctionCounts.get(fb.correctedCategory.toLowerCase()) ?? 0) + 1,
        );
      }
    }
    for (const corr of state.userCorrections) {
      if (!corr.isCorrect && corr.correctedCategory && corr.status === 'verified') {
        correctionCounts.set(
          corr.correctedCategory.toLowerCase(),
          (correctionCounts.get(corr.correctedCategory.toLowerCase()) ?? 0) + 1,
        );
      }
    }

    let bestScore = -1;
    for (const cat of BUILT_IN_CATEGORIES) {
      const catImgs = manifest.filter((m) => m.categorySlug === cat.slug);
      const avgQ = catImgs.length > 0 ? catImgs.reduce((a, b) => a + b.qualityScore, 0) / catImgs.length : 0;
      const corrHits = correctionCounts.get(cat.name.toLowerCase()) ?? correctionCounts.get(cat.slug) ?? 0;
      const deficit = Math.max(0, cat.targetCount - catImgs.length);
      const priorityScore = corrHits * 5 + deficit * 2 + (1 - avgQ) * 3;
      if (priorityScore > bestScore) {
        bestScore = priorityScore;
        targetCat = cat;
        if (corrHits > 0) {
          reasonText = `Detected ${corrHits} verified participant correction(s) involving ${cat.name}`;
        } else if (deficit > 0) {
          reasonText = `Category ${cat.name} is below target (${catImgs.length}/${cat.targetCount})`;
        } else {
          reasonText = `Selected ${cat.name} for visual diversity and average quality boost (${(avgQ * 100).toFixed(0)}%)`;
        }
      }
    }
  }

  if (!targetCat) {
    targetCat = BUILT_IN_CATEGORIES[0];
  }

  const remainingQuota = Math.max(0, settings.maxDailyImages - settings.dailyCollectedCount);
  const desiredCount = Math.min(options?.maxCollect ?? 4, remainingQuota || 4);

  let collectedCount = 0;
  let duplicateRejected = 0;
  let qualityRejected = 0;

  if (settings.autoCollectEnabled && desiredCount > 0) {
    const query = targetCat.searchQueries[Math.floor(Math.random() * targetCat.searchQueries.length)];
    const offset = 60 + Math.floor(Math.random() * 40);
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrnamespace: '6',
      gsrsearch: `${query} filetype:bitmap`,
      gsrlimit: '20',
      gsroffset: String(offset),
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: '560',
      format: 'json',
    });

    try {
      const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`, {
        headers: {
          'User-Agent': 'SeeHowAILearns/1.0 (Autonomous Educational Dataset Pipeline)',
          Accept: 'application/json',
        },
      });
      if (res.ok) {
        const data = (await res.json()) as { query?: { pages?: Record<string, WikimediaPage> } };
        const pages = Object.values(data.query?.pages ?? {});
        const seenSha = new Set(manifest.map((m) => m.sha256));
        const seenPhash = manifest.map((m) => m.phash).filter(Boolean);
        const seenUrls = new Set(manifest.map((m) => m.sourceUrl));

        const storageRoot = getStorageRoot();
        await fs.mkdir(path.join(storageRoot, 'autonomous-learning', targetCat.slug), { recursive: true });
        await fs.mkdir(path.join(storageRoot, 'thumbnails', targetCat.slug), { recursive: true });

        for (const page of pages) {
          if (collectedCount >= desiredCount) break;
          const info = page.imageinfo?.[0];
          if (!info?.thumburl && !info?.url) continue;
          if (!info.mime || !['image/jpeg', 'image/png', 'image/webp'].includes(info.mime)) continue;
          const license = info.extmetadata?.LicenseShortName?.value ?? '';
          if (!isReusableLicense(license)) continue;
          const sourceUrl = info.descriptionurl ?? info.url ?? '';
          if (seenUrls.has(sourceUrl)) {
            duplicateRejected++;
            continue;
          }

          try {
            const imgRes = await fetch(info.thumburl || info.url!, {
              headers: { 'User-Agent': 'SeeHowAILearns/1.0 (Autonomous Educational Dataset Pipeline)' },
            });
            if (!imgRes.ok) continue;
            const buf = Buffer.from(await imgRes.arrayBuffer());
            const validated = await validateAndProcessImage(buf);
            if (!validated.valid) {
              qualityRejected++;
              continue;
            }
            if (seenSha.has(validated.sha256) || seenPhash.some((p) => hammingDistanceHex(p, validated.phash) <= 4)) {
              duplicateRejected++;
              continue;
            }

            const imageId = `img_auto_${targetCat.slug.replace(/-/g, '_')}_${crypto.randomUUID().slice(0, 8)}`;
            const storagePath = `autonomous-learning/${targetCat.slug}/${imageId}.jpg`;
            const thumbnailPath = `thumbnails/${targetCat.slug}/${imageId}.jpg`;

            await fs.writeFile(path.join(storageRoot, storagePath), validated.normalizedBuffer);
            await fs.writeFile(path.join(storageRoot, thumbnailPath), validated.thumbnailBuffer);

            const cleanTitle = page.title.replace(/^File:/, '').replace(/\.[^.]+$/, '').slice(0, 110);
            const record: ImageRecord = {
              imageId,
              categoryId: targetCat.id,
              categorySlug: targetCat.slug,
              categoryName: targetCat.name,
              title: cleanTitle,
              storagePath,
              thumbnailPath,
              url: `/api/storage/${storagePath}`,
              thumbnailUrl: `/api/storage/${thumbnailPath}`,
              source: 'Wikimedia Commons (Autonomous)',
              sourceUrl,
              license,
              width: validated.width,
              height: validated.height,
              format: 'jpeg',
              sizeBytes: validated.sizeBytes,
              sha256: validated.sha256,
              phash: validated.phash,
              qualityScore: validated.qualityScore,
              blurScore: validated.blurScore,
              validationStatus: 'validated',
              datasetType: 'autonomous',
              ownerId: 'system_autonomous',
              isPublic: true,
              createdAt: now,
              updatedAt: now,
            };

            manifest.push(record);
            seenSha.add(validated.sha256);
            seenPhash.push(validated.phash);
            seenUrls.add(sourceUrl);

            state.learningQueue.unshift({
              queueId: `q_${crypto.randomUUID().slice(0, 8)}`,
              categorySlug: targetCat.slug,
              categoryName: targetCat.name,
              imageId,
              source: 'Wikimedia Commons',
              sourceUrl,
              license,
              imageUrl: record.url,
              thumbnailUrl: record.thumbnailUrl,
              qualityScore: validated.qualityScore,
              reason: reasonText,
              status: validated.qualityScore >= 0.4 ? 'approved' : 'pending',
              createdAt: now,
              updatedAt: now,
            });

            collectedCount++;
            settings.dailyCollectedCount++;
          } catch {
            qualityRejected++;
          }
        }
      }
    } catch {
      // Network fetch failed gracefully
    }
  }

  if (collectedCount > 0) {
    await writeManifest(manifest);
    state.learningActivity.unshift({
      activityId: `act_${crypto.randomUUID().slice(0, 8)}`,
      type: 'collection',
      title: `Found ${collectedCount} additional verified ${targetCat.name.toLowerCase()} image${collectedCount === 1 ? '' : 's'}`,
      detail: `${reasonText}. Verified license, sharpness, and non-duplication before adding to the shared learning queue.`,
      categorySlug: targetCat.slug,
      createdAt: new Date().toISOString(),
    });
  }

  if (duplicateRejected > 0) {
    state.learningActivity.unshift({
      activityId: `act_${crypto.randomUUID().slice(0, 8)}`,
      type: 'dedup',
      title: `Filtered ${duplicateRejected} duplicate candidate image${duplicateRejected === 1 ? '' : 's'}`,
      detail: `SHA-256 and perceptual dHash checks prevented duplicate leakage into ${targetCat.name}.`,
      categorySlug: targetCat.slug,
      createdAt: new Date().toISOString(),
    });
  }

  const approvedReady = state.learningQueue.filter((q) => q.status === 'approved');
  const sharedTarget = state.sharedModels[0] || state.models[0];
  if (settings.autoRetrainEnabled && approvedReady.length >= 3 && sharedTarget) {
    const activeVer = sharedTarget.versions.find((v) => v.version === sharedTarget.activeVersion);
    if (activeVer) {
      state.learningActivity.unshift({
        activityId: `act_${crypto.randomUUID().slice(0, 8)}`,
        type: 'retrain',
        title: `Queued ${approvedReady.length} verified shared examples for ${sharedTarget.name}`,
        detail: `Approved examples for ${targetCat.name} are ready to benchmark v${sharedTarget.latestVersion + 1} against v${activeVer.version} (${(activeVer.testAccuracy * 100).toFixed(1)}% test accuracy).`,
        categorySlug: targetCat.slug,
        modelId: sharedTarget.modelId,
        createdAt: new Date().toISOString(),
      });
    }
  }

  settings.lastRunAt = new Date().toISOString();
  settings.updatedAt = settings.lastRunAt;
  state.learningActivity = state.learningActivity.slice(0, 200);
  state.learningQueue = state.learningQueue.slice(0, 150);
  await writeState(state);

  return {
    skipped: false,
    targetCategory: targetCat.name,
    reason: reasonText,
    collectedCount,
    duplicateRejected,
    qualityRejected,
    queuedTotal: state.learningQueue.length,
  };
}

let schedulerHandle: ReturnType<typeof setInterval> | null = null;
let sessionSweeperHandle: ReturnType<typeof setInterval> | null = null;

export function startAutonomousScheduler() {
  if (!schedulerHandle) {
    schedulerHandle = setInterval(() => {
      void runAutonomousCycle().catch(() => {});
    }, 15 * 60 * 1000);
  }
  if (!sessionSweeperHandle) {
    // Sweep expired or abandoned participant sessions every 60s
    sessionSweeperHandle = setInterval(() => {
      void sweepExpiredSessions().catch(() => {});
    }, 60 * 1000);
  }
}
