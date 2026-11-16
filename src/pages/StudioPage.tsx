import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Upload,
  Camera,
  Sparkles,
  Check,
  Save,
  SlidersHorizontal,
  FolderOpen,
  X,
} from 'lucide-react';
import { usePlatform, type StudioProjectItem } from '../context/PlatformContext';
import {
  trainTransferClassifier,
  predictWithClassifier,
  loadImageElement,
  type LoadedClassifier,
  type SerializedClassifierModel,
  type PredictionResult,
} from '../ml/visionEngine';

const STEPS = [
  '1. Project',
  '2. Categories',
  '3. Add Images',
  '4. Train Model',
  '5. Test Model',
  '6. Save Model',
];

export function StudioPage() {
  const {
    navParams,
    projects,
    firebaseStatus,
    session,
    sessionHeaders,
    syncSessionWorkspace,
    saveTrainedModel,
    setLiveClassifier,
    recordSessionPrediction,
    registerStopHandler,
    beginInFlightOp,
    endInFlightOp,
    educatorSettings,
    navigate,
  } = usePlatform();

  const [projectId, setProjectId] = useState(() => `proj_${Date.now().toString(36)}`);
  const [projectName, setProjectName] = useState('My First Object Classifier');
  const [projectDesc, setProjectDesc] = useState(
    'Teach the computer to distinguish everyday objects inside your isolated session workspace.',
  );
  const [categories, setCategories] = useState<StudioProjectItem['categories']>(
    () =>
      session?.categories?.length
        ? session.categories
        : [
            { categoryId: 'cat_1', name: 'Pen', slug: 'pens', images: [] },
            { categoryId: 'cat_2', name: 'Cup', slug: 'cups', images: [] },
          ],
  );
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;
  const loadedNavProjectRef = useRef<string | null>(null);

  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState('');

  // Training options & state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [epochs, setEpochs] = useState(20);
  const [learningRate, setLearningRate] = useState(0.0015);
  const [training, setTraining] = useState(false);
  const trainingCancelledRef = useRef(false);
  const [trainProgress, setTrainProgress] = useState({ phase: '', percent: 0 });
  const [trainError, setTrainError] = useState('');
  const [trainedClassifier, setTrainedClassifier] = useState<LoadedClassifier | null>(null);
  const [trainedSerialized, setTrainedSerialized] = useState<SerializedClassifierModel | null>(null);

  // Studio Test & Save state
  const [testPreviewUrl, setTestPreviewUrl] = useState('');
  const [testResult, setTestResult] = useState<PredictionResult | null>(null);
  const [modelNameToSave, setModelNameToSave] = useState('Session Object Recognizer');
  const [proposeForShared, setProposeForShared] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [savingModel, setSavingModel] = useState(false);

  // Webcam capture into a category
  const [captureTargetCatId, setCaptureTargetCatId] = useState<string | null>(null);
  const [cameraStreamReady, setCameraStreamReady] = useState(false);
  const [capturingFrame, setCapturingFrame] = useState(false);
  const [cameraNotice, setCameraNotice] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState('');

  // Load requested project from navParams once per projectId change
  useEffect(() => {
    if (!navParams.projectId || loadedNavProjectRef.current === navParams.projectId) return;
    const found = projects.find((p) => p.projectId === navParams.projectId);
    if (found) {
      loadedNavProjectRef.current = navParams.projectId;
      setProjectId(found.isExample ? `proj_${Date.now().toString(36)}` : found.projectId);
      setProjectName(found.name);
      setProjectDesc(found.description);
      categoriesRef.current = found.categories;
      setCategories(found.categories);
      setModelNameToSave(`${found.name} Model`);
      setTrainedClassifier(null);
      setTrainedSerialized(null);
      void syncSessionWorkspace({ categories: found.categories });
    }
  }, [navParams.projectId, projects, syncSessionWorkspace]);

  const closeCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraStreamReady(false);
    setCapturingFrame(false);
    setCameraNotice('');
    setCaptureTargetCatId(null);
  };

  useEffect(() => {
    if (captureTargetCatId && cameraStreamReady && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => {});
    }
  }, [captureTargetCatId, cameraStreamReady]);

  useEffect(() => {
    const unregister = registerStopHandler('studio-hardware-and-training', () => {
      trainingCancelledRef.current = true;
      closeCamera();
    });
    return () => {
      unregister();
      closeCamera();
    };
  }, [registerStopHandler]);

  const totalImages = categories.reduce((acc, c) => acc + c.images.length, 0);
  const readyCategoriesCount = categories.filter((c) => c.images.length >= 3).length;
  const activeStep = trainedSerialized
    ? saveStatus
      ? 6
      : 5
    : training
      ? 4
      : totalImages >= 6 && readyCategoriesCount >= 2
        ? 4
        : totalImages > 0
          ? 3
          : categories.length >= 2
            ? 2
            : 1;

  const updateCategoriesAndSync = (updater: (prev: StudioProjectItem['categories']) => StudioProjectItem['categories']) => {
    const next = updater(categoriesRef.current);
    categoriesRef.current = next;
    setCategories(next);
    void syncSessionWorkspace({ categories: next });
  };

  const handleLoadProject = (proj: StudioProjectItem) => {
    setProjectId(proj.isExample ? `proj_${Date.now().toString(36)}` : proj.projectId);
    setProjectName(proj.name);
    setProjectDesc(proj.description);
    categoriesRef.current = proj.categories;
    setCategories(proj.categories);
    setModelNameToSave(`${proj.name} Model`);
    setTrainedClassifier(null);
    setTrainedSerialized(null);
    setSaveStatus('');
    void syncSessionWorkspace({ categories: proj.categories });
  };

  const handleAddCategory = () => {
    const clean = newCategoryName.trim();
    if (!clean) return;
    const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    updateCategoriesAndSync((prev) => [
      ...prev,
      { categoryId: `cat_${Date.now().toString(36)}`, name: clean, slug, images: [] },
    ]);
    setNewCategoryName('');
  };

  const handlePullBuiltInSamples = async (categoryId: string, catName: string) => {
    const matchSlug =
      firebaseStatus?.categories.find((c) => c.name.toLowerCase() === catName.toLowerCase())?.slug ||
      catName.toLowerCase().replace(/\s+/g, '-');
    const res = await fetch(`/api/dataset/images?category=${encodeURIComponent(matchSlug)}&limit=10`);
    if (!res.ok) return;
    const data = await res.json();
    const fetched = (data.images || []) as Array<{
      imageId: string;
      url: string;
      thumbnailUrl: string;
      title: string;
      sha256: string;
      source: string;
    }>;
    if (fetched.length === 0) return;

    updateCategoriesAndSync((prev) =>
      prev.map((c) => {
        if (c.categoryId !== categoryId) return c;
        const existingIds = new Set(c.images.map((i) => i.imageId));
        const toAdd = fetched
          .filter((f) => !existingIds.has(f.imageId))
          .map((f) => ({
            imageId: f.imageId,
            url: f.url,
            thumbnailUrl: f.thumbnailUrl,
            title: f.title,
            sha256: f.sha256,
            source: f.source,
          }));
        return { ...c, images: [...c.images, ...toAdd] };
      }),
    );
  };

  const handleUploadToCategory = async (categoryId: string, catName: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const catSlug = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    for (const file of Array.from(files)) {
      beginInFlightOp();
      try {
        const form = new FormData();
        form.append('image', file);
        form.append('categorySlug', catSlug);
        form.append('categoryName', catName);

        const res = await fetch('/api/sessions/upload', {
          method: 'POST',
          headers: sessionHeaders(),
          body: form,
        });
        const data = await res.json();
        if (res.ok && data.image) {
          updateCategoriesAndSync((prev) =>
            prev.map((c) =>
              c.categoryId === categoryId
                ? {
                    ...c,
                    images: [
                      ...c.images,
                      {
                        imageId: data.image.imageId,
                        url: data.image.url,
                        thumbnailUrl: data.image.thumbnailUrl,
                        title: data.image.title,
                        sha256: data.image.sha256,
                        source: 'Session Upload',
                      },
                    ],
                  }
                : c,
            ),
          );
        } else {
          setTrainError(data.error || 'One or more images failed validation.');
        }
      } finally {
        endInFlightOp();
      }
    }
  };

  const openCameraForCategory = async (catId: string) => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraStreamReady(false);
    setCameraError('');
    setCameraNotice('');
    setCaptureTargetCatId(catId);
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      streamRef.current = stream;
      setCameraStreamReady(true);
    } catch {
      setCameraError('Camera permission denied or unavailable.');
    }
  };

  const captureFrameToCategory = async () => {
    if (!videoRef.current || !captureTargetCatId || capturingFrame) return;
    if (videoRef.current.readyState < 2) {
      setCameraError('Camera stream is still warming up. Wait a moment and try again.');
      return;
    }
    const cat = categoriesRef.current.find((c) => c.categoryId === captureTargetCatId);
    if (!cat) return;

    setCameraError('');
    setCameraNotice('');
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 480;
    canvas.height = videoRef.current.videoHeight || 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) return;

    setCapturingFrame(true);
    beginInFlightOp();
    try {
      const file = new File([blob], `webcam_${Date.now()}.jpg`, { type: 'image/jpeg' });
      const form = new FormData();
      form.append('image', file);
      form.append('categorySlug', cat.slug);
      form.append('categoryName', cat.name);

      const res = await fetch('/api/sessions/upload', {
        method: 'POST',
        headers: sessionHeaders(),
        body: form,
      });
      const data = await res.json();
      if (res.ok && data.image) {
        updateCategoriesAndSync((prev) =>
          prev.map((c) =>
            c.categoryId === captureTargetCatId
              ? {
                  ...c,
                  images: [
                    ...c.images,
                    {
                      imageId: data.image.imageId,
                      url: data.image.url,
                      thumbnailUrl: data.image.thumbnailUrl,
                      title: 'Webcam Capture',
                      sha256: data.image.sha256,
                      source: 'Session Webcam',
                    },
                  ],
                }
              : c,
          ),
        );
        setCameraNotice(`Photo added to ${cat.name}.`);
      } else {
        setCameraError(data.error || 'Could not save captured photo. Try a slightly different angle.');
      }
    } catch {
      setCameraError('Network error while saving captured photo.');
    } finally {
      setCapturingFrame(false);
      endInFlightOp();
    }
  };

  const handleTrainModel = async () => {
    setTrainError('');
    setSaveStatus('');
    trainingCancelledRef.current = false;
    setTraining(true);
    setTrainProgress({ phase: 'Preparing dataset splits...', percent: 2 });

    try {
      const samples = categories.flatMap((cat) =>
        cat.images.map((im) => ({
          imageId: im.imageId,
          label: cat.name,
          url: im.url,
          sha256: im.sha256,
        })),
      );

      const { classifier, serialized } = await trainTransferClassifier(samples, {
        epochs,
        learningRate,
        onProgress: (info) => {
          if (!trainingCancelledRef.current) {
            setTrainProgress({ phase: info.phase, percent: info.percent });
          }
        },
      });

      if (trainingCancelledRef.current) return;

      setTrainedClassifier(classifier);
      setTrainedSerialized(serialized);
      setLiveClassifier(classifier, {
        modelId: `smdl_${projectId}`,
        name: modelNameToSave || projectName,
        version: 1,
        isShared: false,
      });

      await syncSessionWorkspace({
        categories,
        project: {
          projectId,
          name: projectName,
          description: projectDesc,
          categories,
          status: 'trained',
        },
      });
    } catch (err) {
      if (!trainingCancelledRef.current) {
        setTrainError(err instanceof Error ? err.message : 'Training failed.');
      }
    } finally {
      setTraining(false);
    }
  };

  const handleTestFileInStudio = async (file: File) => {
    if (!trainedClassifier) return;
    const url = URL.createObjectURL(file);
    setTestPreviewUrl(url);
    const img = await loadImageElement(url);
    const res = await predictWithClassifier(trainedClassifier, img, session?.sessionSettings.confidenceThreshold ?? 0.62);
    setTestResult(res);
    void recordSessionPrediction({
      modelId: `smdl_${projectId}`,
      modelName: modelNameToSave || projectName,
      predictedLabel: res.predictedLabel,
      confidence: res.confidence,
      isUnknown: res.isUnknown,
    });
  };

  const handleSaveModel = async () => {
    if (!trainedSerialized) return;
    setSavingModel(true);
    setSaveStatus('');
    try {
      const saved = await saveTrainedModel({
        name: modelNameToSave.trim() || `${projectName} Model`,
        projectId,
        serialized: trainedSerialized,
        proposeForShared,
      });
      let msg = `Saved "${saved.model.name}" v${saved.model.activeVersion} to your private session (${(saved.model.accuracy * 100).toFixed(1)}% test accuracy).`;
      if (saved.proposalStatus === 'submitted') {
        msg += ' Submitted passing evaluation candidate to Educator Shared Library review.';
      } else if (saved.proposalStatus === 'below_threshold') {
        msg += ' Did not meet minimum shared library evaluation criteria (≥65% accuracy, ≥6 images).';
      }
      setSaveStatus(msg);
    } catch (err) {
      setSaveStatus(err instanceof Error ? err.message : 'Failed to save model');
    } finally {
      setSavingModel(false);
    }
  };

  return (
    <div className="max-w-[1280px] mx-auto px-5 sm:px-8 py-12 space-y-10">
      <div className="space-y-6 border-b border-[#D9D3C8] pb-8">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div>
            <p className="text-xs text-[#777469]">
              Model Training Studio · Isolated to Session {session?.sessionId}
            </p>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#292820] mt-1">
              Build &amp; Train Your Own Classifier
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Open example or session project"
              value=""
              onChange={(e) => {
                const found = projects.find((p) => p.projectId === e.target.value);
                if (found) handleLoadProject(found);
              }}
              className="px-3 py-2 text-xs rounded-md border border-[#D9D3C8] bg-[#FFFFFF] text-[#292820]"
            >
              <option value="">Load Example or Session Project...</option>
              {projects.map((p) => (
                <option key={p.projectId} value={p.projectId}>
                  {p.isExample ? `[Example] ${p.name}` : `[Session] ${p.name}`}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                void syncSessionWorkspace({
                  categories,
                  project: {
                    projectId,
                    name: projectName,
                    description: projectDesc,
                    categories,
                    status: trainedSerialized ? 'trained' : 'ready',
                  },
                }).then(() => setSaveStatus('Saved draft inside your current session.'))
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md border border-[#D9D3C8] bg-[#FFFFFF] text-[#292820] hover:bg-[#E7E1D5]/50 cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Save Draft
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {STEPS.map((label, idx) => {
            const stepNum = idx + 1;
            const reached = activeStep >= stepNum;
            return (
              <div
                key={label}
                className={`px-3 py-2 rounded-md border text-xs font-medium text-center ${
                  reached
                    ? 'bg-[#FFFFFF] border-[#777C61] text-[#292820]'
                    : 'bg-[#E7E1D5]/40 border-[#D9D3C8] text-[#777469]'
                }`}
              >
                {label}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step 1: Project Info */}
      <section className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-[#777469]">Workspace Project Name</span>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="w-full px-3.5 py-2 text-sm rounded-md border border-[#D9D3C8] bg-[#F4F1EA] text-[#292820]"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-[#777469]">Notes</span>
          <input
            type="text"
            value={projectDesc}
            onChange={(e) => setProjectDesc(e.target.value)}
            className="w-full px-3.5 py-2 text-sm rounded-md border border-[#D9D3C8] bg-[#F4F1EA] text-[#292820]"
          />
        </label>
      </section>

      {/* Step 2 & 3: Categories & Training Images */}
      <section className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-[#292820]">
              Object Categories ({categories.length})
            </h2>
            <p className="text-xs text-[#777469] mt-0.5">
              Private uploads stay strictly inside your session and are cleared when you finish. Limit: {educatorSettings?.maxUploadImagesPerSession ?? 40} session uploads.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
              placeholder="New category name..."
              className="px-3.5 py-2 text-sm rounded-md border border-[#D9D3C8] bg-[#FFFFFF] text-[#292820]"
            />
            <button
              type="button"
              onClick={handleAddCategory}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#777C61] text-[#FFFFFF] text-sm font-medium hover:bg-[#666B52] cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              Add Category
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {categories.map((cat) => (
            <div key={cat.categoryId} className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-3 border-b border-[#D9D3C8] pb-3">
                {editingCatId === cat.categoryId ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="text"
                      value={editingCatName}
                      onChange={(e) => setEditingCatName(e.target.value)}
                      className="px-2.5 py-1 text-sm rounded border border-[#777C61] bg-[#F4F1EA]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        updateCategoriesAndSync((prev) =>
                          prev.map((c) =>
                            c.categoryId === cat.categoryId ? { ...c, name: editingCatName.trim() || c.name } : c,
                          ),
                        );
                        setEditingCatId(null);
                      }}
                      className="text-xs font-medium text-[#777C61] cursor-pointer"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <div>
                    <h3 className="font-display text-lg font-semibold text-[#292820]">{cat.name}</h3>
                    <p className="text-xs text-[#777469] font-mono tabular-nums">
                      {cat.images.length} example{cat.images.length === 1 ? '' : 's'}
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCatId(cat.categoryId);
                      setEditingCatName(cat.name);
                    }}
                    className="text-xs text-[#777469] hover:text-[#292820] cursor-pointer"
                  >
                    Rename
                  </button>
                  {categories.length > 2 && (
                    <button
                      type="button"
                      onClick={() =>
                        updateCategoriesAndSync((prev) => prev.filter((c) => c.categoryId !== cat.categoryId))
                      }
                      aria-label={`Delete ${cat.name}`}
                      className="p-1.5 text-[#777469] hover:text-[#AD7961] cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#D9D3C8] bg-[#F4F1EA] text-xs font-medium text-[#292820] hover:bg-[#E7E1D5] cursor-pointer">
                  <Upload className="w-3.5 h-3.5 text-[#777C61]" />
                  Upload Images
                  <input
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(e) => {
                      const files = e.target.files;
                      if (files && files.length > 0) void handleUploadToCategory(cat.categoryId, cat.name, files);
                      e.currentTarget.value = '';
                    }}
                  />
                </label>

                <button
                  type="button"
                  onClick={() => void openCameraForCategory(cat.categoryId)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#D9D3C8] bg-[#F4F1EA] text-xs font-medium text-[#292820] hover:bg-[#E7E1D5] cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5 text-[#777C61]" />
                  Webcam
                </button>

                <button
                  type="button"
                  onClick={() => void handlePullBuiltInSamples(cat.categoryId, cat.name)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#D9D3C8] bg-[#FFFFFF] text-xs font-medium text-[#777C61] hover:bg-[#F4F1EA] cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Add Library Samples
                </button>
              </div>

              {cat.images.length === 0 ? (
                <div className="h-24 rounded-lg border border-dashed border-[#D9D3C8] bg-[#F4F1EA]/50 flex items-center justify-center text-xs text-[#777469]">
                  No images added yet
                </div>
              ) : (
                <div className="grid grid-cols-5 sm:grid-cols-6 gap-2 max-h-44 overflow-y-auto pr-1">
                  {cat.images.map((im) => (
                    <div key={im.imageId} className="relative group aspect-square rounded overflow-hidden bg-[#E7E1D5]">
                      <img
                        src={im.thumbnailUrl}
                        alt={im.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          updateCategoriesAndSync((prev) =>
                            prev.map((c) =>
                              c.categoryId === cat.categoryId
                                ? { ...c, images: c.images.filter((x) => x.imageId !== im.imageId) }
                                : c,
                            ),
                          )
                        }
                        aria-label="Remove image"
                        className="absolute top-1 right-1 w-5 h-5 rounded bg-[#292820]/75 text-[#FFFFFF] opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {captureTargetCatId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#292820]/50 p-4">
          <div className="w-full max-w-md bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-[#292820]">
                Capture Examples for {categories.find((c) => c.categoryId === captureTargetCatId)?.name}
              </h3>
              <button type="button" onClick={closeCamera} className="text-[#777469] cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            {cameraError && !cameraStreamReady ? (
              <p className="text-sm text-[#AD7961]">{cameraError}</p>
            ) : (
              <>
                <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-lg bg-[#292820] aspect-video object-cover" />
                {cameraError && <p className="text-xs text-[#AD7961]">{cameraError}</p>}
                {cameraNotice && <p className="text-xs text-[#777C61] font-medium">{cameraNotice}</p>}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeCamera}
                    className="px-4 py-2 text-xs rounded-md border border-[#D9D3C8] cursor-pointer"
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    disabled={!cameraStreamReady || capturingFrame}
                    onClick={() => void captureFrameToCategory()}
                    className="px-4 py-2 text-xs font-medium rounded-md bg-[#777C61] text-[#FFFFFF] disabled:opacity-50 cursor-pointer"
                  >
                    {capturingFrame ? 'Saving...' : 'Take Photo'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Step 4: Train Model */}
      <section className="bg-[#E7E1D5]/55 border border-[#D9D3C8] rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-[#292820]">Train Session Model</h2>
            <p className="text-xs text-[#777469] mt-0.5">
              Deduplicates samples, performs stratified Train / Validation / Independent Test splits, and trains MobileNetV2 transfer layers.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowAdvanced((s) => !s)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-[#D9D3C8] bg-[#FFFFFF] text-xs font-medium text-[#292820] cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {showAdvanced ? 'Hide Options' : 'Advanced Options'}
            </button>
            <button
              type="button"
              disabled={training || readyCategoriesCount < 2}
              onClick={() => void handleTrainModel()}
              className="px-6 py-2.5 rounded-md bg-[#777C61] text-[#FFFFFF] text-sm font-medium hover:bg-[#666B52] disabled:opacity-50 cursor-pointer"
            >
              {training ? 'Training...' : 'Train Model'}
            </button>
          </div>
        </div>

        {showAdvanced && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#FFFFFF] p-4 rounded-xl border border-[#D9D3C8]">
            <label className="space-y-1 text-xs">
              <span className="font-medium text-[#292820]">Epochs ({epochs})</span>
              <input
                type="range"
                min={8}
                max={50}
                value={epochs}
                onChange={(e) => setEpochs(Number(e.target.value))}
                className="w-full accent-[#777C61]"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-[#292820]">Learning Rate ({learningRate})</span>
              <select
                value={learningRate}
                onChange={(e) => setLearningRate(Number(e.target.value))}
                className="w-full px-3 py-1.5 rounded border border-[#D9D3C8] bg-[#F4F1EA]"
              >
                <option value={0.0008}>0.0008 (Conservative)</option>
                <option value={0.0015}>0.0015 (Balanced)</option>
                <option value={0.003}>0.0030 (Fast)</option>
              </select>
            </label>
          </div>
        )}

        {training && (
          <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-5 space-y-2">
            <div className="flex justify-between text-xs font-medium text-[#292820]">
              <span>{trainProgress.phase}</span>
              <span className="font-mono tabular-nums">{trainProgress.percent}%</span>
            </div>
            <div className="h-2 bg-[#E7E1D5] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#777C61] transition-all duration-200"
                style={{ width: `${trainProgress.percent}%` }}
              />
            </div>
          </div>
        )}

        {trainError && <p className="text-sm text-[#AD7961]">{trainError}</p>}

        {trainedSerialized && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
            <div className="lg:col-span-7 bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold text-[#292820]">
                  Independent Evaluation Metrics
                </h3>
                <span className="text-xs text-[#777C61] font-medium inline-flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Verified Split
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div className="bg-[#F4F1EA] p-3 rounded-lg">
                  <p className="text-xs text-[#777469]">Test Accuracy</p>
                  <p className="font-mono text-xl font-semibold text-[#292820] tabular-nums mt-0.5">
                    {(trainedSerialized.metrics.testAccuracy * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="bg-[#F4F1EA] p-3 rounded-lg">
                  <p className="text-xs text-[#777469]">Precision / Recall</p>
                  <p className="font-mono text-base font-semibold text-[#292820] tabular-nums mt-1">
                    {(trainedSerialized.metrics.precision * 100).toFixed(0)}% /{' '}
                    {(trainedSerialized.metrics.recall * 100).toFixed(0)}%
                  </p>
                </div>
                <div className="bg-[#F4F1EA] p-3 rounded-lg">
                  <p className="text-xs text-[#777469]">Split (Tr/Va/Te)</p>
                  <p className="font-mono text-sm font-semibold text-[#292820] tabular-nums mt-1">
                    {trainedSerialized.metrics.trainCount}/{trainedSerialized.metrics.valCount}/
                    {trainedSerialized.metrics.testCount}
                  </p>
                </div>
                <div className="bg-[#F4F1EA] p-3 rounded-lg">
                  <p className="text-xs text-[#777469]">Latency</p>
                  <p className="font-mono text-xl font-semibold text-[#292820] tabular-nums mt-0.5">
                    {trainedSerialized.metrics.latencyMs}ms
                  </p>
                </div>
              </div>

              <div className="pt-4 border-t border-[#D9D3C8] space-y-3">
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={modelNameToSave}
                    onChange={(e) => setModelNameToSave(e.target.value)}
                    placeholder="Model name..."
                    className="flex-1 px-3.5 py-2 text-sm rounded-md border border-[#D9D3C8] bg-[#F4F1EA]"
                  />
                  <button
                    type="button"
                    disabled={savingModel}
                    onClick={() => void handleSaveModel()}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-md bg-[#777C61] text-[#FFFFFF] text-sm font-medium hover:bg-[#666B52] cursor-pointer whitespace-nowrap"
                  >
                    <Save className="w-4 h-4" />
                    {savingModel ? 'Saving...' : 'Save Session Model'}
                  </button>
                </div>
                {educatorSettings?.allowSharedModelPromotion && (
                  <label className="flex items-center gap-2 text-xs text-[#777469] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={proposeForShared}
                      onChange={(e) => setProposeForShared(e.target.checked)}
                      className="accent-[#777C61]"
                    />
                    <span>Propose model weights for Educator Shared Library review (never overwrites existing shared models)</span>
                  </label>
                )}
              </div>
              {saveStatus && <p className="text-xs text-[#777C61] font-medium">{saveStatus}</p>}
            </div>

            <div className="lg:col-span-5 bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold text-[#292820]">Quick Test</h3>
                <button
                  type="button"
                  onClick={() => navigate('test')}
                  className="text-xs font-medium text-[#777C61] hover:underline cursor-pointer"
                >
                  Open Live Test Lab →
                </button>
              </div>
              <label className="block border border-dashed border-[#D9D3C8] rounded-lg p-4 text-center text-xs text-[#777469] hover:border-[#777C61] cursor-pointer bg-[#F4F1EA]/50">
                Drop or select a test photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.currentTarget.value = '';
                    if (f) void handleTestFileInStudio(f);
                  }}
                />
              </label>
              {testPreviewUrl && (
                <div className="flex items-center gap-4">
                  <img
                    src={testPreviewUrl}
                    alt="Studio test preview"
                    className="w-16 h-16 rounded-lg object-cover border border-[#D9D3C8]"
                  />
                  {testResult && (
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#292820]">
                        {testResult.isNothing
                          ? 'Nothing is displayed'
                          : testResult.isUnknown
                            ? "I don't recognize this object yet."
                            : testResult.predictedLabel}
                      </p>
                      <p className="text-xs text-[#777469] font-mono tabular-nums">
                        {testResult.isNothing
                          ? `${testResult.latencyMs}ms`
                          : `${(testResult.confidence * 100).toFixed(1)}% · ${testResult.latencyMs}ms`}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
