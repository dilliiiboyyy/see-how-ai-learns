import { useEffect, useState } from 'react';
import {
  Download,
  Upload,
  Play,
  RefreshCw,
  Check,
  X,
  Lock,
  Layers,
} from 'lucide-react';
import { usePlatform, type SavedModelItem } from '../context/PlatformContext';
import type { SerializedClassifierModel } from '../ml/visionEngine';

interface ActivityEvent {
  activityId: string;
  type: string;
  title: string;
  detail: string;
  categorySlug?: string;
  createdAt: string;
}

interface QueueItem {
  queueId: string;
  categorySlug: string;
  categoryName: string;
  imageId: string;
  source: string;
  license: string;
  thumbnailUrl: string;
  qualityScore: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'trained';
  createdAt: string;
}

export function ModelsPage() {
  const {
    sharedModels,
    sessionModels,
    savedModels,
    setActiveModelFromSaved,
    saveTrainedModel,
    navigate,
    refreshFirebaseStatus,
    isEducator,
    getIdToken,
  } = usePlatform();

  const [tab, setTab] = useState<'shared' | 'session' | 'activity' | 'autonomous'>('shared');
  const [selectedModel, setSelectedModel] = useState<SavedModelItem | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [runningAuto, setRunningAuto] = useState(false);
  const [statusNotice, setStatusNotice] = useState('');

  const loadAutonomousData = async () => {
    const res = await fetch('/api/autonomous/status');
    if (res.ok) {
      const data = await res.json();
      setActivity(data.activity || []);
      setQueue(data.queue || []);
    }
  };

  useEffect(() => {
    void loadAutonomousData();
  }, []);

  useEffect(() => {
    if (!selectedModel && savedModels.length > 0) {
      setSelectedModel(sharedModels[0] || sessionModels[0] || savedModels[0]);
    }
  }, [savedModels, sharedModels, sessionModels, selectedModel]);

  const handleExportModel = (model: SavedModelItem) => {
    const ver = model.versions.find((v) => v.version === model.activeVersion) || model.versions[0];
    if (!ver?.serializedModelJson) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      modelName: model.name,
      version: ver.version,
      classifier: JSON.parse(ver.serializedModelJson),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${model.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-v${ver.version}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportModelToSession = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        modelName?: string;
        classifier?: SerializedClassifierModel;
      };
      const serialized = parsed.classifier || (parsed as unknown as SerializedClassifierModel);
      if (!serialized.labels || !serialized.weights) {
        setStatusNotice('Invalid model export format.');
        return;
      }
      await saveTrainedModel({
        name: parsed.modelName || file.name.replace(/\.json$/, ''),
        projectId: `imported_${Date.now().toString(36)}`,
        serialized,
      });
      setTab('session');
      setStatusNotice('Imported model into your current private session.');
    } catch {
      setStatusNotice('Failed to parse model JSON file.');
    }
  };

  const handleRunCycle = async () => {
    const token = await getIdToken();
    if (!token) {
      setStatusNotice('Educator sign-in is required to manually trigger shared dataset expansion.');
      return;
    }
    setRunningAuto(true);
    setStatusNotice('');
    try {
      const res = await fetch('/api/autonomous/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ maxCollect: 4 }),
      });
      const data = await res.json();
      setStatusNotice(
        data.skipped
          ? data.reason
          : `Autonomous cycle collected ${data.collectedCount} verified ${data.targetCategory} image(s) and filtered ${data.duplicateRejected} duplicate(s).`,
      );
      await loadAutonomousData();
      await refreshFirebaseStatus();
    } finally {
      setRunningAuto(false);
    }
  };

  const handleReviewQueue = async (queueId: string, action: 'approve' | 'reject') => {
    const token = await getIdToken();
    if (!token) return;
    await fetch(`/api/autonomous/queue/${queueId}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action }),
    });
    await loadAutonomousData();
  };

  const listToDisplay = tab === 'shared' ? sharedModels : sessionModels;

  return (
    <div className="max-w-[1280px] mx-auto px-5 sm:px-8 py-12 space-y-10">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-[#D9D3C8] pb-8">
        <div className="space-y-2 max-w-2xl">
          <p className="text-xs text-[#777469]">
            Shared Model Library &amp; Session Models
            <span className="mx-2" aria-hidden="true">·</span>
            <span className="tabular-nums">{sharedModels.length} Shared</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span className="tabular-nums">{sessionModels.length} Session</span>
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#292820]">
            Model Library &amp; Learning History
          </h1>
          <p className="text-sm sm:text-base text-[#777469]">
            Browse approved shared models preserved across sessions, inspect categories and versions, or test models you trained during your session.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md border border-[#D9D3C8] bg-[#FFFFFF] text-[#292820] hover:bg-[#E7E1D5]/60 cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            Import to Session (.json)
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportModelToSession(f);
              }}
            />
          </label>
          {isEducator && (
            <button
              type="button"
              disabled={runningAuto}
              onClick={() => void handleRunCycle()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md bg-[#777C61] text-[#FFFFFF] hover:bg-[#666B52] cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${runningAuto ? 'animate-spin' : ''}`} />
              {runningAuto ? 'Collecting...' : 'Run Autonomous Cycle'}
            </button>
          )}
        </div>
      </div>

      {statusNotice && (
        <div className="px-4 py-3 rounded-lg bg-[#FFFFFF] border border-[#D9D3C8] text-xs text-[#292820]">
          {statusNotice}
        </div>
      )}

      <div className="flex flex-wrap border-b border-[#D9D3C8] gap-7">
        {(
          [
            ['shared', `Shared Model Library (${sharedModels.length})`],
            ['session', `Session Models (${sessionModels.length})`],
            ['activity', `Shared Learning Activity (${activity.length})`],
            ['autonomous', `Autonomous Queue (${queue.length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`pb-3 text-sm border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
              tab === id
                ? 'border-[#777C61] text-[#292820] font-medium'
                : 'border-transparent text-[#777469] hover:text-[#292820]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {(tab === 'shared' || tab === 'session') && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-5 space-y-3">
            {tab === 'shared' && (
              <div className="px-4 py-3 rounded-xl bg-[#E7E1D5]/55 border border-[#D9D3C8] text-xs text-[#777469] flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-[#777C61] shrink-0" />
                <span>Approved shared models remain available across all sessions and are protected against accidental modification.</span>
              </div>
            )}

            {listToDisplay.length === 0 ? (
              <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-8 text-center space-y-3">
                <Layers className="w-5 h-5 text-[#777C61] mx-auto" />
                <p className="text-sm font-medium text-[#292820]">
                  {tab === 'shared' ? 'No shared models published yet' : 'No models trained in this session yet'}
                </p>
                <p className="text-xs text-[#777469]">
                  {tab === 'shared'
                    ? 'Open the Test Lab to initialize the 12-Object Shared Reference Model.'
                    : 'Build and train a custom classifier in Studio.'}
                </p>
                <button
                  type="button"
                  onClick={() => navigate(tab === 'shared' ? 'test' : 'studio')}
                  className="px-4 py-2 rounded-md bg-[#777C61] text-[#FFFFFF] text-xs font-medium cursor-pointer"
                >
                  {tab === 'shared' ? 'Open Test Lab' : 'Open Studio'}
                </button>
              </div>
            ) : (
              listToDisplay.map((mdl) => {
                const active = selectedModel?.modelId === mdl.modelId;
                return (
                  <div
                    key={mdl.modelId}
                    onClick={() => setSelectedModel(mdl)}
                    className={`rounded-xl border p-5 space-y-3 cursor-pointer transition-colors bg-[#FFFFFF] ${
                      active ? 'border-[#777C61] ring-2 ring-[#777C61]/20' : 'border-[#D9D3C8] hover:border-[#777C61]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-display text-base font-semibold text-[#292820] truncate">
                          {mdl.name}
                        </h3>
                        <p className="text-xs text-[#777469] font-mono tabular-nums mt-0.5">
                          v{mdl.activeVersion} · {mdl.categories.length} classes · {mdl.datasetSize} images
                        </p>
                      </div>
                      <span className="font-mono text-sm font-semibold text-[#777C61] tabular-nums shrink-0">
                        {(mdl.accuracy * 100).toFixed(1)}%
                      </span>
                    </div>

                    <p className="text-xs text-[#777469] truncate">{mdl.categories.join(', ')}</p>

                    <div
                      className="flex items-center justify-between pt-2 border-t border-[#D9D3C8] text-xs"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (setActiveModelFromSaved(mdl)) navigate('test');
                        }}
                        className="inline-flex items-center gap-1 text-[#777C61] font-medium hover:underline cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Test Model
                      </button>

                      <button
                        type="button"
                        onClick={() => handleExportModel(mdl)}
                        aria-label="Export model JSON"
                        className="inline-flex items-center gap-1 text-[#777469] hover:text-[#292820] cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Export
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="lg:col-span-7 bg-[#FFFFFF] border border-[#D9D3C8] rounded-2xl p-6 space-y-6">
            {selectedModel ? (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#D9D3C8] pb-4">
                  <div>
                    <h2 className="font-display text-xl font-semibold text-[#292820]">{selectedModel.name}</h2>
                    <p className="text-xs text-[#777469] mt-0.5">{selectedModel.description}</p>
                  </div>
                  <span className="font-mono text-xs text-[#777469] tabular-nums shrink-0">
                    {selectedModel.isShared ? 'Shared Approved' : 'Session Private'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="bg-[#F4F1EA] p-3 rounded-lg">
                    <p className="text-xs text-[#777469]">Test Accuracy</p>
                    <p className="font-mono text-lg font-semibold text-[#292820] tabular-nums">
                      {(selectedModel.accuracy * 100).toFixed(1)}%
                    </p>
                  </div>
                  <div className="bg-[#F4F1EA] p-3 rounded-lg">
                    <p className="text-xs text-[#777469]">Precision</p>
                    <p className="font-mono text-lg font-semibold text-[#292820] tabular-nums">
                      {(selectedModel.precision * 100).toFixed(1)}%
                    </p>
                  </div>
                  <div className="bg-[#F4F1EA] p-3 rounded-lg">
                    <p className="text-xs text-[#777469]">Recall</p>
                    <p className="font-mono text-lg font-semibold text-[#292820] tabular-nums">
                      {(selectedModel.recall * 100).toFixed(1)}%
                    </p>
                  </div>
                  <div className="bg-[#F4F1EA] p-3 rounded-lg">
                    <p className="text-xs text-[#777469]">Latency</p>
                    <p className="font-mono text-lg font-semibold text-[#292820] tabular-nums">
                      {selectedModel.latencyMs}ms
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-[#777469]">Recognized Categories</p>
                  <p className="text-xs text-[#292820] leading-relaxed">{selectedModel.categories.join(' · ')}</p>
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-[#292820]">Version Comparison</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-[#D9D3C8] text-[#777469]">
                          <th className="py-2 pr-3 font-medium">Version</th>
                          <th className="py-2 pr-3 font-medium">Test Acc</th>
                          <th className="py-2 pr-3 font-medium">Dataset</th>
                          <th className="py-2 pr-3 font-medium">Trigger</th>
                          <th className="py-2 font-medium text-right">State</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedModel.versions.map((ver) => (
                          <tr key={ver.versionId} className="border-b border-[#D9D3C8]/60">
                            <td className="py-2.5 pr-3 font-mono text-[#292820] tabular-nums">v{ver.version}</td>
                            <td className="py-2.5 pr-3 font-mono text-[#292820] tabular-nums">
                              {(ver.testAccuracy * 100).toFixed(1)}%
                            </td>
                            <td className="py-2.5 pr-3 font-mono text-[#777469] tabular-nums">
                              {ver.datasetSize} imgs
                            </td>
                            <td className="py-2.5 pr-3 capitalize text-[#777469]">{ver.trigger}</td>
                            <td className="py-2.5 text-right">
                              {ver.isDeployed ? (
                                <span className="text-[#777C61] font-medium">Active</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (setActiveModelFromSaved(selectedModel, ver.version)) navigate('test');
                                  }}
                                  className="text-[#777C61] hover:underline cursor-pointer"
                                >
                                  Test v{ver.version}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-[#777469] py-12 text-center">
                Select a shared or session model on the left to inspect its categories, accuracy, and versions.
              </p>
            )}
          </div>
        </div>
      )}

      {tab === 'activity' && (
        <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-2xl divide-y divide-[#D9D3C8]">
          {activity.length === 0 ? (
            <p className="p-8 text-sm text-[#777469] text-center">No shared learning events recorded yet.</p>
          ) : (
            activity.map((ev) => (
              <div key={ev.activityId} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs font-mono text-[#AD7961] uppercase">{ev.type}</p>
                  <p className="text-sm font-medium text-[#292820]">{ev.title}</p>
                  <p className="text-xs text-[#777469]">{ev.detail}</p>
                </div>
                <span className="text-xs font-mono text-[#777469] tabular-nums shrink-0">
                  {new Date(ev.createdAt).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'autonomous' && (
        <div className="space-y-4">
          {queue.length === 0 ? (
            <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-10 text-center space-y-3">
              <p className="text-sm font-medium text-[#292820]">Shared autonomous learning queue is empty</p>
              <p className="text-xs text-[#777469]">
                De-identified verified corrections from participant sessions trigger autonomous dataset enrichment here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {queue.map((item) => (
                <div key={item.queueId} className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-4 space-y-3">
                  <div className="flex gap-3">
                    <img
                      src={item.thumbnailUrl}
                      alt={item.categoryName}
                      referrerPolicy="no-referrer"
                      className="w-16 h-16 rounded-lg object-cover border border-[#D9D3C8] shrink-0"
                    />
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-semibold text-[#292820]">{item.categoryName}</p>
                      <p className="text-xs text-[#777469] truncate">{item.license}</p>
                      <p className="text-xs font-mono text-[#777C61] tabular-nums">
                        Quality {(item.qualityScore * 100).toFixed(0)}% · {item.status}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-[#777469]">{item.reason}</p>
                  {isEducator && (
                    <div className="flex items-center gap-2 pt-2 border-t border-[#D9D3C8]">
                      <button
                        type="button"
                        onClick={() => void handleReviewQueue(item.queueId, 'approve')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-[#777C61] text-[#FFFFFF] text-xs font-medium cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleReviewQueue(item.queueId, 'reject')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-[#D9D3C8] text-[#777469] text-xs font-medium cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
