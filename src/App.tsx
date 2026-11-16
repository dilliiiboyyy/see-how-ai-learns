import { useState } from 'react';
import { PlatformProvider, usePlatform } from './context/PlatformContext';
import { Navbar } from './components/Navbar';
import { SettingsModal } from './components/SettingsModal';
import { ParticipantStartScreen } from './components/ParticipantStartScreen';
import { SessionFinishModal } from './components/SessionFinishModal';
import { HomePage } from './pages/HomePage';
import { ExplorePage } from './pages/ExplorePage';
import { LearnPage } from './pages/LearnPage';
import { StudioPage } from './pages/StudioPage';
import { TestPage } from './pages/TestPage';
import { ModelsPage } from './pages/ModelsPage';
import { EducatorPage } from './pages/EducatorPage';

const GUIDED_STEPS = [
  '1. Start session',
  '2. Categories',
  '3. Add images',
  '4. Train / model',
  '5. Test AI',
  '6. Review',
  '7. Feedback',
  '8. Finish',
];

function SessionWorkflowBar() {
  const { session, sessionModels, activeClassifier, finishModalOpen, setFinishModalOpen } = usePlatform();
  if (!session) return null;

  const totalImgs =
    session.categories.reduce((acc, c) => acc + c.images.length, 0) +
    session.projects.reduce((acc, p) => acc + p.categories.reduce((s, c) => s + c.images.length, 0), 0);

  const completedSteps = [
    true, // 1. Start session
    session.categories.length >= 2, // 2. Create/select categories
    totalImgs >= 4 || Boolean(activeClassifier), // 3. Add training images
    sessionModels.length > 0 || Boolean(activeClassifier), // 4. Train or use model
    session.predictionsCount > 0, // 5. Test AI
    session.predictionsCount > 0, // 6. Review results
    session.feedbackCount > 0, // 7. Submit feedback
    finishModalOpen, // 8. Finish session
  ];

  const remainingMins = Math.max(
    0,
    Math.round((new Date(session.expiresAt).getTime() - Date.now()) / 60000),
  );

  return (
    <div className="border-b border-[#D9D3C8] bg-[#E7E1D5]/45">
      <div className="max-w-[1280px] mx-auto px-5 sm:px-8 py-2.5 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
        <div className="flex items-center gap-3 text-xs text-[#777469] shrink-0">
          <span className="font-medium text-[#292820]">
            {session.nickname ? session.nickname : 'Participant'}
          </span>
          <span className="font-mono">{session.sessionId}</span>
          <span className="tabular-nums">{remainingMins}m left</span>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {GUIDED_STEPS.map((label, idx) => {
            const done = completedSteps[idx];
            const isFinish = idx === 7;
            if (isFinish) {
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setFinishModalOpen(true)}
                  className="px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap border border-[#AD7961] text-[#AD7961] bg-[#FFFFFF] hover:bg-[#AD7961] hover:text-[#FFFFFF] transition-colors cursor-pointer"
                >
                  {label}
                </button>
              );
            }
            return (
              <span
                key={label}
                className={`px-2 py-1 rounded text-[11px] whitespace-nowrap border ${
                  done
                    ? 'border-[#777C61] bg-[#FFFFFF] text-[#292820] font-medium'
                    : 'border-[#D9D3C8] bg-[#F4F1EA] text-[#777469]'
                }`}
              >
                {label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MainShell() {
  const { page, navigate, setSettingsOpen, session, sessionInitializing, setFinishModalOpen } = usePlatform();
  const [educatorFromStart, setEducatorFromStart] = useState(false);

  if (sessionInitializing) {
    return (
      <div className="min-h-screen bg-[#F4F1EA] flex items-center justify-center text-sm text-[#777469]">
        Preparing EdEx workspace...
      </div>
    );
  }

  if (!session) {
    if (educatorFromStart) {
      return (
        <div className="min-h-screen bg-[#F4F1EA] text-[#292820]">
          <EducatorPage onBack={() => setEducatorFromStart(false)} />
        </div>
      );
    }
    return <ParticipantStartScreen onOpenEducator={() => setEducatorFromStart(true)} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F4F1EA] text-[#292820]">
      <Navbar />
      <SessionWorkflowBar />

      <main className="flex-1">
        {page === 'home' && <HomePage />}
        {page === 'explore' && <ExplorePage />}
        {page === 'learn' && <LearnPage />}
        {page === 'studio' && <StudioPage />}
        {page === 'test' && <TestPage />}
        {page === 'models' && <ModelsPage />}
        {page === 'educator' && <EducatorPage />}
      </main>

      <footer className="border-t border-[#D9D3C8] bg-[#F4F1EA]">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-[#777469]">
          <p className="font-medium text-[#292820]">See How AI Learns · Session {session.sessionId}</p>
          <div className="flex flex-wrap items-center gap-5">
            <button type="button" onClick={() => navigate('explore')} className="hover:text-[#292820] cursor-pointer">
              Explore Dataset
            </button>
            <button type="button" onClick={() => navigate('learn')} className="hover:text-[#292820] cursor-pointer">
              Interactive Lessons
            </button>
            <button type="button" onClick={() => navigate('studio')} className="hover:text-[#292820] cursor-pointer">
              Model Studio
            </button>
            <button type="button" onClick={() => setSettingsOpen(true)} className="hover:text-[#292820] cursor-pointer">
              Settings &amp; Firebase
            </button>
            <button
              type="button"
              onClick={() => setFinishModalOpen(true)}
              className="font-medium text-[#AD7961] hover:underline cursor-pointer"
            >
              Finish Session
            </button>
          </div>
        </div>
      </footer>

      <SettingsModal />
      <SessionFinishModal />
    </div>
  );
}

export default function App() {
  return (
    <PlatformProvider>
      <MainShell />
    </PlatformProvider>
  );
}
