import { useEffect, useState } from 'react';
import { ArrowRight, Upload, Sparkles, CheckCircle2, HelpCircle } from 'lucide-react';
import { usePlatform } from '../context/PlatformContext';
import { loadImageElement, predictWithClassifier, type PredictionResult } from '../ml/visionEngine';

interface DemoSample {
  imageId: string;
  categoryName: string;
  categorySlug: string;
  title: string;
  thumbnailUrl: string;
  url: string;
}

const HERO_IMAGE = '/src/assets/images/hero_everyday_objects_1794773001754.jpg';

export function HomePage() {
  const {
    navigate,
    projects,
    savedModels,
    activeClassifier,
    ensureStarterModel,
    starterStatus,
    firebaseStatus,
  } = usePlatform();

  const [demoSamples, setDemoSamples] = useState<DemoSample[]>([]);
  const [selectedSample, setSelectedSample] = useState<DemoSample | null>(null);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [demoError, setDemoError] = useState('');
  const [heroLoaded, setHeroLoaded] = useState(true);

  useEffect(() => {
    const slugs = ['pens', 'books', 'water-bottles', 'computer-mice', 'watches', 'cups'];
    Promise.all(
      slugs.map((slug) =>
        fetch(`/api/dataset/images?category=${slug}&limit=1`)
          .then((r) => r.json())
          .then((d) => d.images?.[0] as DemoSample | undefined)
          .catch(() => undefined),
      ),
    ).then((items) => {
      const valid = items.filter((x): x is DemoSample => Boolean(x));
      setDemoSamples(valid);
    });
  }, []);

  const runDemoRecognition = async (sample: DemoSample) => {
    setSelectedSample(sample);
    setPrediction(null);
    setDemoError('');
    setAnalyzing(true);
    try {
      const classifier = activeClassifier || (await ensureStarterModel());
      if (!classifier) {
        setDemoError('Reference model is still preparing. Please try again in a moment.');
        setAnalyzing(false);
        return;
      }
      const img = await loadImageElement(sample.url);
      const res = await predictWithClassifier(classifier, img, 0.55);
      setPrediction(res);
    } catch (err) {
      setDemoError(err instanceof Error ? err.message : 'Unable to analyze image');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCustomDemoFile = async (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    const customSample: DemoSample = {
      imageId: 'custom_demo',
      categoryName: 'Uploaded Photo',
      categorySlug: 'custom',
      title: file.name,
      thumbnailUrl: objectUrl,
      url: objectUrl,
    };
    await runDemoRecognition(customSample);
  };

  return (
    <div className="space-y-24 pb-24">
      {/* Hero Section */}
      <section className="max-w-[1280px] mx-auto px-5 sm:px-8 pt-12 lg:pt-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
            <p className="text-sm text-[#777469]">
              Interactive Machine Learning Platform
              <span className="mx-2" aria-hidden="true">·</span>
              <span className="tabular-nums">{firebaseStatus?.totalImages ?? 600} Validated Examples</span>
            </p>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.5rem] font-semibold leading-[1.08] text-[#292820] [text-wrap:balance]">
              See How AI Learns.
            </h1>
            <p className="text-lg sm:text-xl text-[#777469] leading-relaxed max-w-xl">
              Teach a machine to recognize the world, one example at a time.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <button
                type="button"
                onClick={() => navigate('studio')}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-[#777C61] text-[#FFFFFF] text-sm font-medium hover:bg-[#666B52] transition-colors cursor-pointer whitespace-nowrap"
              >
                Start Learning
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => navigate('explore')}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-[#FFFFFF] border border-[#D9D3C8] text-[#292820] text-sm font-medium hover:bg-[#E7E1D5]/60 transition-colors cursor-pointer whitespace-nowrap"
              >
                Explore Examples
              </button>
            </div>
          </div>

          <div className="lg:col-span-6 flex">
            <div className="w-full rounded-xl overflow-hidden border border-[#D9D3C8] bg-[#E7E1D5] flex flex-col">
              {heroLoaded ? (
                <img
                  src={HERO_IMAGE}
                  alt="Everyday objects on warm paper: fountain pen, ceramic cup, linen notebook, and brass keys"
                  referrerPolicy="no-referrer"
                  onError={() => setHeroLoaded(false)}
                  className="w-full h-72 sm:h-96 lg:h-full object-cover"
                />
              ) : (
                <div className="w-full h-72 sm:h-96 lg:h-full flex items-center justify-center p-8 text-center text-sm text-[#777469]">
                  Everyday objects arranged for visual pattern recognition
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Three-Step Process */}
      <section className="max-w-[1280px] mx-auto px-5 sm:px-8">
        <div className="border-t border-[#D9D3C8] pt-12">
          <h2 className="font-display text-2xl sm:text-3xl font-semibold text-[#292820] mb-8">
            How teaching a computer works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-7 space-y-3">
              <p className="font-mono text-xs text-[#AD7961] tabular-nums">01</p>
              <h3 className="font-display text-xl font-semibold text-[#292820]">Show it examples.</h3>
              <p className="text-sm text-[#777469] leading-relaxed">
                Gather photos of everyday objects from our validated library, upload your own, or capture live angles with your camera.
              </p>
            </div>
            <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-7 space-y-3">
              <p className="font-mono text-xs text-[#AD7961] tabular-nums">02</p>
              <h3 className="font-display text-xl font-semibold text-[#292820]">Let it learn.</h3>
              <p className="text-sm text-[#777469] leading-relaxed">
                A real neural network extracts visual shapes and textures, splits data safely, and optimizes its predictions across epochs.
              </p>
            </div>
            <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-7 space-y-3">
              <p className="font-mono text-xs text-[#AD7961] tabular-nums">03</p>
              <h3 className="font-display text-xl font-semibold text-[#292820]">See what it recognizes.</h3>
              <p className="text-sm text-[#777469] leading-relaxed">
                Test with unseen objects, inspect confidence scores, correct mistakes, and watch the model improve autonomously over time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Object-Recognition Demonstration */}
      <section className="max-w-[1280px] mx-auto px-5 sm:px-8">
        <div className="bg-[#E7E1D5]/55 border border-[#D9D3C8] rounded-2xl p-6 sm:p-10 space-y-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="space-y-2 max-w-2xl">
              <h2 className="font-display text-2xl sm:text-3xl font-semibold text-[#292820]">
                Try live object recognition
              </h2>
              <p className="text-sm sm:text-base text-[#777469]">
                Select any validated example below—or drop your own photo—to run real MobileNetV2 visual inference directly in your browser.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-[#FFFFFF] border border-[#D9D3C8] text-sm font-medium text-[#292820] hover:bg-[#F4F1EA] cursor-pointer whitespace-nowrap self-start">
              <Upload className="w-4 h-4 text-[#777C61]" />
              Test Your Photo
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.currentTarget.value = '';
                  if (f) void handleCustomDemoFile(f);
                }}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-4">
              {demoSamples.map((sample) => {
                const isSelected = selectedSample?.imageId === sample.imageId;
                return (
                  <button
                    key={sample.imageId}
                    type="button"
                    onClick={() => void runDemoRecognition(sample)}
                    className={`group text-left rounded-xl overflow-hidden border transition-colors bg-[#FFFFFF] cursor-pointer ${
                      isSelected ? 'border-[#777C61] ring-2 ring-[#777C61]/25' : 'border-[#D9D3C8] hover:border-[#777C61]'
                    }`}
                  >
                    <div className="aspect-[4/3] bg-[#E7E1D5] overflow-hidden">
                      <img
                        src={sample.thumbnailUrl}
                        alt={sample.categoryName}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                      />
                    </div>
                    <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-[#292820] truncate">{sample.categoryName}</span>
                      <span className="text-xs text-[#777469] shrink-0">Test</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="lg:col-span-5 bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-6 space-y-5 min-h-[290px] flex flex-col justify-between">
              {starterStatus.loading ? (
                <div className="space-y-4 my-auto">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-[#292820]">Preparing vision classifier</span>
                    <span className="font-mono text-xs text-[#777469] tabular-nums">{starterStatus.progress}%</span>
                  </div>
                  <div className="w-full h-2 bg-[#E7E1D5] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#777C61] transition-all duration-200"
                      style={{ width: `${starterStatus.progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-[#777469]">{starterStatus.phase}</p>
                </div>
              ) : analyzing ? (
                <div className="my-auto text-center space-y-2 py-8">
                  <p className="text-sm font-medium text-[#292820]">Extracting visual features...</p>
                  <p className="text-xs text-[#777469]">Computing embedding and class confidence</p>
                </div>
              ) : demoError ? (
                <div className="my-auto space-y-2 py-6">
                  <p className="text-sm font-medium text-[#AD7961]">{demoError}</p>
                </div>
              ) : prediction && selectedSample ? (
                <div className="space-y-5">
                  <div className="flex items-center gap-4">
                    <img
                      src={selectedSample.thumbnailUrl}
                      alt={selectedSample.title}
                      referrerPolicy="no-referrer"
                      className="w-16 h-16 rounded-lg object-cover border border-[#D9D3C8] shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-xs text-[#777469]">
                        True label: {selectedSample.categoryName}
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{prediction.latencyMs} ms</span>
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {prediction.isUnknown ? (
                          <HelpCircle className="w-4 h-4 text-[#AD7961] shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-[#777C61] shrink-0" />
                        )}
                        <p className="font-display text-lg font-semibold text-[#292820] truncate">
                          {prediction.isNothing
                            ? 'Nothing is displayed'
                            : prediction.isUnknown
                              ? "I don't recognize this object yet."
                              : prediction.predictedLabel}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2.5 pt-2 border-t border-[#D9D3C8]">
                    <p className="text-xs font-medium text-[#777469]">Top 3 predictions</p>
                    {prediction.topPredictions.map((cand) => (
                      <div key={cand.label} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[#292820] font-medium">{cand.label}</span>
                          <span className="font-mono text-[#777469] tabular-nums">
                            {(cand.probability * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-[#E7E1D5] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#777C61]"
                            style={{ width: `${Math.max(2, cand.probability * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pt-2 flex items-center justify-between text-xs text-[#777469]">
                    <span>Cosine similarity: {(prediction.centroidSimilarity * 100).toFixed(0)}%</span>
                    <button
                      type="button"
                      onClick={() => navigate('test')}
                      className="text-[#777C61] font-medium hover:underline cursor-pointer"
                    >
                      Open full Test Lab →
                    </button>
                  </div>
                </div>
              ) : (
                <div className="my-auto space-y-3 py-6">
                  <Sparkles className="w-5 h-5 text-[#777C61]" />
                  <p className="font-display text-base font-medium text-[#292820]">
                    Select an image on the left to inspect what the model sees
                  </p>
                  <p className="text-sm text-[#777469]">
                    Predictions use real MobileNetV2 embeddings trained across our 12 validated categories—never simulated percentages.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Educational Intro & Recent Projects */}
      <section className="max-w-[1280px] mx-auto px-5 sm:px-8 grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-5 bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-8 flex flex-col justify-between space-y-6">
          <div className="space-y-3">
            <h2 className="font-display text-2xl font-semibold text-[#292820]">
              What makes machine learning different?
            </h2>
            <p className="text-sm text-[#777469] leading-relaxed">
              Traditional software follows fixed rules written by hand. Machine learning discovers visual rules on its own by comparing hundreds of varied examples—learning which edges, proportions, and textures distinguish a pen from a pencil.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('learn')}
            className="inline-flex items-center gap-2 text-sm font-medium text-[#777C61] hover:underline self-start cursor-pointer"
          >
            Explore 6 interactive lessons
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <div className="lg:col-span-7 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-semibold text-[#292820]">
              Example & Recent Projects
            </h2>
            <button
              type="button"
              onClick={() => navigate('studio')}
              className="text-sm font-medium text-[#777C61] hover:underline cursor-pointer"
            >
              New Studio Project →
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {projects.slice(0, 4).map((proj) => {
              const totalImgs = proj.categories.reduce((acc, c) => acc + c.images.length, 0);
              return (
                <button
                  key={proj.projectId}
                  type="button"
                  onClick={() => navigate('studio', { projectId: proj.projectId })}
                  className="text-left bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-5 hover:border-[#777C61] transition-colors space-y-3 cursor-pointer"
                >
                  <div className="space-y-1">
                    <p className="text-xs text-[#777469]">
                      {proj.isExample ? 'Example Project' : 'Saved Project'}
                      <span className="mx-1.5" aria-hidden="true">·</span>
                      <span className="tabular-nums">{proj.categories.length} categories</span>
                      <span className="mx-1.5" aria-hidden="true">·</span>
                      <span className="tabular-nums">{totalImgs} images</span>
                    </p>
                    <h3 className="font-display text-base font-semibold text-[#292820]">{proj.name}</h3>
                  </div>
                  <p className="text-xs text-[#777469] line-clamp-2">{proj.description}</p>
                </button>
              );
            })}

            {savedModels.slice(0, 2).map((mdl) => (
              <button
                key={mdl.modelId}
                type="button"
                onClick={() => navigate('models', { modelId: mdl.modelId })}
                className="text-left bg-[#E7E1D5]/50 border border-[#D9D3C8] rounded-xl p-5 hover:border-[#777C61] transition-colors space-y-2 cursor-pointer"
              >
                <p className="text-xs text-[#777469]">
                  Trained Model v{mdl.activeVersion}
                  <span className="mx-1.5" aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{(mdl.accuracy * 100).toFixed(1)}% accuracy</span>
                </p>
                <h3 className="font-display text-base font-semibold text-[#292820]">{mdl.name}</h3>
                <p className="text-xs text-[#777469] truncate">{mdl.categories.join(', ')}</p>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
