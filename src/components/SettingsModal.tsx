import { useEffect, useState } from 'react';
import { X, LogIn, LogOut, Database, Play, Pause, RefreshCw, ShieldCheck } from 'lucide-react';
import { usePlatform } from '../context/PlatformContext';

interface AutonomousSettingsState {
  autonomousEnabled: boolean;
  autoCollectEnabled: boolean;
  autoRetrainEnabled: boolean;
  paused: boolean;
  maxDailyImages: number;
  retrainFrequencyHours: number;
  minConfidenceThreshold: number;
  lastRunAt: string | null;
  dailyCollectedCount: number;
}

export function SettingsModal() {
  const {
    settingsOpen,
    setSettingsOpen,
    user,
    isEducator,
    getIdToken,
    signIn,
    signOut,
    firestoreState,
    firebaseStatus,
    refreshFirebaseStatus,
    navigate,
    session,
  } = usePlatform();

  const [tab, setTab] = useState<'account' | 'autonomous' | 'firebase'>('account');
  const [authError, setAuthError] = useState('');
  const [settings, setSettings] = useState<AutonomousSettingsState | null>(null);
  const [runningCycle, setRunningCycle] = useState(false);
  const [cycleMessage, setCycleMessage] = useState('');

  useEffect(() => {
    if (!settingsOpen) return;
    fetch('/api/autonomous/status')
      .then((r) => r.json())
      .then((data) => {
        if (data.settings) setSettings(data.settings);
      })
      .catch(() => {});
  }, [settingsOpen]);

  if (!settingsOpen) return null;

  const updateSettings = async (patch: Partial<AutonomousSettingsState>) => {
    const token = await getIdToken();
    if (!token) {
      setCycleMessage('Sign in as Educator to modify system learning controls.');
      return;
    }
    const res = await fetch('/api/autonomous/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = await res.json();
      setSettings(data.settings);
      setCycleMessage('');
    } else {
      const err = await res.json().catch(() => ({}));
      setCycleMessage(err.error || 'Educator permission required.');
    }
  };

  const handleRunCycle = async () => {
    const token = await getIdToken();
    if (!token) {
      setCycleMessage('Educator sign-in required to manually trigger autonomous cycles.');
      return;
    }
    setRunningCycle(true);
    setCycleMessage('');
    try {
      const res = await fetch('/api/autonomous/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ maxCollect: 3 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCycleMessage(data.error || 'Unable to run cycle.');
      } else if (data.skipped) {
        setCycleMessage(data.reason || 'Cycle skipped.');
      } else {
        setCycleMessage(
          `Targeted ${data.targetCategory}: collected ${data.collectedCount} verified image(s), filtered ${data.duplicateRejected} duplicate(s).`,
        );
        void refreshFirebaseStatus();
        const stRes = await fetch('/api/autonomous/status');
        const stData = await stRes.json();
        if (stData.settings) setSettings(stData.settings);
      }
    } catch {
      setCycleMessage('Unable to execute autonomous cycle.');
    } finally {
      setRunningCycle(false);
    }
  };

  const handleSignIn = async () => {
    setAuthError('');
    try {
      await signIn();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign in failed');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#292820]/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Session and platform settings"
    >
      <div className="w-full max-w-2xl bg-[#F4F1EA] border border-[#D9D3C8] rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#D9D3C8] bg-[#FFFFFF]">
          <h2 className="font-display text-lg font-semibold text-[#292820]">Platform &amp; Educator Settings</h2>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            className="w-9 h-9 inline-flex items-center justify-center rounded-md text-[#777469] hover:text-[#292820] hover:bg-[#E7E1D5]/50 cursor-pointer"
            aria-label="Close settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-[#D9D3C8] bg-[#E7E1D5]/50 px-6 gap-6">
          {(
            [
              ['account', 'Session & Educator Auth'],
              ['autonomous', 'Autonomous Controls'],
              ['firebase', 'Firebase Infrastructure'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`py-3 text-sm border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                tab === id
                  ? 'border-[#777C61] text-[#292820] font-medium'
                  : 'border-transparent text-[#777469] hover:text-[#292820]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-6 max-h-[75vh] overflow-y-auto space-y-6">
          {tab === 'account' && (
            <div className="space-y-5">
              {session && (
                <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-lg p-5 space-y-2 text-xs">
                  <p className="text-sm font-medium text-[#292820]">Active Participant Session</p>
                  <p className="text-[#777469]">
                    Session ID: <span className="font-mono text-[#292820]">{session.sessionId}</span>
                  </p>
                  <p className="text-[#777469]">
                    Participant: <span className="text-[#292820]">{session.nickname || 'Anonymous'}</span> · Expires{' '}
                    {new Date(session.expiresAt).toLocaleTimeString()}
                  </p>
                </div>
              )}

              <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-lg p-5">
                {user ? (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <p className="text-base font-medium text-[#292820]">{user.displayName || 'Educator'}</p>
                      <p className="text-sm text-[#777469]">{user.email}</p>
                      <p className="text-xs text-[#777C61]">
                        {isEducator
                          ? 'Verified EdEx Educator — full console & policy controls unlocked.'
                          : 'Signed in as visitor — educator admin controls require authorized account.'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isEducator && (
                        <button
                          type="button"
                          onClick={() => {
                            setSettingsOpen(false);
                            navigate('educator');
                          }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md bg-[#777C61] text-[#FFFFFF] cursor-pointer"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          Open Educator Console
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void signOut()}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-[#D9D3C8] bg-[#F4F1EA] text-[#292820] hover:bg-[#E7E1D5] cursor-pointer"
                      >
                        <LogOut className="w-4 h-4" />
                        Sign out
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-base font-medium text-[#292820]">Educator / Admin Sign-In</h3>
                      <p className="text-sm text-[#777469] mt-1">
                        Participants do not need an account. Educators can sign in with Google to review sessions, approve shared models, and configure retention settings.
                      </p>
                    </div>
                    {authError && <p className="text-sm text-[#AD7961]">{authError}</p>}
                    <button
                      type="button"
                      onClick={() => void handleSignIn()}
                      className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-md bg-[#777C61] text-[#FFFFFF] hover:bg-[#666B52] transition-colors cursor-pointer"
                    >
                      <LogIn className="w-4 h-4" />
                      Educator Sign-In with Google
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'autonomous' && settings && (
            <div className="space-y-5">
              {!isEducator && (
                <div className="px-4 py-3 rounded-lg bg-[#FFFFFF] border border-[#D9D3C8] text-xs text-[#777469]">
                  Read-only view for participants. Educator Google Sign-In is required to change autonomous pipeline parameters.
                </div>
              )}
              <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-lg p-5 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-[#292820]">Autonomous Learning Pipeline</p>
                    <p className="text-xs text-[#777469]">
                      Monitors de-identified participant corrections to enrich shared datasets.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!isEducator}
                    onClick={() => void updateSettings({ autonomousEnabled: !settings.autonomousEnabled })}
                    className={`px-3.5 py-1.5 text-xs font-medium rounded-md border cursor-pointer disabled:opacity-50 ${
                      settings.autonomousEnabled
                        ? 'bg-[#777C61] text-[#FFFFFF] border-[#777C61]'
                        : 'bg-[#F4F1EA] text-[#777469] border-[#D9D3C8]'
                    }`}
                  >
                    {settings.autonomousEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-4 pt-3 border-t border-[#D9D3C8]">
                  <div>
                    <p className="text-sm font-medium text-[#292820]">Background Learning State</p>
                    <p className="text-xs text-[#777469]">
                      Daily collected: {settings.dailyCollectedCount} / {settings.maxDailyImages} images
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!isEducator}
                    onClick={() => void updateSettings({ paused: !settings.paused })}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md border border-[#D9D3C8] bg-[#F4F1EA] text-[#292820] hover:bg-[#E7E1D5] disabled:opacity-50 cursor-pointer"
                  >
                    {settings.paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                    {settings.paused ? 'Resume Learning' : 'Pause Learning'}
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#E7E1D5]/60 border border-[#D9D3C8] rounded-lg p-4">
                <div className="text-xs text-[#777469]">
                  {cycleMessage ||
                    (settings.lastRunAt
                      ? `Last cycle: ${new Date(settings.lastRunAt).toLocaleString()}`
                      : 'Trigger an immediate autonomous discovery pass (Educator only).')}
                </div>
                <button
                  type="button"
                  disabled={runningCycle || !isEducator}
                  onClick={() => void handleRunCycle()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md bg-[#777C61] text-[#FFFFFF] hover:bg-[#666B52] disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${runningCycle ? 'animate-spin' : ''}`} />
                  {runningCycle ? 'Running Cycle...' : 'Run Autonomous Cycle'}
                </button>
              </div>
            </div>
          )}

          {tab === 'firebase' && (
            <div className="space-y-4">
              <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-lg p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-[#292820]">
                  <Database className="w-4 h-4 text-[#777C61]" />
                  <span>Live Firebase &amp; EdEx Telemetry</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 border-t border-[#D9D3C8] text-sm">
                  <div>
                    <p className="text-xs text-[#777469]">Firestore Status</p>
                    <p className="font-medium text-[#292820] capitalize mt-0.5">{firestoreState}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#777469]">Shared Library</p>
                    <p className="font-medium text-[#292820] tabular-nums mt-0.5">
                      {firebaseStatus?.totalImages ?? 0} imgs
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[#777469]">Shared Models</p>
                    <p className="font-medium text-[#292820] tabular-nums mt-0.5">
                      {firebaseStatus?.modelsCount ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[#777469]">Active Stations</p>
                    <p className="font-medium text-[#292820] tabular-nums mt-0.5">
                      {firebaseStatus?.activeSessionsCount ?? 0}
                    </p>
                  </div>
                </div>
                <div className="pt-3 border-t border-[#D9D3C8] text-xs text-[#777469] space-y-1">
                  <p>
                    Project: <span className="font-mono text-[#292820]">{firebaseStatus?.projectId}</span>
                  </p>
                  <p>
                    Firestore DB: <span className="font-mono text-[#292820]">{firebaseStatus?.firestoreDatabaseId}</span>
                  </p>
                  {firebaseStatus?.storageDetail && (
                    <p className="text-[#AD7961] pt-1">{firebaseStatus.storageDetail}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
