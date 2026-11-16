import { useEffect, useState, useCallback, useRef } from 'react';
import {
  ShieldCheck,
  LogIn,
  LogOut,
  RotateCcw,
  Check,
  X,
  Trash2,
  SlidersHorizontal,
} from 'lucide-react';
import { usePlatform, type EducatorSettingsData, type SavedModelItem } from '../context/PlatformContext';
import {
  EDUCATOR_EMAIL,
  syncEducatorSettingsToFirestore,
  syncSharedModelToFirestore,
  syncSessionSummaryToFirestore,
} from '../lib/firebase';

interface AdminOverviewData {
  educatorEmail: string;
  aggregate: {
    totalSessions: number;
    activeSessionsCount: number;
    completedSessionsCount: number;
    expiredSessionsCount: number;
    totalPredictions: number;
    totalFeedback: number;
    sharedModelsCount: number;
    pendingProposalsCount: number;
  };
  activeSessions: Array<{
    sessionId: string;
    nickname: string;
    status: string;
    categoriesCount: number;
    uploadedImagesCount: number;
    modelsCount: number;
    predictionsCount: number;
    feedbackCount: number;
    inFlightOps: number;
    createdAt: string;
    expiresAt: string;
  }>;
  recentSummaries: Array<{
    summaryId: string;
    sessionId: string;
    nickname: string;
    durationMinutes: number;
    categoriesCreated: number;
    imagesAdded: number;
    modelsTrained: number;
    modelsTested: number;
    predictionsCount: number;
    verifiedCorrectCount: number;
    feedbackSubmittedCount: number;
    status: string;
    endedAt: string;
  }>;
  completedNicknames?: Array<{
    nicknameId: string;
    nickname: string;
    sessionId: string;
    summaryId: string;
    status: string;
    completedAt: string;
  }>;
  sharedFeedback: Array<{
    feedbackId: string;
    modelId: string;
    predictedCategory: string;
    predictedConfidence: number;
    isCorrect: boolean;
    correctedCategory?: string;
    status: string;
    createdAt: string;
  }>;
  sharedModels: SavedModelItem[];
  pendingProposals: Array<{
    proposalId: string;
    submittedAt: string;
    status: string;
    model: SavedModelItem;
  }>;
  educatorSettings: EducatorSettingsData;
  learningActivity: Array<{
    activityId: string;
    type: string;
    title: string;
    detail: string;
    createdAt: string;
  }>;
}

export function EducatorPage({ onBack }: { onBack?: () => void }) {
  const { user, isEducator, signIn, signOut, getIdToken, refreshModels } = usePlatform();
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'sessions' | 'proposals' | 'feedback' | 'policies' | 'history'>('sessions');
  const syncedSummaryIdsRef = useRef<Set<string>>(new Set());

  const fetchOverview = useCallback(async () => {
    if (!isEducator) return;
    setLoading(true);
    setError('');
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/admin/overview', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to load educator console');
        return;
      }
      setOverview(data);
      const summaries = Array.isArray(data.recentSummaries)
        ? (data.recentSummaries as AdminOverviewData['recentSummaries'])
        : [];
      for (const sum of summaries.slice(0, 10)) {
        if (!syncedSummaryIdsRef.current.has(sum.summaryId)) {
          syncedSummaryIdsRef.current.add(sum.summaryId);
          void syncSessionSummaryToFirestore({
            summaryId: sum.summaryId,
            sessionId: sum.sessionId,
            nickname: sum.nickname,
            categoriesCreated: sum.categoriesCreated,
            imagesAdded: sum.imagesAdded,
            modelsTested: sum.modelsTested ?? 0,
            predictionsCount: sum.predictionsCount,
            verifiedCorrectCount: sum.verifiedCorrectCount ?? 0,
            feedbackSubmittedCount: sum.feedbackSubmittedCount,
          }).catch(() => {});
        }
      }
    } catch {
      setError('Unable to load educator overview.');
    } finally {
      setLoading(false);
    }
  }, [isEducator, getIdToken]);

  useEffect(() => {
    if (isEducator) {
      void fetchOverview();
    }
  }, [isEducator, fetchOverview]);

  const handleResetSession = async (sessionId: string) => {
    const token = await getIdToken();
    if (!token) return;
    const res = await fetch(`/api/admin/sessions/${sessionId}/reset`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setNotice(`Reset session ${sessionId} and purged temporary files.`);
      void fetchOverview();
    }
  };

  const handleReviewProposal = async (proposalId: string, action: 'approve' | 'reject') => {
    const token = await getIdToken();
    if (!token) return;
    const targetProposal = overview?.pendingProposals.find((p) => p.proposalId === proposalId);
    const res = await fetch(`/api/admin/proposals/${proposalId}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      if (action === 'approve' && targetProposal) {
        void syncSharedModelToFirestore({
          modelId: targetProposal.model.modelId,
          name: targetProposal.model.name,
          description: targetProposal.model.description,
          categories: targetProposal.model.categories,
          datasetSize: targetProposal.model.datasetSize,
          latestVersion: targetProposal.model.latestVersion,
          activeVersion: targetProposal.model.activeVersion,
          accuracy: targetProposal.model.accuracy,
          precision: targetProposal.model.precision,
          recall: targetProposal.model.recall,
          latencyMs: targetProposal.model.latencyMs,
        }).catch(() => {});
      }
      setNotice(`Proposal ${action === 'approve' ? 'approved and published to Shared Model Library' : 'rejected'}.`);
      await refreshModels();
      await fetchOverview();
    }
  };

  const handleDeleteSharedModel = async (modelId: string) => {
    const token = await getIdToken();
    if (!token) return;
    const res = await fetch(`/api/admin/shared-models/${modelId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setNotice('Removed model from shared library.');
      await refreshModels();
      await fetchOverview();
    }
  };

  const handleFeedbackAction = async (feedbackId: string, action: 'applied' | 'delete') => {
    const token = await getIdToken();
    if (!token) return;
    if (action === 'delete') {
      await fetch(`/api/admin/shared-feedback/${feedbackId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } else {
      await fetch(`/api/admin/shared-feedback/${feedbackId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: 'applied' }),
      });
    }
    void fetchOverview();
  };

  const handleUpdatePolicy = async (patch: Partial<EducatorSettingsData>) => {
    const token = await getIdToken();
    if (!token) return;
    const res = await fetch('/api/admin/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = await res.json();
      setOverview((prev) => (prev ? { ...prev, educatorSettings: data.educatorSettings } : null));
      void syncEducatorSettingsToFirestore(data.educatorSettings).catch(() => {});
      setNotice('Updated EdEx session & retention policies.');
    }
  };

  if (!user || !isEducator) {
    return (
      <div className="max-w-[760px] mx-auto px-5 sm:px-8 py-16">
        <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-2xl p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-[#777C61]">
              <ShieldCheck className="w-4 h-4" />
              <span>Protected Educator Area</span>
            </div>
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="text-xs text-[#777469] hover:text-[#292820] cursor-pointer"
              >
                ← Back
              </button>
            )}
          </div>

          <div className="space-y-2">
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#292820]">
              EdEx Educator &amp; Admin Console
            </h1>
            <p className="text-sm text-[#777469] leading-relaxed">
              This console allows authorized educators to monitor participant session counts, reset stuck stations, review de-identified feedback, approve shared models, and configure session retention policies.
            </p>
          </div>

          {user && !isEducator ? (
            <div className="p-4 rounded-xl bg-[#F4F1EA] border border-[#AD7961] space-y-3">
              <p className="text-xs text-[#292820]">
                Signed in as <span className="font-mono">{user.email}</span>. Educator controls are restricted to verified admin account <span className="font-mono">{EDUCATOR_EMAIL}</span>.
              </p>
              <button
                type="button"
                onClick={() => void signOut()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md border border-[#D9D3C8] bg-[#FFFFFF] cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign out
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void signIn()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[#777C61] text-[#FFFFFF] text-sm font-medium hover:bg-[#666B52] cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              Sign in with Google as Educator
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1280px] mx-auto px-5 sm:px-8 py-12 space-y-10">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-[#D9D3C8] pb-8">
        <div className="space-y-2">
          <p className="text-xs text-[#777469]">
            Protected Educator Console · {overview?.educatorEmail || user.email}
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#292820]">
            EdEx Platform Administration
          </h1>
          <p className="text-sm text-[#777469]">
            Monitor active stations, review de-identified feedback, approve shared models, and govern data retention without exposing private participant uploads.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="px-4 py-2 text-xs font-medium rounded-md border border-[#D9D3C8] bg-[#FFFFFF] text-[#292820] cursor-pointer"
            >
              Back to Workspace
            </button>
          )}
          <button
            type="button"
            onClick={() => void fetchOverview()}
            className="px-4 py-2 text-xs font-medium rounded-md bg-[#777C61] text-[#FFFFFF] cursor-pointer"
          >
            Refresh Stats
          </button>
        </div>
      </div>

      {notice && (
        <div className="px-4 py-3 rounded-lg bg-[#FFFFFF] border border-[#777C61] text-xs text-[#292820]">
          {notice}
        </div>
      )}
      {error && (
        <div className="px-4 py-3 rounded-lg bg-[#FFFFFF] border border-[#AD7961] text-xs text-[#AD7961]">
          {error}
        </div>
      )}

      {overview && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-4">
              <p className="text-[11px] text-[#777469]">Total Sessions</p>
              <p className="font-mono text-xl font-semibold text-[#292820] tabular-nums mt-1">
                {overview.aggregate.totalSessions}
              </p>
            </div>
            <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-4">
              <p className="text-[11px] text-[#777469]">Active Stations</p>
              <p className="font-mono text-xl font-semibold text-[#777C61] tabular-nums mt-1">
                {overview.aggregate.activeSessionsCount}
              </p>
            </div>
            <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-4">
              <p className="text-[11px] text-[#777469]">Completed</p>
              <p className="font-mono text-xl font-semibold text-[#292820] tabular-nums mt-1">
                {overview.aggregate.completedSessionsCount}
              </p>
            </div>
            <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-4">
              <p className="text-[11px] text-[#777469]">Predictions Run</p>
              <p className="font-mono text-xl font-semibold text-[#292820] tabular-nums mt-1">
                {overview.aggregate.totalPredictions}
              </p>
            </div>
            <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-4">
              <p className="text-[11px] text-[#777469]">Shared Feedback</p>
              <p className="font-mono text-xl font-semibold text-[#292820] tabular-nums mt-1">
                {overview.aggregate.totalFeedback}
              </p>
            </div>
            <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-4">
              <p className="text-[11px] text-[#777469]">Shared Models</p>
              <p className="font-mono text-xl font-semibold text-[#292820] tabular-nums mt-1">
                {overview.aggregate.sharedModelsCount}
              </p>
            </div>
            <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-4">
              <p className="text-[11px] text-[#777469]">Pending Approvals</p>
              <p className="font-mono text-xl font-semibold text-[#AD7961] tabular-nums mt-1">
                {overview.aggregate.pendingProposalsCount}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap border-b border-[#D9D3C8] gap-6">
            {(
              [
                ['sessions', `Active & Recent Sessions (${overview.activeSessions.length})`],
                ['proposals', `Shared Library & Approvals (${overview.pendingProposals.length})`],
                ['feedback', `De-identified Feedback (${overview.sharedFeedback.length})`],
                ['policies', 'Session & Retention Policies'],
                ['history', 'Training & Learning History'],
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

          {loading && <p className="text-xs text-[#777469]">Refreshing educator metrics...</p>}

          {tab === 'sessions' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-7 bg-[#FFFFFF] border border-[#D9D3C8] rounded-2xl p-6 space-y-4">
                  <h2 className="font-display text-lg font-semibold text-[#292820]">
                    Active Participant Sessions
                  </h2>
                  {overview.activeSessions.length === 0 ? (
                    <p className="text-xs text-[#777469] py-6">No active participant sessions right now.</p>
                  ) : (
                    <div className="divide-y divide-[#D9D3C8]">
                      {overview.activeSessions.map((s) => (
                        <div key={s.sessionId} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="space-y-0.5">
                            <p className="text-sm font-medium text-[#292820]">{s.nickname}</p>
                            <p className="text-xs text-[#777469] font-mono tabular-nums">
                              {s.sessionId} · {s.uploadedImagesCount} imgs · {s.predictionsCount} preds · expires{' '}
                              {new Date(s.expiresAt).toLocaleTimeString()}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleResetSession(s.sessionId)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#AD7961] text-xs font-medium text-[#AD7961] hover:bg-[#AD7961] hover:text-[#FFFFFF] cursor-pointer self-start"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Reset Session
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="lg:col-span-5 bg-[#FFFFFF] border border-[#D9D3C8] rounded-2xl p-6 space-y-4">
                  <h2 className="font-display text-lg font-semibold text-[#292820]">
                    Completed Session Summaries
                  </h2>
                  {overview.recentSummaries.length === 0 ? (
                    <p className="text-xs text-[#777469] py-6">No completed sessions recorded yet.</p>
                  ) : (
                    <div className="divide-y divide-[#D9D3C8] max-h-96 overflow-y-auto">
                      {overview.recentSummaries.map((sum) => (
                        <div key={sum.summaryId} className="py-3 text-xs space-y-1">
                          <div className="flex justify-between items-center gap-2 text-[#292820]">
                            <span className="font-medium truncate">
                              {sum.nickname || 'Anonymous Participant'}{' '}
                              <span className="font-mono text-[11px] text-[#777469]">· {sum.sessionId}</span>
                            </span>
                            <span className="capitalize font-mono text-[#777C61] shrink-0">{sum.status}</span>
                          </div>
                          <p className="text-[#777469] tabular-nums">
                            {sum.durationMinutes}m · {sum.imagesAdded} imgs · {sum.modelsTrained} trained ·{' '}
                            {sum.predictionsCount} preds · {sum.feedbackSubmittedCount} feedback
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="font-display text-lg font-semibold text-[#292820]">
                      Saved Participant Nicknames ({overview.completedNicknames?.length ?? overview.recentSummaries.length})
                    </h2>
                    <p className="text-xs text-[#777469]">
                      Every participant nickname is saved automatically whenever a session completes.
                    </p>
                  </div>
                </div>
                {(overview.completedNicknames && overview.completedNicknames.length > 0) || overview.recentSummaries.length > 0 ? (
                  <div className="divide-y divide-[#D9D3C8] max-h-72 overflow-y-auto">
                    {(overview.completedNicknames && overview.completedNicknames.length > 0
                      ? overview.completedNicknames
                      : overview.recentSummaries.map((sum) => ({
                          nicknameId: sum.summaryId,
                          nickname: sum.nickname || 'Anonymous Participant',
                          sessionId: sum.sessionId,
                          summaryId: sum.summaryId,
                          status: sum.status,
                          completedAt: sum.endedAt,
                        }))
                    ).map((entry) => (
                      <div key={entry.nicknameId} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2.5">
                          <span className="font-medium text-[#292820]">{entry.nickname}</span>
                          <span className="font-mono text-[#777469]">{entry.sessionId}</span>
                        </div>
                        <span className="font-mono text-[#777469] tabular-nums">
                          {entry.status} · {new Date(entry.completedAt).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#777469] py-4">No completed session nicknames saved yet.</p>
                )}
              </div>
            </div>
          )}

          {tab === 'proposals' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-2xl p-6 space-y-4">
                <h2 className="font-display text-lg font-semibold text-[#292820]">
                  Pending Shared Model Proposals
                </h2>
                {overview.pendingProposals.length === 0 ? (
                  <p className="text-xs text-[#777469] py-6">No pending participant models awaiting review.</p>
                ) : (
                  <div className="space-y-4">
                    {overview.pendingProposals.map((p) => (
                      <div key={p.proposalId} className="p-4 rounded-xl bg-[#F4F1EA] border border-[#D9D3C8] space-y-2.5">
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <p className="text-sm font-semibold text-[#292820]">{p.model.name}</p>
                            <p className="text-xs text-[#777469]">{p.model.categories.join(', ')}</p>
                          </div>
                          <span className="font-mono text-xs font-semibold text-[#777C61] tabular-nums">
                            {(p.model.accuracy * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => void handleReviewProposal(p.proposalId, 'approve')}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-[#777C61] text-[#FFFFFF] text-xs font-medium cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Approve for Shared Library
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleReviewProposal(p.proposalId, 'reject')}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-[#D9D3C8] bg-[#FFFFFF] text-xs text-[#777469] cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-2xl p-6 space-y-4">
                <h2 className="font-display text-lg font-semibold text-[#292820]">
                  Approved Shared Model Library
                </h2>
                <div className="divide-y divide-[#D9D3C8]">
                  {overview.sharedModels.map((m) => (
                    <div key={m.modelId} className="py-3.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#292820] truncate">{m.name}</p>
                        <p className="text-xs text-[#777469] font-mono tabular-nums">
                          v{m.activeVersion} · {(m.accuracy * 100).toFixed(1)}% · {m.categories.length} classes
                        </p>
                      </div>
                      {m.modelId !== 'mdl_builtin_reference' && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteSharedModel(m.modelId)}
                          className="p-1.5 text-[#777469] hover:text-[#AD7961] cursor-pointer"
                          aria-label={`Remove ${m.name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'feedback' && (
            <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-2xl divide-y divide-[#D9D3C8]">
              {overview.sharedFeedback.length === 0 ? (
                <p className="p-8 text-xs text-[#777469] text-center">No shared de-identified feedback collected yet.</p>
              ) : (
                overview.sharedFeedback.map((fb) => (
                  <div key={fb.feedbackId} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="space-y-0.5">
                      <p className="font-medium text-[#292820]">
                        {fb.isCorrect
                          ? `Confirmed: ${fb.predictedCategory}`
                          : `Correction: ${fb.predictedCategory} → ${fb.correctedCategory || 'Other'}`}
                      </p>
                      <p className="text-[#777469] font-mono tabular-nums">
                        Model {fb.modelId} · {(fb.predictedConfidence * 100).toFixed(0)}% confidence · Status: {fb.status}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {fb.status !== 'applied' && (
                        <button
                          type="button"
                          onClick={() => void handleFeedbackAction(fb.feedbackId, 'applied')}
                          className="px-3 py-1 rounded border border-[#777C61] text-[#777C61] cursor-pointer"
                        >
                          Mark Applied
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleFeedbackAction(fb.feedbackId, 'delete')}
                        className="px-3 py-1 rounded border border-[#D9D3C8] text-[#777469] hover:text-[#AD7961] cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'policies' && (
            <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-2xl p-6 space-y-6 max-w-2xl">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#292820]">
                <SlidersHorizontal className="w-4 h-4 text-[#777C61]" />
                <span>Session Duration &amp; Data Retention Policies</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-[#777469]">Session Timeout (Minutes)</span>
                  <input
                    type="number"
                    min={5}
                    max={480}
                    value={overview.educatorSettings.sessionDurationMinutes}
                    onChange={(e) =>
                      void handleUpdatePolicy({
                        sessionDurationMinutes: Math.max(5, Math.min(480, Number(e.target.value))),
                      })
                    }
                    className="w-full px-3 py-2 text-sm rounded-md border border-[#D9D3C8] bg-[#F4F1EA] font-mono tabular-nums"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-[#777469]">Max Uploads Per Session</span>
                  <input
                    type="number"
                    min={5}
                    max={200}
                    value={overview.educatorSettings.maxUploadImagesPerSession}
                    onChange={(e) =>
                      void handleUpdatePolicy({
                        maxUploadImagesPerSession: Math.max(5, Math.min(200, Number(e.target.value))),
                      })
                    }
                    className="w-full px-3 py-2 text-sm rounded-md border border-[#D9D3C8] bg-[#F4F1EA] font-mono tabular-nums"
                  />
                </label>
              </div>

              <div className="space-y-3 pt-2 border-t border-[#D9D3C8]">
                {(
                  [
                    [
                      'autoCleanupOnFinish',
                      'Automatic Workspace Cleanup on Finish',
                      'Delete temporary session uploads and workspace data immediately when a participant finishes.',
                    ],
                    [
                      'retainAnonymousFeedback',
                      'Retain Approved De-Identified Feedback',
                      'Keep verified, de-identified prediction feedback across sessions to guide future improvement.',
                    ],
                    [
                      'allowSharedModelPromotion',
                      'Allow Participant Model Proposals',
                      'Allow participants whose trained models pass evaluation to submit candidates for Educator review.',
                    ],
                  ] as const
                ).map(([key, title, desc]) => {
                  const enabled = overview.educatorSettings[key];
                  return (
                    <div key={key} className="flex items-center justify-between gap-4 py-2">
                      <div>
                        <p className="text-sm font-medium text-[#292820]">{title}</p>
                        <p className="text-xs text-[#777469]">{desc}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleUpdatePolicy({ [key]: !enabled })}
                        className={`px-3.5 py-1.5 text-xs font-medium rounded-md border cursor-pointer shrink-0 ${
                          enabled
                            ? 'bg-[#777C61] text-[#FFFFFF] border-[#777C61]'
                            : 'bg-[#F4F1EA] text-[#777469] border-[#D9D3C8]'
                        }`}
                      >
                        {enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'history' && (
            <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-2xl divide-y divide-[#D9D3C8]">
              {overview.learningActivity.map((ev) => (
                <div key={ev.activityId} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-mono uppercase text-[#AD7961]">{ev.type}</p>
                    <p className="text-sm font-medium text-[#292820]">{ev.title}</p>
                    <p className="text-xs text-[#777469]">{ev.detail}</p>
                  </div>
                  <span className="text-xs font-mono text-[#777469] tabular-nums shrink-0">
                    {new Date(ev.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
