import crypto from 'node:crypto';
import sharp from 'sharp';

export interface ValidatedImageResult {
  valid: boolean;
  reason?: string;
  width: number;
  height: number;
  format: 'jpeg' | 'png' | 'webp';
  sizeBytes: number;
  sha256: string;
  phash: string;
  qualityScore: number;
  blurScore: number;
  normalizedBuffer: Buffer;
  thumbnailBuffer: Buffer;
}

export function hammingDistanceHex(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    dist += (xor & 1) + ((xor >> 1) & 1) + ((xor >> 2) & 1) + ((xor >> 3) & 1);
  }
  return dist;
}

export async function validateAndProcessImage(inputBuffer: Buffer): Promise<ValidatedImageResult> {
  if (!inputBuffer || inputBuffer.length < 1024) {
    return {
      valid: false,
      reason: 'File too small or empty',
      width: 0,
      height: 0,
      format: 'jpeg',
      sizeBytes: inputBuffer?.length ?? 0,
      sha256: '',
      phash: '',
      qualityScore: 0,
      blurScore: 0,
      normalizedBuffer: Buffer.alloc(0),
      thumbnailBuffer: Buffer.alloc(0),
    };
  }

  try {
    const image = sharp(inputBuffer, { failOn: 'error' }).rotate();
    const meta = await image.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    if (width < 120 || height < 120) {
      return {
        valid: false,
        reason: `Resolution too low (${width}x${height})`,
        width,
        height,
        format: 'jpeg',
        sizeBytes: inputBuffer.length,
        sha256: '',
        phash: '',
        qualityScore: 0,
        blurScore: 0,
        normalizedBuffer: Buffer.alloc(0),
        thumbnailBuffer: Buffer.alloc(0),
      };
    }

    const aspect = width / height;
    if (aspect < 0.28 || aspect > 3.6) {
      return {
        valid: false,
        reason: `Extreme aspect ratio (${aspect.toFixed(2)})`,
        width,
        height,
        format: 'jpeg',
        sizeBytes: inputBuffer.length,
        sha256: '',
        phash: '',
        qualityScore: 0,
        blurScore: 0,
        normalizedBuffer: Buffer.alloc(0),
        thumbnailBuffer: Buffer.alloc(0),
      };
    }

    // Compute 64-bit dHash (9x8 grayscale)
    const { data: dhashPixels } = await sharp(inputBuffer)
      .rotate()
      .grayscale()
      .resize(9, 8, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    let bits = '';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const left = dhashPixels[y * 9 + x];
        const right = dhashPixels[y * 9 + x + 1];
        bits += left > right ? '1' : '0';
      }
    }
    let phash = '';
    for (let i = 0; i < 64; i += 4) {
      phash += parseInt(bits.slice(i, i + 4), 2).toString(16);
    }

    // Compute sharpness & contrast proxy on 128x128 grayscale
    const { data: gray128 } = await sharp(inputBuffer)
      .rotate()
      .grayscale()
      .resize(128, 128, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    let sum = 0;
    let sumSq = 0;
    let edgeEnergy = 0;
    for (let y = 1; y < 127; y++) {
      for (let x = 1; x < 127; x++) {
        const idx = y * 128 + x;
        const val = gray128[idx];
        sum += val;
        sumSq += val * val;
        const lap =
          4 * val -
          gray128[idx - 1] -
          gray128[idx + 1] -
          gray128[idx - 128] -
          gray128[idx + 128];
        edgeEnergy += Math.abs(lap);
      }
    }
    const n = 126 * 126;
    const mean = sum / n;
    const stdDev = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    const avgLap = edgeEnergy / n;

    if (stdDev < 12) {
      return {
        valid: false,
        reason: 'Low contrast or blank image',
        width,
        height,
        format: 'jpeg',
        sizeBytes: inputBuffer.length,
        sha256: '',
        phash,
        qualityScore: 0.1,
        blurScore: avgLap,
        normalizedBuffer: Buffer.alloc(0),
        thumbnailBuffer: Buffer.alloc(0),
      };
    }

    if (avgLap < 4.5) {
      return {
        valid: false,
        reason: 'Image appears excessively blurry',
        width,
        height,
        format: 'jpeg',
        sizeBytes: inputBuffer.length,
        sha256: '',
        phash,
        qualityScore: 0.2,
        blurScore: avgLap,
        normalizedBuffer: Buffer.alloc(0),
        thumbnailBuffer: Buffer.alloc(0),
      };
    }

    // Normalize main image (max 640px, clean JPEG) and 240px thumbnail
    const normalizedObj = await sharp(inputBuffer)
      .rotate()
      .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    const thumbnailBuffer = await sharp(inputBuffer)
      .rotate()
      .resize(260, 260, { fit: 'cover' })
      .jpeg({ quality: 76 })
      .toBuffer();

    const sha256 = crypto.createHash('sha256').update(normalizedObj.data).digest('hex');
    const sharpnessNorm = Math.min(1, avgLap / 38);
    const contrastNorm = Math.min(1, stdDev / 65);
    const qualityScore = Number((0.55 * sharpnessNorm + 0.45 * contrastNorm).toFixed(3));

    return {
      valid: true,
      width: normalizedObj.info.width,
      height: normalizedObj.info.height,
      format: 'jpeg',
      sizeBytes: normalizedObj.data.length,
      sha256,
      phash,
      qualityScore,
      blurScore: Number(avgLap.toFixed(2)),
      normalizedBuffer: normalizedObj.data,
      thumbnailBuffer,
    };
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : 'Corrupted image data',
      width: 0,
      height: 0,
      format: 'jpeg',
      sizeBytes: inputBuffer.length,
      sha256: '',
      phash: '',
      qualityScore: 0,
      blurScore: 0,
      normalizedBuffer: Buffer.alloc(0),
      thumbnailBuffer: Buffer.alloc(0),
    };
  }
}
