import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { BUILT_IN_CATEGORIES } from '../server/categories.ts';
import { validateAndProcessImage, hammingDistanceHex } from '../server/imageValidator.ts';

export interface StoredImageRecord {
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
  format: 'jpeg';
  sizeBytes: number;
  sha256: string;
  phash: string;
  qualityScore: number;
  blurScore: number;
  validationStatus: 'validated';
  datasetType: 'built-in';
  isPublic: true;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

const EXTRA_QUERIES: Record<string, string[]> = {
  'computer-mice': ['computer mouse', 'logitech mouse', 'apple mouse', 'gaming mouse', 'optical mouse'],
  cars: ['sedan car', 'automobile', 'volkswagen golf', 'toyota corolla', 'honda civic', 'ford focus'],
  'mobile-phones': ['smartphone', 'iphone', 'samsung galaxy', 'android phone', 'mobile phone'],
  keys: ['house key', 'brass key', 'keychain', 'keys', 'padlock key', 'car key'],
  cups: ['coffee mug', 'ceramic cup', 'teacup', 'porcelain cup', 'espresso cup', 'mug'],
  backpacks: ['backpack', 'rucksack', 'hiking pack', 'daypack', 'school bag'],
  watches: ['wristwatch', 'seiko watch', 'omega watch', 'rolex watch', 'casio watch', 'digital watch'],
  pencils: ['pencil', 'colored pencil', 'wooden pencil', 'mechanical pencil', 'graphite pencil'],
  chairs: ['chair', 'wooden chair', 'office chair', 'armchair', 'dining chair', 'stool chair'],
};

const ALLOWED_LICENSES = [
  'cc0',
  'cc-by',
  'cc by',
  'public domain',
  'pd',
  'gfdl',
  'cc-by-sa',
  'cc by-sa',
];

function isReusableLicense(licenseShort: string): boolean {
  const lower = licenseShort.toLowerCase();
  if (!lower || lower.includes('non-free') || lower.includes('fair use') || lower.includes('copyrighted')) {
    return false;
  }
  return ALLOWED_LICENSES.some((allowed) => lower.includes(allowed));
}

function isRelevantTitle(title: string): boolean {
  const lower = title.toLowerCase();
  const banned = ['diagram', 'logo', 'icon', 'map', 'chart', 'flag', 'signature', 'coat of arms', 'screenshot', 'stamp'];
  return !banned.some((b) => lower.includes(b));
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function searchWikimediaImages(query: string, offset = 0): Promise<WikimediaPage[]> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `${query} filetype:bitmap`,
    gsrlimit: '45',
    gsroffset: String(offset),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '560',
    format: 'json',
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`, {
    headers: {
      'User-Agent': 'SeeHowAILearns/1.0 (Educational ML Dataset Collector; contact@seehowailearns.edu)',
      Accept: 'application/json',
    },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { query?: { pages?: Record<string, WikimediaPage> } };
  if (!data.query?.pages) return [];
  return Object.values(data.query.pages);
}

async function downloadBuffer(url: string): Promise<Buffer | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'SeeHowAILearns/1.0 (Educational ML Dataset Collector; contact@seehowailearns.edu)',
        },
      });
      clearTimeout(timer);
      if (res.status === 429) {
        await sleep(1500);
        continue;
      }
      if (!res.ok) return null;
      const arr = await res.arrayBuffer();
      return Buffer.from(arr);
    } catch {
      await sleep(500);
    }
  }
  return null;
}

async function main() {
  const storageRoot = path.resolve(process.cwd(), '.data', 'storage');
  const manifestPath = path.resolve(process.cwd(), '.data', 'dataset-manifest.json');
  await fs.mkdir(storageRoot, { recursive: true });

  const existingManifest: StoredImageRecord[] = [];
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) existingManifest.push(...parsed);
  } catch {
    // fresh manifest
  }

  const seenSha = new Set<string>(existingManifest.map((m) => m.sha256));
  const seenPhashes = existingManifest.map((m) => m.phash);
  const seenSourceUrls = new Set<string>(existingManifest.map((m) => m.sourceUrl));

  const results: StoredImageRecord[] = [...existingManifest];
  let rejectedCount = 0;

  for (const cat of BUILT_IN_CATEGORIES) {
    const catDir = path.join(storageRoot, 'built-in-dataset', cat.slug);
    const thumbDir = path.join(storageRoot, 'thumbnails', cat.slug);
    await fs.mkdir(catDir, { recursive: true });
    await fs.mkdir(thumbDir, { recursive: true });

    let currentForCat = results.filter((r) => r.categorySlug === cat.slug);
    if (currentForCat.length >= cat.targetCount) {
      console.log(`[${cat.name}] Already complete (${currentForCat.length}/${cat.targetCount})`);
      continue;
    }

    console.log(`[${cat.name}] Resuming from ${currentForCat.length}/${cat.targetCount}`);
    const queries = Array.from(new Set([...(EXTRA_QUERIES[cat.slug] || []), ...cat.searchQueries]));

    for (const query of queries) {
      if (currentForCat.length >= cat.targetCount) break;

      for (const offset of [0, 45, 90]) {
        if (currentForCat.length >= cat.targetCount) break;
        const pages = await searchWikimediaImages(query, offset);
        await sleep(180);

        const candidates = pages.filter((p) => {
          const info = p.imageinfo?.[0];
          if (!info?.thumburl && !info?.url) return false;
          if (!info.mime || !['image/jpeg', 'image/png', 'image/webp'].includes(info.mime)) return false;
          if (!isRelevantTitle(p.title)) return false;
          const license = info.extmetadata?.LicenseShortName?.value ?? '';
          if (!isReusableLicense(license)) return false;
          const srcUrl = info.descriptionurl ?? info.url ?? '';
          if (seenSourceUrls.has(srcUrl)) return false;
          return true;
        });

        for (let i = 0; i < candidates.length && currentForCat.length < cat.targetCount; i += 3) {
          const batch = candidates.slice(i, i + 3);
          const downloaded = await Promise.all(
            batch.map(async (page) => {
              const info = page.imageinfo![0];
              const fetchUrl = info.thumburl || info.url!;
              const buf = await downloadBuffer(fetchUrl);
              return { page, info, buf };
            }),
          );
          await sleep(140);

          for (const item of downloaded) {
            if (currentForCat.length >= cat.targetCount) break;
            if (!item.buf) {
              rejectedCount++;
              continue;
            }
            const validated = await validateAndProcessImage(item.buf);
            if (!validated.valid) {
              rejectedCount++;
              continue;
            }
            if (seenSha.has(validated.sha256)) {
              rejectedCount++;
              continue;
            }
            const isNearDup = seenPhashes.some((p) => hammingDistanceHex(p, validated.phash) <= 4);
            if (isNearDup) {
              rejectedCount++;
              continue;
            }

            const imageId = `img_${cat.slug.replace(/-/g, '_')}_${crypto.randomUUID().slice(0, 8)}`;
            const storagePath = `built-in-dataset/${cat.slug}/${imageId}.jpg`;
            const thumbnailPath = `thumbnails/${cat.slug}/${imageId}.jpg`;
            await fs.writeFile(path.join(storageRoot, storagePath), validated.normalizedBuffer);
            await fs.writeFile(path.join(storageRoot, thumbnailPath), validated.thumbnailBuffer);

            const sourceUrl = item.info.descriptionurl || item.info.url || '';
            const license = item.info.extmetadata?.LicenseShortName?.value || 'CC BY-SA';
            const cleanTitle = item.page.title.replace(/^File:/, '').replace(/\.[^.]+$/, '').slice(0, 110);
            const now = new Date().toISOString();

            const record: StoredImageRecord = {
              imageId,
              categoryId: cat.id,
              categorySlug: cat.slug,
              categoryName: cat.name,
              title: cleanTitle,
              storagePath,
              thumbnailPath,
              url: `/api/storage/${storagePath}`,
              thumbnailUrl: `/api/storage/${thumbnailPath}`,
              source: 'Wikimedia Commons',
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
              datasetType: 'built-in',
              isPublic: true,
              ownerId: 'system_dataset',
              createdAt: now,
              updatedAt: now,
            };

            seenSha.add(validated.sha256);
            seenPhashes.push(validated.phash);
            seenSourceUrls.add(sourceUrl);
            results.push(record);
            currentForCat.push(record);
          }
        }
      }
    }
    console.log(`[${cat.name}] Final count: ${currentForCat.length}/${cat.targetCount}`);
    await fs.writeFile(manifestPath, JSON.stringify(results, null, 2));
  }

  console.log(`Dataset collection complete. Total validated images: ${results.length}, rejected/deduped: ${rejectedCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
