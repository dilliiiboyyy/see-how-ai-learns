import { useState } from 'react';
import { ArrowRight, ShieldCheck, Layers, Sparkles } from 'lucide-react';
import { usePlatform } from '../context/PlatformContext';

export function ParticipantStartScreen({ onOpenEducator }: { onOpenEducator: () => void }) {
  const { startSession, firebaseStatus, sharedModels, sessionNotice } = usePlatform();
  const [nickname, setNickname] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setStarting(true);
    try {
      await startSession({
        nickname: nickname.trim() || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start session');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F1EA] text-[#292820] flex flex-col justify-between">
      <header className="border-b border-[#D9D3C8] bg-[#F4F1EA]/95">
        <div className="max-w-[1120px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <span className="font-display text-lg font-semibold tracking-tight text-[#292820]">
            See How AI Learns.
          </span>
          <button
            type="button"
            onClick={onOpenEducator}
            className="text-xs font-medium text-[#777469] hover:text-[#292820] px-3 py-1.5 rounded-md border border-[#D9D3C8] bg-[#FFFFFF] cursor-pointer"
          >
            Educator Console
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-5 sm:px-8 py-14">
        <div className="w-full max-w-[980px] grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7 space-y-6">
            {sessionNotice && (
              <div className="px-4 py-3 rounded-lg bg-[#FFFFFF] border border-[#777C61] text-xs text-[#292820] flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#777C61] shrink-0" />
                <span>{sessionNotice}</span>
              </div>
            )}

            <p className="text-xs text-[#777469]">
              EdEx Interactive ML Workspace
              <span className="mx-2" aria-hidden="true">·</span>
              <span>Private Per-Participant Session</span>
            </p>

            <h1 className="font-display text-4xl sm:text-5xl font-semibold leading-[1.08] text-[#292820] [text-wrap:balance]">
              Welcome to See How AI Learns.
            </h1>

            <p className="text-lg sm:text-xl text-[#777469] leading-relaxed">
              Ready to teach a machine something new?
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-medium text-[#777C61]">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Fresh &amp; Private Workspace</span>
                </div>
                <p className="text-xs text-[#777469] leading-relaxed">
                  Your uploaded images, custom categories, models, and predictions stay isolated to your session and clear automatically when you finish.
                </p>
              </div>
              <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-medium text-[#AD7961]">
                  <Layers className="w-4 h-4" />
                  <span>Shared Learning Library</span>
                </div>
                <p className="text-xs text-[#777469] leading-relaxed">
                  Start immediately with {firebaseStatus?.totalImages ?? 600} curated examples and {sharedModels.length} approved shared model{sharedModels.length === 1 ? '' : 's'}.
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 bg-[#FFFFFF] border border-[#D9D3C8] rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="space-y-1">
              <h2 className="font-display text-xl font-semibold text-[#292820]">Start Your Session</h2>
              <p className="text-xs text-[#777469]">
                No permanent account needed. Optional details help you recognize your session tab.
              </p>
            </div>

            <form onSubmit={(e) => void handleStart(e)} className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#777469]">Nickname (optional)</span>
                <input
                  type="text"
                  maxLength={48}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="e.g. Alex or Table 4"
                  className="w-full px-3.5 py-2.5 text-sm rounded-md border border-[#D9D3C8] bg-[#F4F1EA] text-[#292820]"
                />
              </label>

              {error && <p className="text-xs text-[#AD7961]">{error}</p>}

              <button
                type="submit"
                disabled={starting}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md bg-[#777C61] text-[#FFFFFF] text-sm font-medium hover:bg-[#666B52] disabled:opacity-60 transition-colors cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                {starting ? 'Preparing Clean Workspace...' : 'Start a Session'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="pt-4 border-t border-[#D9D3C8] text-[11px] text-[#777469] leading-relaxed">
              8-step guided activity: Start session → Pick categories → Add images → Train or load a model → Test AI → Review results → Submit feedback → Finish session.
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-[#D9D3C8] bg-[#F4F1EA]">
        <div className="max-w-[1120px] mx-auto px-5 sm:px-8 py-5 flex items-center justify-between text-xs text-[#777469]">
          <span>See How AI Learns · Shared-device ready</span>
          <span className="tabular-nums">{firebaseStatus?.totalImages ?? 600} curated library examples</span>
        </div>
      </footer>
    </div>
  );
}
