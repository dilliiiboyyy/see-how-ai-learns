import { useEffect, useRef, useState } from 'react';
import { ChevronRight, RotateCcw, Play, Pause, ArrowRight } from 'lucide-react';
import { usePlatform } from '../context/PlatformContext';

const VISION_STUDY_IMG = '/src/assets/images/learn_vision_study_1794773001814.jpg';
const VARIETY_STUDY_IMG = '/src/assets/images/learn_variety_study_1794773001175.jpg';

const LESSONS = [
  { id: 1, title: 'What is machine learning?' },
  { id: 2, title: 'How image recognition works.' },
  { id: 3, title: 'How computers learn from examples.' },
  { id: 4, title: 'Why image variety matters.' },
  { id: 5, title: 'Understanding predictions and confidence scores.' },
  { id: 6, title: 'How AI improves over time.' },
] as const;

export function LearnPage() {
  const { navigate, firebaseStatus } = usePlatform();
  const [activeLesson, setActiveLesson] = useState<number>(1);

  // Lesson 1 state
  const [approach, setApproach] = useState<'rules' | 'ml'>('rules');
  const [testObject, setTestObject] = useState<'yellow_pencil' | 'blue_mechanical' | 'fountain_pen'>('blue_mechanical');

  // Lesson 2 state
  const [visionMode, setVisionMode] = useState<'original' | 'grid' | 'edges'>('original');
  const [gridCell, setGridCell] = useState<{ x: number; y: number; rgb: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Lesson 3 state
  const [epoch, setEpoch] = useState(0);
  const [learningRate, setLearningRate] = useState(0.02);
  const [playingEpochs, setPlayingEpochs] = useState(false);

  // Lesson 4 state
  const [varietyLevel, setVarietyLevel] = useState(1);

  // Lesson 5 state
  const [threshold, setThreshold] = useState(0.65);
  const [scenario, setScenario] = useState<'clear_cup' | 'pen_vs_pencil' | 'potted_plant'>('pen_vs_pencil');

  // Lesson 2 canvas renderer
  useEffect(() => {
    if (activeLesson !== 2) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const w = 480;
      const h = 270;
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);

      if (visionMode === 'grid') {
        const imageData = ctx.getImageData(0, 0, w, h);
        const blockSize = 24;
        for (let y = 0; y < h; y += blockSize) {
          for (let x = 0; x < w; x += blockSize) {
            const idx = ((y + 8) * w + (x + 8)) * 4;
            const r = imageData.data[idx] ?? 200;
            const g = imageData.data[idx + 1] ?? 195;
            const b = imageData.data[idx + 2] ?? 185;
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(x, y, blockSize, blockSize);
            ctx.strokeStyle = 'rgba(41,40,32,0.18)';
            ctx.strokeRect(x, y, blockSize, blockSize);
          }
        }
      } else if (visionMode === 'edges') {
        const src = ctx.getImageData(0, 0, w, h);
        const dst = ctx.createImageData(w, h);
        const d = src.data;
        const out = dst.data;
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const i = (y * w + x) * 4;
            const left = d[i - 4] * 0.3 + d[i - 3] * 0.59 + d[i - 2] * 0.11;
            const right = d[i + 4] * 0.3 + d[i + 5] * 0.59 + d[i + 6] * 0.11;
            const top = d[i - w * 4] * 0.3 + d[i - w * 4 + 1] * 0.59 + d[i - w * 4 + 2] * 0.11;
            const bottom = d[i + w * 4] * 0.3 + d[i + w * 4 + 1] * 0.59 + d[i + w * 4 + 2] * 0.11;
            const mag = Math.min(255, Math.abs(right - left) + Math.abs(bottom - top));
            out[i] = 244 - mag * 0.85;
            out[i + 1] = 241 - mag * 0.85;
            out[i + 2] = 234 - mag * 0.85;
            out[i + 3] = 255;
          }
        }
        ctx.putImageData(dst, 0, 0);
      }
    };
    img.src = VISION_STUDY_IMG;
  }, [activeLesson, visionMode]);

  // Lesson 3 epoch stepper
  useEffect(() => {
    if (!playingEpochs || activeLesson !== 3) return;
    const id = setInterval(() => {
      setEpoch((e) => {
        if (e >= 24) {
          setPlayingEpochs(false);
          return 24;
        }
        return e + 1;
      });
    }, 280);
    return () => clearInterval(id);
  }, [playingEpochs, activeLesson]);

  const computeEpochCurve = (ep: number, lr: number) => {
    const rateFactor = lr > 0.04 ? 0.55 : lr < 0.005 ? 0.45 : 1.0;
    const oscillation = lr > 0.04 ? Math.sin(ep * 1.9) * 0.11 : 0;
    const baseAcc = 0.25 + 0.69 * (1 - Math.exp(-ep * 0.16 * rateFactor));
    const acc = Math.max(0.2, Math.min(0.96, baseAcc + oscillation));
    const loss = Math.max(0.12, 1.45 * Math.exp(-ep * 0.14 * rateFactor) + Math.abs(oscillation));
    return { acc, loss };
  };

  const scenarioScores: Record<
    typeof scenario,
    { title: string; truth: string; scores: Array<{ label: string; prob: number }>; similarity: number }
  > = {
    clear_cup: {
      title: 'Ceramic Coffee Mug',
      truth: 'Cup',
      scores: [
        { label: 'Cup', prob: 0.91 },
        { label: 'Water bottle', prob: 0.06 },
        { label: 'Backpack', prob: 0.03 },
      ],
      similarity: 0.86,
    },
    pen_vs_pencil: {
      title: 'Slender Silver Pen on Desk',
      truth: 'Pen',
      scores: [
        { label: 'Pen', prob: 0.56 },
        { label: 'Pencil', prob: 0.38 },
        { label: 'Keys', prob: 0.06 },
      ],
      similarity: 0.69,
    },
    potted_plant: {
      title: 'Potted Houseplant (Outside 12 Categories)',
      truth: 'Unknown Object',
      scores: [
        { label: 'Cup', prob: 0.34 },
        { label: 'Backpack', prob: 0.28 },
        { label: 'Chair', prob: 0.19 },
      ],
      similarity: 0.31,
    },
  };

  const activeScenario = scenarioScores[scenario];
  const topScore = activeScenario.scores[0];
  const isUncertain = topScore.prob < threshold || activeScenario.similarity < 0.45;

  return (
    <div className="max-w-[1280px] mx-auto px-5 sm:px-8 py-12 space-y-10">
      <div className="border-b border-[#D9D3C8] pb-8 space-y-2 max-w-2xl">
        <p className="text-xs text-[#777469]">
          Interactive Curriculum
          <span className="mx-2" aria-hidden="true">·</span>
          6 Guided Lessons
        </p>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#292820]">
          Learn How Machines See
        </h1>
        <p className="text-sm sm:text-base text-[#777469]">
          Explore the core principles of visual machine learning through hands-on interactive demonstrations rather than dense textbooks.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Lesson Selector Rail */}
        <aside className="lg:col-span-4 space-y-2">
          {LESSONS.map((lesson) => {
            const active = activeLesson === lesson.id;
            return (
              <button
                key={lesson.id}
                type="button"
                onClick={() => setActiveLesson(lesson.id)}
                className={`w-full text-left px-4 py-3.5 rounded-xl border transition-colors flex items-center justify-between gap-3 cursor-pointer ${
                  active
                    ? 'bg-[#FFFFFF] border-[#777C61] text-[#292820]'
                    : 'bg-[#E7E1D5]/40 border-[#D9D3C8] text-[#777469] hover:bg-[#FFFFFF]'
                }`}
              >
                <div className="min-w-0">
                  <p className="font-mono text-[11px] text-[#AD7961] tabular-nums">
                    Lesson {lesson.id}
                  </p>
                  <p className="text-sm font-medium text-[#292820] mt-0.5">{lesson.title}</p>
                </div>
                <ChevronRight className={`w-4 h-4 shrink-0 ${active ? 'text-[#777C61]' : 'text-[#777469]'}`} />
              </button>
            );
          })}
        </aside>

        {/* Two-Zone Interactive Sandbox Stage */}
        <section className="lg:col-span-8 bg-[#FFFFFF] border border-[#D9D3C8] rounded-2xl p-6 sm:p-8 space-y-6">
          {activeLesson === 1 && (
            <div className="space-y-6">
              <div>
                <p className="font-mono text-xs text-[#AD7961]">Lesson 1</p>
                <h2 className="font-display text-2xl font-semibold text-[#292820] mt-1">
                  What is machine learning?
                </h2>
                <p className="text-sm text-[#777469] mt-2">
                  Compare hand-written rules against example-based learning when an unfamiliar object design appears.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-[#F4F1EA] border border-[#D9D3C8] space-y-3">
                  <p className="text-xs font-medium text-[#777469]">1. Choose Approach</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setApproach('rules')}
                      className={`flex-1 py-2 px-3 rounded-md text-xs font-medium border cursor-pointer ${
                        approach === 'rules'
                          ? 'bg-[#777C61] text-[#FFFFFF] border-[#777C61]'
                          : 'bg-[#FFFFFF] text-[#292820] border-[#D9D3C8]'
                      }`}
                    >
                      Hand-Coded Rules
                    </button>
                    <button
                      type="button"
                      onClick={() => setApproach('ml')}
                      className={`flex-1 py-2 px-3 rounded-md text-xs font-medium border cursor-pointer ${
                        approach === 'ml'
                          ? 'bg-[#777C61] text-[#FFFFFF] border-[#777C61]'
                          : 'bg-[#FFFFFF] text-[#292820] border-[#D9D3C8]'
                      }`}
                    >
                      Trained on Examples
                    </button>
                  </div>
                  <p className="text-xs text-[#777469] font-mono bg-[#FFFFFF] p-3 rounded border border-[#D9D3C8]">
                    {approach === 'rules'
                      ? 'IF color == "yellow" AND tip == "wood" THEN "Pencil" ELSE "Unknown"'
                      : 'Learned visual geometry (slender shaft + conical tip + clip/eraser) from 50 examples per class.'}
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-[#F4F1EA] border border-[#D9D3C8] space-y-3">
                  <p className="text-xs font-medium text-[#777469]">2. Test an Object</p>
                  <div className="space-y-2">
                    {(
                      [
                        ['yellow_pencil', 'Classic Yellow Wooden Pencil'],
                        ['blue_mechanical', 'Blue Mechanical Pencil'],
                        ['fountain_pen', 'Brass Fountain Pen'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setTestObject(id)}
                        className={`w-full text-left px-3 py-2 rounded-md text-xs border cursor-pointer ${
                          testObject === id
                            ? 'bg-[#FFFFFF] border-[#777C61] font-medium text-[#292820]'
                            : 'bg-transparent border-[#D9D3C8] text-[#777469]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-5 rounded-xl bg-[#E7E1D5]/60 border border-[#D9D3C8] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="text-xs text-[#777469]">System Output</p>
                  <p className="font-display text-lg font-semibold text-[#292820] mt-0.5">
                    {approach === 'rules'
                      ? testObject === 'yellow_pencil'
                        ? 'Pencil (Matched hardcoded color rule)'
                        : 'Failed: Color rule could not generalize'
                      : testObject === 'fountain_pen'
                        ? 'Pen (92% confidence — detected nib & barrel)'
                        : 'Pencil (89% confidence — detected graphite tip & body)'}
                  </p>
                </div>
                <span className="text-xs font-medium text-[#777C61] shrink-0">
                  {approach === 'rules' && testObject !== 'yellow_pencil' ? 'Brittle Rule Breakdown' : 'Pattern Matched'}
                </span>
              </div>
            </div>
          )}

          {activeLesson === 2 && (
            <div className="space-y-6">
              <div>
                <p className="font-mono text-xs text-[#AD7961]">Lesson 2</p>
                <h2 className="font-display text-2xl font-semibold text-[#292820] mt-1">
                  How image recognition works.
                </h2>
                <p className="text-sm text-[#777469] mt-2">
                  Computers do not see a "pencil" or "notebook"—they see grids of red, green, and blue numbers, then detect edges and shapes.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    ['original', 'Human View'],
                    ['grid', 'Pixel Numbers (24px Blocks)'],
                    ['edges', 'Edge Detection Layer'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setVisionMode(mode)}
                    className={`px-3.5 py-2 text-xs font-medium rounded-md border cursor-pointer ${
                      visionMode === mode
                        ? 'bg-[#777C61] text-[#FFFFFF] border-[#777C61]'
                        : 'bg-[#F4F1EA] text-[#292820] border-[#D9D3C8]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="rounded-xl overflow-hidden border border-[#D9D3C8] bg-[#E7E1D5]">
                <canvas
                  ref={canvasRef}
                  onMouseMove={(e) => {
                    const c = canvasRef.current;
                    if (!c) return;
                    const rect = c.getBoundingClientRect();
                    const x = Math.floor(((e.clientX - rect.left) / rect.width) * c.width);
                    const y = Math.floor(((e.clientY - rect.top) / rect.height) * c.height);
                    const ctx = c.getContext('2d');
                    if (!ctx) return;
                    const p = ctx.getImageData(Math.max(0, x), Math.max(0, y), 1, 1).data;
                    setGridCell({ x, y, rgb: `RGB(${p[0]}, ${p[1]}, ${p[2]})` });
                  }}
                  className="w-full h-auto block cursor-crosshair"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-[#777469] bg-[#F4F1EA] px-4 py-2.5 rounded-md">
                <span>Move pointer across canvas to sample numeric pixel values</span>
                <span className="font-mono text-[#292820] tabular-nums">
                  {gridCell ? `(${gridCell.x}, ${gridCell.y}) → ${gridCell.rgb}` : 'Hover image to inspect RGB'}
                </span>
              </div>
            </div>
          )}

          {activeLesson === 3 && (
            <div className="space-y-6">
              <div>
                <p className="font-mono text-xs text-[#AD7961]">Lesson 3</p>
                <h2 className="font-display text-2xl font-semibold text-[#292820] mt-1">
                  How computers learn from examples.
                </h2>
                <p className="text-sm text-[#777469] mt-2">
                  Training happens in passes called epochs. Each epoch adjusts internal weights to reduce prediction error (loss).
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 bg-[#F4F1EA] p-4 rounded-xl border border-[#D9D3C8]">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (epoch >= 24) setEpoch(0);
                      setPlayingEpochs((p) => !p);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#777C61] text-[#FFFFFF] text-xs font-medium cursor-pointer"
                  >
                    {playingEpochs ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    {playingEpochs ? 'Pause' : epoch >= 24 ? 'Replay' : 'Run Training'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEpoch((e) => Math.min(24, e + 1))}
                    className="px-3 py-2 rounded-md bg-[#FFFFFF] border border-[#D9D3C8] text-xs font-medium text-[#292820] cursor-pointer"
                  >
                    Step +1 Epoch
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlayingEpochs(false);
                      setEpoch(0);
                    }}
                    className="p-2 rounded-md bg-[#FFFFFF] border border-[#D9D3C8] text-[#777469] cursor-pointer"
                    aria-label="Reset training simulation"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>

                <label className="flex items-center gap-3 text-xs text-[#292820]">
                  <span>Learning Rate:</span>
                  <input
                    type="range"
                    min={0.002}
                    max={0.06}
                    step={0.002}
                    value={learningRate}
                    onChange={(e) => setLearningRate(Number(e.target.value))}
                    className="accent-[#777C61]"
                  />
                  <span className="font-mono tabular-nums w-12">{learningRate.toFixed(3)}</span>
                </label>
              </div>

              {/* Live SVG Learning Curve */}
              <div className="border border-[#D9D3C8] rounded-xl p-4 bg-[#F4F1EA]/50">
                <svg viewBox="0 0 480 180" className="w-full h-44 overflow-visible">
                  <line x1="36" y1="150" x2="460" y2="150" stroke="#D9D3C8" strokeWidth="1" />
                  <line x1="36" y1="20" x2="36" y2="150" stroke="#D9D3C8" strokeWidth="1" />
                  <text x="8" y="25" fontSize="10" fill="#777469">100%</text>
                  <text x="14" y="152" fontSize="10" fill="#777469">0%</text>
                  <text x="415" y="168" fontSize="10" fill="#777469">Epoch 24</text>
                  {epoch > 0 && (
                    <polyline
                      fill="none"
                      stroke="#777C61"
                      strokeWidth="2.5"
                      points={Array.from({ length: epoch + 1 })
                        .map((_, idx) => {
                          const x = 36 + (idx / 24) * 424;
                          const { acc } = computeEpochCurve(idx, learningRate);
                          const y = 150 - acc * 130;
                          return `${x.toFixed(1)},${y.toFixed(1)}`;
                        })
                        .join(' ')}
                    />
                  )}
                </svg>
                <div className="grid grid-cols-3 gap-4 pt-3 border-t border-[#D9D3C8] text-xs">
                  <div>
                    <p className="text-[#777469]">Epoch</p>
                    <p className="font-mono font-semibold text-[#292820] tabular-nums mt-0.5">{epoch} / 24</p>
                  </div>
                  <div>
                    <p className="text-[#777469]">Accuracy</p>
                    <p className="font-mono font-semibold text-[#777C61] tabular-nums mt-0.5">
                      {(computeEpochCurve(epoch, learningRate).acc * 100).toFixed(1)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[#777469]">Loss</p>
                    <p className="font-mono font-semibold text-[#AD7961] tabular-nums mt-0.5">
                      {computeEpochCurve(epoch, learningRate).loss.toFixed(3)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeLesson === 4 && (
            <div className="space-y-6">
              <div>
                <p className="font-mono text-xs text-[#AD7961]">Lesson 4</p>
                <h2 className="font-display text-2xl font-semibold text-[#292820] mt-1">
                  Why image variety matters.
                </h2>
                <p className="text-sm text-[#777469] mt-2">
                  If you only show a model one white mug from straight ahead, it memorizes the background instead of the object.
                </p>
              </div>

              <div className="rounded-xl overflow-hidden border border-[#D9D3C8]">
                <img
                  src={VARIETY_STUDY_IMG}
                  alt="Diverse cups and bottles showing material and angle variety"
                  referrerPolicy="no-referrer"
                  className="w-full h-56 object-cover"
                />
              </div>

              <div className="bg-[#F4F1EA] border border-[#D9D3C8] rounded-xl p-5 space-y-4">
                <label className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-[#292820]">Training Dataset Diversity Level</span>
                  <span className="font-mono text-xs text-[#777469] tabular-nums">
                    Level {varietyLevel} / 4
                  </span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={1}
                  value={varietyLevel}
                  onChange={(e) => setVarietyLevel(Number(e.target.value))}
                  className="w-full accent-[#777C61]"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 text-xs">
                  <div className="bg-[#FFFFFF] p-3.5 rounded-lg border border-[#D9D3C8]">
                    <p className="text-[#777469]">Included Variations</p>
                    <p className="text-[#292820] font-medium mt-1">
                      {varietyLevel === 1 && 'Single ceramic mug on white desk'}
                      {varietyLevel === 2 && 'Added tilted angles and wooden table'}
                      {varietyLevel === 3 && 'Added glass, stainless steel, and side shadows'}
                      {varietyLevel === 4 && 'Full lighting, scale, color, and background variety'}
                    </p>
                  </div>
                  <div className="bg-[#FFFFFF] p-3.5 rounded-lg border border-[#D9D3C8]">
                    <p className="text-[#777469]">Unseen Test Generalization</p>
                    <p className="font-mono text-lg font-semibold text-[#777C61] tabular-nums mt-0.5">
                      {varietyLevel === 1 ? '44%' : varietyLevel === 2 ? '68%' : varietyLevel === 3 ? '84%' : '94%'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeLesson === 5 && (
            <div className="space-y-6">
              <div>
                <p className="font-mono text-xs text-[#AD7961]">Lesson 5</p>
                <h2 className="font-display text-2xl font-semibold text-[#292820] mt-1">
                  Understanding predictions and confidence scores.
                </h2>
                <p className="text-sm text-[#777469] mt-2">
                  Classifiers distribute 100% probability across known labels. Thresholding plus embedding similarity stops false certainty on unknown objects.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['clear_cup', 'Clear Ceramic Mug'],
                    ['pen_vs_pencil', 'Ambiguous Pen'],
                    ['potted_plant', 'Unknown Object (Plant)'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setScenario(id)}
                    className={`px-3.5 py-2 rounded-md text-xs font-medium border cursor-pointer ${
                      scenario === id
                        ? 'bg-[#777C61] text-[#FFFFFF] border-[#777C61]'
                        : 'bg-[#F4F1EA] text-[#292820] border-[#D9D3C8]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="bg-[#F4F1EA] border border-[#D9D3C8] rounded-xl p-5 space-y-4">
                <label className="flex items-center justify-between text-xs font-medium text-[#292820]">
                  <span>Confidence Threshold</span>
                  <span className="font-mono tabular-nums">{(threshold * 100).toFixed(0)}%</span>
                </label>
                <input
                  type="range"
                  min={0.35}
                  max={0.9}
                  step={0.05}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-full accent-[#777C61]"
                />

                <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-[#292820]">
                      {isUncertain ? "I don't recognize this object yet." : `Predicted: ${topScore.label}`}
                    </span>
                    <span className="font-mono text-xs text-[#777469] tabular-nums">
                      Similarity {(activeScenario.similarity * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="space-y-2">
                    {activeScenario.scores.map((s) => (
                      <div key={s.label} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span>{s.label}</span>
                          <span className="font-mono tabular-nums">{(s.prob * 100).toFixed(0)}%</span>
                        </div>
                        <div className="h-1.5 bg-[#E7E1D5] rounded-full overflow-hidden">
                          <div className="h-full bg-[#777C61]" style={{ width: `${s.prob * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeLesson === 6 && (
            <div className="space-y-6">
              <div>
                <p className="font-mono text-xs text-[#AD7961]">Lesson 6</p>
                <h2 className="font-display text-2xl font-semibold text-[#292820] mt-1">
                  How AI improves over time.
                </h2>
                <p className="text-sm text-[#777469] mt-2">
                  Safe autonomous learning never blindly trains on guesses. It combines verified user corrections, licensed dataset expansion, and evaluation gates.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  {
                    step: '01. Spot Uncertainty',
                    desc: 'Monitor low-confidence predictions and recurring confusion pairs like Pen vs Pencil.',
                  },
                  {
                    step: '02. Verified Collection',
                    desc: 'Fetch reusable licensed images, decode pixels, reject blur, and deduplicate with dHash.',
                  },
                  {
                    step: '03. Retrain & Split',
                    desc: 'Re-train on expanded data while keeping an independent held-out test set completely isolated.',
                  },
                  {
                    step: '04. Deploy or Rollback',
                    desc: 'Promote the new version only when test accuracy beats the current deployed model.',
                  },
                ].map((stage) => (
                  <div key={stage.step} className="p-4 rounded-xl bg-[#F4F1EA] border border-[#D9D3C8] space-y-1.5">
                    <p className="text-xs font-semibold text-[#292820]">{stage.step}</p>
                    <p className="text-xs text-[#777469] leading-relaxed">{stage.desc}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-[#D9D3C8]">
                <p className="text-xs text-[#777469] tabular-nums">
                  Current platform repository: {firebaseStatus?.totalImages ?? 600} verified images ready for training.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('studio')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[#777C61] text-[#FFFFFF] text-xs font-medium hover:bg-[#666B52] cursor-pointer self-start"
                >
                  Open Model Studio
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
