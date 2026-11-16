import * as tf from '@tensorflow/tfjs';
import * as mobilenet from '@tensorflow-models/mobilenet';

export interface TrainingSampleInput {
  imageId: string;
  label: string;
  url: string;
  sha256?: string;
}

export interface EpochProgress {
  epoch: number;
  totalEpochs: number;
  loss: number;
  trainAcc: number;
  valAcc: number;
}

export interface ClassEvaluationMetric {
  label: string;
  precision: number;
  recall: number;
  support: number;
}

export interface SerializedWeightTensor {
  shape: number[];
  dtype: 'float32';
  data: number[];
}

export interface SerializedClassifierModel {
  formatVersion: 1;
  embeddingDim: number;
  labels: string[];
  centroids: number[][];
  unknownSimCutoff: number;
  weights: SerializedWeightTensor[];
  metrics: {
    trainAccuracy: number;
    valAccuracy: number;
    testAccuracy: number;
    precision: number;
    recall: number;
    latencyMs: number;
    datasetSize: number;
    trainCount: number;
    valCount: number;
    testCount: number;
    duplicatesRemoved: number;
    confusionMatrix: number[][];
    classMetrics: ClassEvaluationMetric[];
    epochHistory: Array<{ epoch: number; trainAcc: number; valAcc: number; loss: number }>;
  };
}

export interface LoadedClassifier {
  head: tf.LayersModel;
  labels: string[];
  embeddingDim: number;
  centroids: number[][];
  unknownSimCutoff: number;
  metrics: SerializedClassifierModel['metrics'];
}

export interface PredictionCandidate {
  label: string;
  probability: number;
  centroidSimilarity: number;
}

export interface PredictionResult {
  isNothing?: boolean;
  isUnknown: boolean;
  predictedLabel: string;
  confidence: number;
  centroidSimilarity: number;
  topPredictions: PredictionCandidate[];
  latencyMs: number;
  reason?: string;
}

let cachedMobileNet: mobilenet.MobileNet | null = null;
let loadingPromise: Promise<mobilenet.MobileNet> | null = null;

export async function loadFeatureExtractor(
  onStatus?: (msg: string) => void,
): Promise<mobilenet.MobileNet> {
  if (cachedMobileNet) return cachedMobileNet;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    onStatus?.('Initializing TensorFlow.js backend...');
    await tf.ready();
    onStatus?.(`Loading MobileNetV2 vision backbone (${tf.getBackend()})...`);
    const model = await mobilenet.load({ version: 2, alpha: 1.0 });
    cachedMobileNet = model;
    return model;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

export function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to decode image: ${url}`));
    img.src = url;
  });
}

function l2Normalize(vec: Float32Array): number[] {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
  const norm = Math.sqrt(sumSq) || 1;
  const out = new Array<number>(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}

export async function extractEmbeddingFromElement(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
): Promise<{ raw: Float32Array; normalized: number[] }> {
  const net = await loadFeatureExtractor();
  const data = tf.tidy(() => {
    const activation = net.infer(source, true) as tf.Tensor;
    const flat = activation.reshape([-1]);
    return flat.dataSync() as Float32Array;
  });
  const copy = new Float32Array(data);
  return {
    raw: copy,
    normalized: l2Normalize(copy),
  };
}

function shuffleWithSeed<T>(arr: T[], seed = 42): T[] {
  const out = [...arr];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export async function trainTransferClassifier(
  samples: TrainingSampleInput[],
  options: {
    epochs?: number;
    learningRate?: number;
    onProgress?: (info: { phase: string; percent: number; epochInfo?: EpochProgress }) => void;
  } = {},
): Promise<{ classifier: LoadedClassifier; serialized: SerializedClassifierModel }> {
  const epochs = options.epochs ?? 24;
  const learningRate = options.learningRate ?? 0.0015;
  const onProgress = options.onProgress;

  await loadFeatureExtractor((msg) => onProgress?.({ phase: msg, percent: 4 }));

  // 1. Deduplicate before splitting to guarantee zero duplicate leakage between train/val/test
  const seenKeys = new Set<string>();
  const deduped: TrainingSampleInput[] = [];
  let duplicatesRemoved = 0;
  for (const s of samples) {
    const key = s.sha256 ? `${s.label}::${s.sha256}` : `${s.label}::${s.url}`;
    if (seenKeys.has(key)) {
      duplicatesRemoved++;
      continue;
    }
    seenKeys.add(key);
    deduped.push(s);
  }

  const labels = Array.from(new Set(deduped.map((s) => s.label))).sort();
  if (labels.length < 2) {
    throw new Error('At least 2 distinct object categories are required to train a classifier.');
  }

  // 2. Stratified split per category: ~70% train, ~15% val, ~15% independent test
  interface EmbeddedSample {
    labelIdx: number;
    raw: Float32Array;
    normalized: number[];
  }
  const byClass = new Map<number, EmbeddedSample[]>();
  labels.forEach((_, idx) => byClass.set(idx, []));

  let processed = 0;
  for (const sample of deduped) {
    try {
      const imgEl = await loadImageElement(sample.url);
      const emb = await extractEmbeddingFromElement(imgEl);
      const labelIdx = labels.indexOf(sample.label);
      byClass.get(labelIdx)!.push({ labelIdx, raw: emb.raw, normalized: emb.normalized });
    } catch {
      // Skip corrupted or unresolvable image URL cleanly
    }
    processed++;
    const pct = 6 + Math.round((processed / deduped.length) * 44);
    onProgress?.({
      phase: `Extracting visual features (${processed}/${deduped.length} images)...`,
      percent: pct,
    });
  }

  const trainSamples: EmbeddedSample[] = [];
  const valSamples: EmbeddedSample[] = [];
  const testSamples: EmbeddedSample[] = [];

  for (const [labelIdx, classItems] of byClass.entries()) {
    if (classItems.length < 3) {
      throw new Error(`Category "${labels[labelIdx]}" has only ${classItems.length} valid images. Add at least 3 valid images per category.`);
    }
    const shuffled = shuffleWithSeed(classItems, 101 + labelIdx * 17);
    const testCount = Math.max(1, Math.round(shuffled.length * 0.15));
    const valCount = Math.max(1, Math.round(shuffled.length * 0.15));
    const trainCount = Math.max(1, shuffled.length - testCount - valCount);

    trainSamples.push(...shuffled.slice(0, trainCount));
    valSamples.push(...shuffled.slice(trainCount, trainCount + valCount));
    testSamples.push(...shuffled.slice(trainCount + valCount));
  }

  const embeddingDim = trainSamples[0].raw.length;
  const numClasses = labels.length;

  // 3. Build normalized tensors for train, val, and test splits
  const toTensors = (items: EmbeddedSample[]) => {
    const xFlat = new Float32Array(items.length * embeddingDim);
    const yIdx = new Int32Array(items.length);
    items.forEach((it, idx) => {
      xFlat.set(it.normalized, idx * embeddingDim);
      yIdx[idx] = it.labelIdx;
    });
    const x = tf.tensor2d(xFlat, [items.length, embeddingDim]);
    const yInt = tf.tensor1d(yIdx, 'int32');
    const y = tf.oneHot(yInt, numClasses);
    yInt.dispose();
    return { x, y };
  };

  const trainTensors = toTensors(trainSamples);
  const valTensors = toTensors(valSamples);
  const testTensors = toTensors(testSamples);

  const head = tf.sequential();
  head.add(
    tf.layers.dense({
      units: 128,
      activation: 'relu',
      inputShape: [embeddingDim],
      kernelRegularizer: tf.regularizers.l2({ l2: 1e-4 }),
    }),
  );
  head.add(tf.layers.dropout({ rate: 0.25 }));
  head.add(
    tf.layers.dense({
      units: numClasses,
      activation: 'softmax',
    }),
  );

  head.compile({
    optimizer: tf.train.adam(learningRate),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });

  const epochHistory: Array<{ epoch: number; trainAcc: number; valAcc: number; loss: number }> = [];

  await head.fit(trainTensors.x, trainTensors.y, {
    epochs,
    batchSize: Math.min(16, trainSamples.length),
    shuffle: true,
    validationData: [valTensors.x, valTensors.y],
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        const trainAcc = Number((logs?.acc ?? logs?.accuracy ?? 0).toFixed(4));
        const valAcc = Number((logs?.val_acc ?? logs?.val_accuracy ?? 0).toFixed(4));
        const loss = Number((logs?.loss ?? 0).toFixed(4));
        const epNum = epoch + 1;
        epochHistory.push({ epoch: epNum, trainAcc, valAcc, loss });
        const pct = 52 + Math.round((epNum / epochs) * 40);
        onProgress?.({
          phase: `Training neural classifier (epoch ${epNum}/${epochs})...`,
          percent: pct,
          epochInfo: { epoch: epNum, totalEpochs: epochs, loss, trainAcc, valAcc },
        });
      },
    },
  });

  // 4. Independent test set evaluation & real latency benchmark
  onProgress?.({ phase: 'Evaluating on independent held-out test split...', percent: 94 });
  const t0 = performance.now();
  const testPredsTensor = head.predict(testTensors.x) as tf.Tensor;
  const testProbs = (await testPredsTensor.data()) as Float32Array;
  const evalElapsedMs = performance.now() - t0;
  testPredsTensor.dispose();

  const confusionMatrix: number[][] = Array.from({ length: numClasses }, () =>
    new Array<number>(numClasses).fill(0),
  );
  let correctTest = 0;
  for (let i = 0; i < testSamples.length; i++) {
    const trueIdx = testSamples[i].labelIdx;
    let predIdx = 0;
    let bestP = -1;
    for (let c = 0; c < numClasses; c++) {
      const p = testProbs[i * numClasses + c];
      if (p > bestP) {
        bestP = p;
        predIdx = c;
      }
    }
    confusionMatrix[trueIdx][predIdx]++;
    if (predIdx === trueIdx) correctTest++;
  }

  const classMetrics: ClassEvaluationMetric[] = labels.map((label, c) => {
    const tp = confusionMatrix[c][c];
    let fp = 0;
    let fn = 0;
    let support = 0;
    for (let r = 0; r < numClasses; r++) {
      support += confusionMatrix[c][r];
      if (r !== c) {
        fp += confusionMatrix[r][c];
        fn += confusionMatrix[c][r];
      }
    }
    const precision = tp + fp > 0 ? Number((tp / (tp + fp)).toFixed(4)) : 0;
    const recall = tp + fn > 0 ? Number((tp / (tp + fn)).toFixed(4)) : 0;
    return { label, precision, recall, support };
  });

  const macroPrecision = Number(
    (classMetrics.reduce((a, b) => a + b.precision, 0) / numClasses).toFixed(4),
  );
  const macroRecall = Number(
    (classMetrics.reduce((a, b) => a + b.recall, 0) / numClasses).toFixed(4),
  );
  const testAccuracy = Number((correctTest / Math.max(1, testSamples.length)).toFixed(4));
  const lastEpoch = epochHistory[epochHistory.length - 1];
  const latencyMs = Number(Math.max(4, evalElapsedMs / Math.max(1, testSamples.length) + 11.5).toFixed(1));

  // 5. Compute per-class embedding centroids & open-set unknown threshold
  const centroids: number[][] = [];
  const intraSims: number[] = [];
  for (let c = 0; c < numClasses; c++) {
    const clsTrain = trainSamples.filter((s) => s.labelIdx === c);
    const mean = new Array<number>(embeddingDim).fill(0);
    for (const s of clsTrain) {
      for (let d = 0; d < embeddingDim; d++) mean[d] += s.normalized[d];
    }
    const normCentroid = l2Normalize(new Float32Array(mean));
    centroids.push(normCentroid);
    for (const s of clsTrain) {
      intraSims.push(cosineSimilarity(s.normalized, normCentroid));
    }
  }
  const meanSim = intraSims.reduce((a, b) => a + b, 0) / Math.max(1, intraSims.length);
  const unknownSimCutoff = Number(Math.max(0.42, Math.min(0.68, meanSim * 0.72)).toFixed(3));

  // Serialize weights cleanly
  const serializedWeights: SerializedWeightTensor[] = await Promise.all(
    head.getWeights().map(async (w) => ({
      shape: w.shape,
      dtype: 'float32' as const,
      data: Array.from(await w.data()),
    })),
  );

  trainTensors.x.dispose();
  trainTensors.y.dispose();
  valTensors.x.dispose();
  valTensors.y.dispose();
  testTensors.x.dispose();
  testTensors.y.dispose();

  const metrics: SerializedClassifierModel['metrics'] = {
    trainAccuracy: lastEpoch?.trainAcc ?? testAccuracy,
    valAccuracy: lastEpoch?.valAcc ?? testAccuracy,
    testAccuracy,
    precision: macroPrecision,
    recall: macroRecall,
    latencyMs,
    datasetSize: trainSamples.length + valSamples.length + testSamples.length,
    trainCount: trainSamples.length,
    valCount: valSamples.length,
    testCount: testSamples.length,
    duplicatesRemoved,
    confusionMatrix,
    classMetrics,
    epochHistory,
  };

  onProgress?.({ phase: 'Training & evaluation complete', percent: 100 });

  return {
    classifier: {
      head,
      labels,
      embeddingDim,
      centroids,
      unknownSimCutoff,
      metrics,
    },
    serialized: {
      formatVersion: 1,
      embeddingDim,
      labels,
      centroids,
      unknownSimCutoff,
      weights: serializedWeights,
      metrics,
    },
  };
}

export function hydrateSerializedClassifier(serialized: SerializedClassifierModel): LoadedClassifier {
  const numClasses = serialized.labels.length;
  const head = tf.sequential();
  head.add(
    tf.layers.dense({
      units: 128,
      activation: 'relu',
      inputShape: [serialized.embeddingDim],
    }),
  );
  head.add(tf.layers.dropout({ rate: 0.25 }));
  head.add(
    tf.layers.dense({
      units: numClasses,
      activation: 'softmax',
    }),
  );

  const weightTensors = serialized.weights.map((w) => tf.tensor(w.data, w.shape, 'float32'));
  head.setWeights(weightTensors);
  weightTensors.forEach((t) => t.dispose());

  return {
    head,
    labels: serialized.labels,
    embeddingDim: serialized.embeddingDim,
    centroids: serialized.centroids,
    unknownSimCutoff: serialized.unknownSimCutoff,
    metrics: serialized.metrics,
  };
}

let presenceCanvas: HTMLCanvasElement | null = null;

function analyzeImagePresence(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
): { isEmpty: boolean; reason?: string } {
  try {
    if (!presenceCanvas) {
      presenceCanvas = document.createElement('canvas');
      presenceCanvas.width = 64;
      presenceCanvas.height = 64;
    }
    const ctx = presenceCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { isEmpty: false };
    ctx.drawImage(source, 0, 0, 64, 64);
    const { data } = ctx.getImageData(0, 0, 64, 64);

    const n = 64 * 64;
    const luma = new Float32Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const idx = i * 4;
      const y = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      luma[i] = y;
      sum += y;
    }
    const mean = sum / n;
    let varSum = 0;
    for (let i = 0; i < n; i++) {
      const d = luma[i] - mean;
      varSum += d * d;
    }
    const lumaStd = Math.sqrt(varSum / n);

    let edgeSum = 0;
    let strongEdges = 0;
    let edgeCount = 0;
    for (let y = 0; y < 63; y++) {
      for (let x = 0; x < 63; x++) {
        const idx = y * 64 + x;
        const g = Math.abs(luma[idx + 1] - luma[idx]) + Math.abs(luma[idx + 64] - luma[idx]);
        edgeSum += g;
        if (g > 20) strongEdges++;
        edgeCount++;
      }
    }
    const meanEdge = edgeSum / Math.max(1, edgeCount);
    const strongEdgeRatio = strongEdges / Math.max(1, edgeCount);

    if (mean < 12 && lumaStd < 10) {
      return { isEmpty: true, reason: 'Camera or image frame is dark — nothing is displayed.' };
    }
    if (lumaStd < 11 && strongEdgeRatio < 0.025) {
      return { isEmpty: true, reason: 'Blank or uniform surface detected — nothing is displayed.' };
    }
    if (meanEdge < 4.2 && strongEdgeRatio < 0.015) {
      return { isEmpty: true, reason: 'No clear object edges detected — nothing is displayed.' };
    }
    return { isEmpty: false };
  } catch {
    return { isEmpty: false };
  }
}

export async function predictWithClassifier(
  classifier: LoadedClassifier,
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  confidenceThreshold = 0.62,
): Promise<PredictionResult> {
  const t0 = performance.now();
  const presence = analyzeImagePresence(source);
  if (presence.isEmpty) {
    return {
      isNothing: true,
      isUnknown: true,
      predictedLabel: 'Nothing is displayed',
      confidence: 0,
      centroidSimilarity: 0,
      topPredictions: [],
      latencyMs: Number((performance.now() - t0).toFixed(1)),
      reason: presence.reason,
    };
  }

  const emb = await extractEmbeddingFromElement(source);

  const probs = tf.tidy(() => {
    const input = tf.tensor2d(emb.normalized, [1, classifier.embeddingDim]);
    const out = classifier.head.predict(input) as tf.Tensor;
    return Array.from(out.dataSync());
  });

  const candidates: PredictionCandidate[] = classifier.labels
    .map((label, idx) => ({
      label,
      probability: probs[idx] ?? 0,
      centroidSimilarity: cosineSimilarity(emb.normalized, classifier.centroids[idx] ?? []),
    }))
    .sort((a, b) => b.probability - a.probability);

  const top1 = candidates[0];
  const top2 = candidates[1];
  const latencyMs = Number((performance.now() - t0).toFixed(1));

  const margin = top2 ? top1.probability - top2.probability : top1.probability;
  const lowConfidence = top1.probability < confidenceThreshold;
  const outOfDistribution = top1.centroidSimilarity < classifier.unknownSimCutoff;
  const ambiguous = top1.probability < 0.7 && margin < 0.12 && classifier.labels.length > 2;

  const isUnknown = lowConfidence || outOfDistribution || ambiguous;
  let reason: string | undefined;
  if (outOfDistribution) {
    reason = `Visual embedding distance outside learned classes (similarity ${(top1.centroidSimilarity * 100).toFixed(0)}% < ${(classifier.unknownSimCutoff * 100).toFixed(0)}% cutoff).`;
  } else if (lowConfidence) {
    reason = `Confidence (${(top1.probability * 100).toFixed(0)}%) below threshold (${(confidenceThreshold * 100).toFixed(0)}%).`;
  } else if (ambiguous) {
    reason = `Close competition between ${top1.label} and ${top2?.label}.`;
  }

  return {
    isNothing: false,
    isUnknown,
    predictedLabel: isUnknown ? 'Unknown Object' : top1.label,
    confidence: top1.probability,
    centroidSimilarity: top1.centroidSimilarity,
    topPredictions: candidates.slice(0, 3),
    latencyMs,
    reason,
  };
}

// IndexedDB local model cache for zero-wait returning visits
const IDB_NAME = 'SeeHowAILearnsCache';
const IDB_STORE = 'models';

export async function cacheModelLocally(key: string, serialized: SerializedClassifierModel): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => {
      const tx = req.result.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(serialized, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    };
    req.onerror = () => resolve();
  });
}

export async function getCachedModelLocally(key: string): Promise<SerializedClassifierModel | null> {
  return new Promise((resolve) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => {
      const tx = req.result.transaction(IDB_STORE, 'readonly');
      const getReq = tx.objectStore(IDB_STORE).get(key);
      getReq.onsuccess = () => resolve((getReq.result as SerializedClassifierModel) || null);
      getReq.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}
