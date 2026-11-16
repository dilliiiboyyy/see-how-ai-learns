import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  Upload,
  CheckCircle2,
  XCircle,
  HelpCircle,
  RotateCcw,
} from 'lucide-react';
import { usePlatform } from '../context/PlatformContext';
import {
  loadImageElement,
  predictWithClassifier,
  type PredictionResult,
} from '../ml/visionEngine';

export function TestPage() {
  const {
    activeClassifier,
    activeModelMeta,
    sharedModels,
    sessionModels,
    setActiveModelFromSaved,
    ensureStarterModel,
    starterStatus,
    firebaseStatus,
    session,
    educatorSettings,
    syncSessionWorkspace,
    recordSessionPrediction,
    submitSessionFeedback,
    registerStopHandler,
  } = usePlatform();

  const [mode, setMode] = useState<'upload' | 'webcam'>('upload');
  const [threshold, setThreshold] = useState(session?.sessionSettings.confidenceThreshold ?? 0.62);
  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState('');
  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Webcam state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopActiveRef = useRef(false);
  const loopTimerRef = useRef<number | null>(null);

  // Feedback state
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [correctedLabel, setCorrectedLabel] = useState('');
  const [approveForShared, setApproveForShared] = useState(true);
  const [feedbackSavedMsg, setFeedbackSavedMsg] = useState('');

  useEffect(() => {
    if (!activeClassifier && !starterStatus.loading) {
      void ensureStarterModel();
    }
  }, [activeClassifier, starterStatus.loading, ensureStarterModel]);

  const stopCamera = () => {
    loopActiveRef.current = false;
    if (loopTimerRef.current !== null) {
      window.clearTimeout(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  };

  useEffect(() => {
    const unregister = registerStopHandler('test-page-camera', stopCamera);
    return () => {
      unregister();
      stopCamera();
    };
  }, [registerStopHandler]);

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => {});
    }
  }, [cameraActive]);

  const acquireCameraStream = async (): Promise<MediaStream> => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
    } catch {
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
  };

  const startCamera = async () => {
    stopCamera();
    setCameraError('');
    setCapturedPhotoUrl('');
    setPrediction(null);
    setFeedbackSavedMsg('');
    try {
      const classifier = activeClassifier || (await ensureStarterModel());
      if (!classifier) {
        setCameraError('Model is still initializing. Please try again in a moment.');
        return;
      }
      const stream = await acquireCameraStream();
      streamRef.current = stream;
      setCameraActive(true);
      let recordedCameraSample = false;

      loopActiveRef.current = true;
      const tick = async () => {
        if (!loopActiveRef.current) return;
        if (videoRef.current && videoRef.current.readyState >= 2) {
          try {
            const res = await predictWithClassifier(classifier, videoRef.current, thresholdRef.current);
            if (loopActiveRef.current) {
              setPrediction(res);
              if (!recordedCameraSample && !res.isNothing) {
                recordedCameraSample = true;
                void recordSessionPrediction({
                  modelId: activeModelMeta?.modelId || 'mdl_builtin_reference',
                  modelName: activeModelMeta?.name || 'Reference Model',
                  predictedLabel: res.predictedLabel,
                  confidence: res.confidence,
                  isUnknown: res.isUnknown,
                });
              }
            }
          } catch {
            // ignore transient frame error
          }
        }
        if (loopActiveRef.current) {
          loopTimerRef.current = window.setTimeout(() => void tick(), 260);
        }
      };
      loopTimerRef.current = window.setTimeout(() => void tick(), 140);
    } catch {
      setCameraError('Camera permission was denied or no camera device is available.');
    }
  };

  const takePhotoFromWebcam = async () => {
    if (!videoRef.current || videoRef.current.readyState < 2) return;
    setErrorMsg('');
    setFeedbackSavedMsg('');
    setFeedbackOpen(false);
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    stopCamera();
    setCapturedPhotoUrl(dataUrl);
    setAnalyzing(true);
    try {
      const classifier = activeClassifier || (await ensureStarterModel());
      if (!classifier) {
        setErrorMsg('Model is still initializing.');
        return;
      }
      const res = await predictWithClassifier(classifier, canvas, thresholdRef.current);
      setPrediction(res);
      if (!res.isNothing) {
        void recordSessionPrediction({
          modelId: activeModelMeta?.modelId || 'mdl_builtin_reference',
          modelName: activeModelMeta?.name || 'Reference Model',
          predictedLabel: res.predictedLabel,
          confidence: res.confidence,
          isUnknown: res.isUnknown,
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to analyze captured photo');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleUploadAnalyze = async (file: File) => {
    setErrorMsg('');
    setFeedbackSavedMsg('');
    setFeedbackOpen(false);
    setAnalyzing(true);
    const url = URL.createObjectURL(file);
    setUploadPreviewUrl(url);
    try {
      const classifier = activeClassifier || (await ensureStarterModel());
      if (!classifier) {
        setErrorMsg('Model is still initializing.');
        setAnalyzing(false);
        return;
      }
      const img = await loadImageElement(url);
      const res = await predictWithClassifier(classifier, img, threshold);
      setPrediction(res);
      if (!res.isNothing) {
        void recordSessionPrediction({
          modelId: activeModelMeta?.modelId || 'mdl_builtin_reference',
          modelName: activeModelMeta?.name || 'Reference Model',
          predictedLabel: res.predictedLabel,
          confidence: res.confidence,
          isUnknown: res.isUnknown,
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to analyze uploaded image');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFeedbackSubmit = async (isCorrect: boolean, answer?: string) => {
    if (!prediction || prediction.isNothing) return;
    const modelId = activeModelMeta?.modelId || 'mdl_builtin_reference';
    try {
      const { sharedFeedbackSaved } = await submitSessionFeedback({
        modelId,
        predictedLabel: prediction.predictedLabel,
        predictedConfidence: prediction.confidence,
        isCorrect,
        correctedCategory: answer,
        approveForShared,
      });
      setFeedbackOpen(false);
      setFeedbackSavedMsg(
        isCorrect
          ? `Confirmed "${prediction.predictedLabel}". ${sharedFeedbackSaved ? 'De-identified verification added to shared learning.' : 'Saved to session.'}`
          : `Saved correction ("${answer}"). ${sharedFeedbackSaved ? 'Shared anonymously for future model improvement.' : 'Saved to session.'}`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save feedback');
    }
  };

  const availableLabels =
    activeClassifier?.labels || firebaseStatus?.categories.map((c) => c.name) || [];
  const allSelectableModels = [...sessionModels, ...sharedModels];

  return (
    <div className="max-w-[1280px] mx-auto px-5 sm:px-8 py-12 space-y-10">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-[#D9D3C8] pb-8">
        <div className="space-y-2 max-w-2xl">
          <p className="text-xs text-[#777469]">
            Live Object Recognition
            <span className="mx-2" aria-hidden="true">·</span>
            <span>{activeModelMeta ? `${activeModelMeta.name} (v${activeModelMeta.version})` : 'Preparing model'}</span>
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#292820]">
            Test Model Intelligence
          </h1>
          <p className="text-sm sm:text-base text-[#777469]">
            Evaluate predictions using your webcam, a captured photo, or an uploaded image. When no object is present, recognition displays "Nothing is displayed".
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {allSelectableModels.length > 0 && (
            <select
              aria-label="Select model to test"
              value={activeModelMeta?.modelId || ''}
              onChange={(e) => {
                const m = allSelectableModels.find((x) => x.modelId === e.target.value);
                if (m) setActiveModelFromSaved(m);
              }}
              className="px-3.5 py-2 text-xs rounded-md border border-[#D9D3C8] bg-[#FFFFFF] text-[#292820]"
            >
              {sessionModels.length > 0 && (
                <optgroup label="Your Session Models">
                  {sessionModels.map((m) => (
                    <option key={m.modelId} value={m.modelId}>
                      {m.name} (v{m.activeVersion} · {(m.accuracy * 100).toFixed(0)}%)
                    </option>
                  ))}
                </optgroup>
              )}
              {sharedModels.length > 0 && (
                <optgroup label="Shared Model Library">
                  {sharedModels.map((m) => (
                    <option key={m.modelId} value={m.modelId}>
                      [Shared] {m.name} (v{m.activeVersion} · {(m.accuracy * 100).toFixed(0)}%)
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          )}

          <div className="flex p-1 rounded-md bg-[#E7E1D5] border border-[#D9D3C8]">
            <button
              type="button"
              onClick={() => {
                stopCamera();
                setCapturedPhotoUrl('');
                setMode('upload');
              }}
              className={`px-3.5 py-1.5 text-xs font-medium rounded cursor-pointer ${
                mode === 'upload' ? 'bg-[#FFFFFF] text-[#292820]' : 'text-[#777469]'
              }`}
            >
              Image Upload
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('webcam');
              }}
              className={`px-3.5 py-1.5 text-xs font-medium rounded cursor-pointer ${
                mode === 'webcam' ? 'bg-[#FFFFFF] text-[#292820]' : 'text-[#777469]'
              }`}
            >
              Webcam / Take Photo
            </button>
          </div>
        </div>
      </div>

      {starterStatus.loading && (
        <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-5 space-y-2">
          <div className="flex justify-between text-xs font-medium">
            <span>{starterStatus.phase}</span>
            <span className="font-mono tabular-nums">{starterStatus.progress}%</span>
          </div>
          <div className="h-2 bg-[#E7E1D5] rounded-full overflow-hidden">
            <div className="h-full bg-[#777C61]" style={{ width: `${starterStatus.progress}%` }} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 bg-[#FFFFFF] border border-[#D9D3C8] rounded-2xl p-6 space-y-5">
          {mode === 'upload' ? (
            <div className="space-y-4">
              {!uploadPreviewUrl ? (
                <div className="flex flex-col items-center justify-center h-80 rounded-xl border border-dashed border-[#D9D3C8] bg-[#F4F1EA]/60 p-6 text-center space-y-4">
                  <Upload className="w-7 h-7 text-[#777C61]" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-[#292820]">Upload an image or take a photo to analyze</p>
                    <p className="text-xs text-[#777469]">
                      Test images stay only in your browser during this session and are never stored permanently.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <label className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#777C61] text-[#FFFFFF] text-xs font-medium hover:bg-[#666B52] cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      Choose File
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.currentTarget.value = '';
                          if (f) void handleUploadAnalyze(f);
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('webcam');
                        void startCamera();
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-[#D9D3C8] bg-[#FFFFFF] text-[#292820] text-xs font-medium hover:bg-[#E7E1D5]/50 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5 text-[#777C61]" />
                      Take Photo with Camera
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="relative rounded-xl overflow-hidden border border-[#D9D3C8] bg-[#E7E1D5] h-80 flex items-center justify-center">
                    <img
                      src={uploadPreviewUrl}
                      alt="Uploaded test object"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        setUploadPreviewUrl('');
                        setPrediction(null);
                        setFeedbackSavedMsg('');
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md border border-[#D9D3C8] bg-[#F4F1EA] text-[#292820] cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Test Another Image
                    </button>
                    <label className="text-xs font-medium text-[#777C61] hover:underline cursor-pointer">
                      Choose another file
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.currentTarget.value = '';
                          if (f) void handleUploadAnalyze(f);
                        }}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl overflow-hidden border border-[#D9D3C8] bg-[#292820] h-80 flex items-center justify-center">
                {capturedPhotoUrl ? (
                  <img
                    src={capturedPhotoUrl}
                    alt="Captured test frame"
                    className="w-full h-full object-contain bg-[#292820]"
                  />
                ) : cameraActive ? (
                  <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                ) : (
                  <div className="text-center p-6 space-y-3 text-[#F4F1EA]">
                    <Camera className="w-8 h-8 mx-auto opacity-80" />
                    <p className="text-sm">Camera is currently off</p>
                    <p className="text-xs text-[#D9D3C8] max-w-xs mx-auto">
                      Webcam frames and captured photos run locally inside your session without reloading the page.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  {capturedPhotoUrl ? (
                    <button
                      type="button"
                      onClick={() => void startCamera()}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[#777C61] text-[#FFFFFF] text-sm font-medium cursor-pointer"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Retake Photo
                    </button>
                  ) : cameraActive ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void takePhotoFromWebcam()}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[#777C61] text-[#FFFFFF] text-sm font-medium cursor-pointer"
                      >
                        <Camera className="w-4 h-4" />
                        Take Photo
                      </button>
                      <button
                        type="button"
                        onClick={stopCamera}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-[#AD7961] text-[#FFFFFF] text-sm font-medium cursor-pointer"
                      >
                        <CameraOff className="w-4 h-4" />
                        Turn Camera Off
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void startCamera()}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[#777C61] text-[#FFFFFF] text-sm font-medium cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      Enable Camera
                    </button>
                  )}
                </div>
                {cameraError && <span className="text-xs text-[#AD7961]">{cameraError}</span>}
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-[#D9D3C8] flex items-center justify-between gap-4 text-xs">
            <span className="text-[#777469]">
              Unknown-Object Threshold: <strong className="font-mono text-[#292820]">{(threshold * 100).toFixed(0)}%</strong>
            </span>
            <input
              type="range"
              min={0.35}
              max={0.9}
              step={0.05}
              value={threshold}
              onChange={(e) => {
                const v = Number(e.target.value);
                setThreshold(v);
                void syncSessionWorkspace({ sessionSettings: { confidenceThreshold: v } });
              }}
              aria-label="Unknown object confidence threshold"
              className="w-40 accent-[#777C61]"
            />
          </div>
        </div>

        <div className="lg:col-span-5 bg-[#FFFFFF] border border-[#D9D3C8] rounded-2xl p-6 space-y-6">
          <h2 className="font-display text-xl font-semibold text-[#292820]">Recognition Output</h2>

          {errorMsg && <p className="text-sm text-[#AD7961]">{errorMsg}</p>}

          {analyzing ? (
            <p className="text-sm text-[#777469] py-8 text-center">Running MobileNetV2 inference...</p>
          ) : prediction ? (
            prediction.isNothing ? (
              <div className="p-6 rounded-xl bg-[#F4F1EA] border border-[#D9D3C8] text-center space-y-2">
                <p className="font-display text-xl font-semibold text-[#292820]">Nothing is displayed</p>
                <p className="text-xs text-[#777469]">
                  {prediction.reason || 'Hold an object clearly in front of the camera or upload a photo with a visible subject.'}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="p-4 rounded-xl bg-[#F4F1EA] border border-[#D9D3C8] space-y-2">
                  <div className="flex items-center gap-2">
                    {prediction.isUnknown ? (
                      <HelpCircle className="w-5 h-5 text-[#AD7961] shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 text-[#777C61] shrink-0" />
                    )}
                    <p className="font-display text-xl font-semibold text-[#292820]">
                      {prediction.isUnknown ? "I don't recognize this object yet." : prediction.predictedLabel}
                    </p>
                  </div>
                  <p className="text-xs text-[#777469] font-mono tabular-nums">
                    Confidence {(prediction.confidence * 100).toFixed(1)}% · Similarity{' '}
                    {(prediction.centroidSimilarity * 100).toFixed(0)}% · {prediction.latencyMs}ms
                  </p>
                  {prediction.reason && <p className="text-xs text-[#AD7961] pt-1">{prediction.reason}</p>}
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-medium text-[#777469]">Top 3 Predictions</p>
                  {prediction.topPredictions.map((cand) => (
                    <div key={cand.label} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium text-[#292820]">{cand.label}</span>
                        <span className="font-mono text-[#777469] tabular-nums">
                          {(cand.probability * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-2 bg-[#E7E1D5] rounded-full overflow-hidden">
                        <div className="h-full bg-[#777C61]" style={{ width: `${Math.max(2, cand.probability * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-4 border-t border-[#D9D3C8] space-y-3">
                  <p className="text-xs font-medium text-[#292820]">Step 7 · Submit Verification Feedback</p>

                  {educatorSettings?.retainAnonymousFeedback !== false && (
                    <label className="flex items-center gap-2 text-xs text-[#777469] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={approveForShared}
                        onChange={(e) => setApproveForShared(e.target.checked)}
                        className="accent-[#777C61]"
                      />
                      <span>Share de-identified verification to help future participants</span>
                    </label>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleFeedbackSubmit(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-[#777C61] text-xs font-medium text-[#777C61] hover:bg-[#777C61] hover:text-[#FFFFFF] transition-colors cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Correct
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFeedbackOpen(true);
                        setCorrectedLabel(availableLabels[0] || '');
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-[#AD7961] text-xs font-medium text-[#AD7961] hover:bg-[#AD7961] hover:text-[#FFFFFF] transition-colors cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Incorrect — Provide Answer
                    </button>
                  </div>

                  {feedbackOpen && (
                    <div className="p-3.5 rounded-lg bg-[#F4F1EA] border border-[#D9D3C8] space-y-2.5">
                      <label className="block text-xs text-[#777469]">What is the true object?</label>
                      <div className="flex gap-2">
                        <select
                          value={correctedLabel}
                          onChange={(e) => setCorrectedLabel(e.target.value)}
                          className="flex-1 px-3 py-1.5 text-xs rounded border border-[#D9D3C8] bg-[#FFFFFF]"
                        >
                          {availableLabels.map((lbl) => (
                            <option key={lbl} value={lbl}>
                              {lbl}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void handleFeedbackSubmit(false, correctedLabel)}
                          className="px-3.5 py-1.5 rounded bg-[#777C61] text-[#FFFFFF] text-xs font-medium cursor-pointer"
                        >
                          Submit
                        </button>
                      </div>
                    </div>
                  )}

                  {feedbackSavedMsg && <p className="text-xs text-[#777C61] font-medium">{feedbackSavedMsg}</p>}
                </div>
              </div>
            )
          ) : (
            <div className="py-12 text-center space-y-1.5">
              <p className="font-display text-lg font-semibold text-[#292820]">Nothing is displayed</p>
              <p className="text-xs text-[#777469]">
                Upload an image, take a photo, or enable your camera to see real predictions and confidence scores.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
