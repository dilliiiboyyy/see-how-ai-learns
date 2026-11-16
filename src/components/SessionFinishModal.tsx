import { useEffect, useState } from 'react';
import { X, Download, CheckCircle2, ShieldAlert } from 'lucide-react';
import { usePlatform, type SessionSummaryData } from '../context/PlatformContext';

export function SessionFinishModal() {
  const {
    finishModalOpen,
    setFinishModalOpen,
    fetchSessionSummary,
    finishSession,
    inFlightCount,
    session,
  } = usePlatform();

  const [loading, setLoading] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [summary, setSummary] = useState<SessionSummaryData | null>(null);
  const [takeaways, setTakeaways] = useState<string[]>([]);

  useEffect(() => {
    if (!finishModalOpen) return;
    setLoading(true);
    void fetchSessionSummary()
      .then((res) => {
        if (res) {
          setSummary(res.summary);
          setTakeaways(res.takeaways);
        }
      })
      .finally(() => setLoading(false));
  }, [finishModalOpen, fetchSessionSummary]);

  if (!finishModalOpen) return null;

  const handleExportSummary = () => {
    if (!summary) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      platform: 'See How AI Learns',
      summary,
      takeaways,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-summary-${summary.sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleConfirmFinish = async () => {
    setFinishing(true);
    try {
      await finishSession();
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#292820]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Finish participant session"
    >
      <div className="w-full max-w-xl bg-[#F4F1EA] border border-[#D9D3C8] rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 bg-[#FFFFFF] border-b border-[#D9D3C8]">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#292820]">Finish Participant Session</h2>
            <p className="text-xs text-[#777469]">
              Session {session?.nickname || session?.sessionId} · Summary &amp; Automatic Reset
            </p>
          </div>
          <button
            type="button"
            disabled={finishing}
            onClick={() => setFinishModalOpen(false)}
            className="w-9 h-9 inline-flex items-center justify-center rounded-md text-[#777469] hover:text-[#292820] cursor-pointer"
            aria-label="Cancel finish session"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {loading ? (
            <p className="text-sm text-[#777469] py-6 text-center">Preparing your session summary...</p>
          ) : summary ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-lg p-3">
                  <p className="text-[11px] text-[#777469]">Categories Used</p>
                  <p className="font-mono text-lg font-semibold text-[#292820] tabular-nums mt-0.5">
                    {summary.categoriesCreated}
                  </p>
                </div>
                <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-lg p-3">
                  <p className="text-[11px] text-[#777469]">Training Images</p>
                  <p className="font-mono text-lg font-semibold text-[#292820] tabular-nums mt-0.5">
                    {summary.imagesAdded}
                  </p>
                </div>
                <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-lg p-3">
                  <p className="text-[11px] text-[#777469]">Models Trained / Tested</p>
                  <p className="font-mono text-lg font-semibold text-[#292820] tabular-nums mt-0.5">
                    {summary.modelsTrained} / {summary.modelsTested}
                  </p>
                </div>
                <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-lg p-3">
                  <p className="text-[11px] text-[#777469]">Predictions Run</p>
                  <p className="font-mono text-lg font-semibold text-[#292820] tabular-nums mt-0.5">
                    {summary.predictionsCount}
                  </p>
                </div>
                <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-lg p-3">
                  <p className="text-[11px] text-[#777469]">Verified Correct</p>
                  <p className="font-mono text-lg font-semibold text-[#777C61] tabular-nums mt-0.5">
                    {summary.verifiedCorrectCount}
                  </p>
                </div>
                <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-lg p-3">
                  <p className="text-[11px] text-[#777469]">Feedback Shared</p>
                  <p className="font-mono text-lg font-semibold text-[#292820] tabular-nums mt-0.5">
                    {summary.sharedFeedbackCount}
                  </p>
                </div>
              </div>

              <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-4 space-y-2">
                <p className="text-xs font-medium text-[#292820]">What You Learned &amp; Accomplished</p>
                <ul className="space-y-1.5">
                  {takeaways.map((t, i) => (
                    <li key={i} className="text-xs text-[#777469] flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#777C61] shrink-0 mt-0.5" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}

          <div className="bg-[#E7E1D5]/60 border border-[#D9D3C8] rounded-xl p-4 space-y-1.5 text-xs text-[#777469]">
            <p className="font-medium text-[#292820]">Before resetting for the next participant:</p>
            <p>• Any active webcam stream and camera processing will stop immediately.</p>
            <p>• Approved de-identified feedback and shared library models remain preserved.</p>
            <p>• Your temporary uploaded images, drafts, and session history will be cleared.</p>
            {inFlightCount > 0 && (
              <p className="text-[#AD7961] font-medium flex items-center gap-1.5 pt-1">
                <ShieldAlert className="w-3.5 h-3.5" />
                Waiting for {inFlightCount} in-flight save operation(s) before clearing...
              </p>
            )}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
            <button
              type="button"
              disabled={!summary}
              onClick={handleExportSummary}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md border border-[#D9D3C8] bg-[#FFFFFF] text-xs font-medium text-[#292820] hover:bg-[#E7E1D5]/50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export Summary (.json)
            </button>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={finishing}
                onClick={() => setFinishModalOpen(false)}
                className="px-4 py-2.5 rounded-md border border-[#D9D3C8] bg-[#FFFFFF] text-xs font-medium text-[#777469] cursor-pointer"
              >
                Keep Working
              </button>
              <button
                type="button"
                disabled={finishing}
                onClick={() => void handleConfirmFinish()}
                className="px-5 py-2.5 rounded-md bg-[#AD7961] text-[#FFFFFF] text-xs font-medium hover:opacity-90 disabled:opacity-60 cursor-pointer"
              >
                {finishing ? 'Saving & Resetting...' : 'Confirm & Finish Session'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
