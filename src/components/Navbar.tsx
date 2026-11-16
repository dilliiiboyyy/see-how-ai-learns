import { useState } from 'react';
import { Menu, X, Settings, LogOut } from 'lucide-react';
import { usePlatform, type AppPage } from '../context/PlatformContext';

const NAV_ITEMS: Array<{ id: AppPage; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'explore', label: 'Explore' },
  { id: 'learn', label: 'Learn' },
  { id: 'studio', label: 'Studio' },
  { id: 'test', label: 'Test' },
  { id: 'models', label: 'Models' },
];

export function Navbar() {
  const { page, navigate, setSettingsOpen, setFinishModalOpen, session, isEducator } = usePlatform();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNav = (id: AppPage) => {
    navigate(id);
    setMobileOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-[#F4F1EA]/95 backdrop-blur-sm border-b border-[#D9D3C8]">
      <div className="max-w-[1280px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-6">
        {/* Zone 1: Single-line Brand Title */}
        <button
          type="button"
          onClick={() => handleNav('home')}
          className="font-display text-lg font-semibold tracking-tight text-[#292820] whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
        >
          See How AI Learns.
        </button>

        {/* Zone 2: Clean Typography Navigation Links */}
        <nav className="hidden md:flex items-center gap-6" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const active = page === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`relative py-1 text-sm whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active ? 'font-medium text-[#292820]' : 'text-[#777469] hover:text-[#292820]'
                }`}
              >
                {item.label}
                {active && (
                  <span
                    className="absolute left-0 right-0 -bottom-[1px] h-[1.5px] bg-[#777C61]"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => handleNav('educator')}
            className={`relative py-1 text-sm whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              page === 'educator' ? 'font-medium text-[#292820]' : 'text-[#777469] hover:text-[#292820]'
            }`}
          >
            {isEducator ? 'Educator Console' : 'Educator'}
            {page === 'educator' && (
              <span
                className="absolute left-0 right-0 -bottom-[1px] h-[1.5px] bg-[#777C61]"
                aria-hidden="true"
              />
            )}
          </button>
        </nav>

        {/* Zone 3: Settings & Finish Session */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="hidden sm:inline-flex items-center justify-center w-9 h-9 rounded-md border border-[#D9D3C8] bg-[#FFFFFF] text-[#777469] hover:text-[#292820] hover:bg-[#E7E1D5]/60 transition-colors cursor-pointer"
            aria-label="Settings and system status"
            title="Settings & Firebase Status"
          >
            <Settings className="w-4 h-4" />
          </button>

          {session && (
            <button
              type="button"
              onClick={() => setFinishModalOpen(true)}
              className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md bg-[#AD7961] text-[#FFFFFF] hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Finish Session
            </button>
          )}

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-md border border-[#D9D3C8] bg-[#FFFFFF] text-[#292820] cursor-pointer"
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-[#D9D3C8] bg-[#F4F1EA] px-5 py-4 space-y-1">
          {[...NAV_ITEMS, { id: 'educator' as AppPage, label: 'Educator Console' }].map((item) => {
            const active = page === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`w-full text-left px-3 py-3 rounded-md text-sm transition-colors cursor-pointer ${
                  active ? 'bg-[#E7E1D5] text-[#292820] font-medium' : 'text-[#777469] hover:text-[#292820]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
          <div className="pt-2 border-t border-[#D9D3C8] flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false);
                setSettingsOpen(true);
              }}
              className="w-full text-left px-3 py-3 rounded-md text-sm font-medium text-[#292820] bg-[#FFFFFF] border border-[#D9D3C8] cursor-pointer"
            >
              Settings &amp; Firebase Status
            </button>
            {session && (
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  setFinishModalOpen(true);
                }}
                className="w-full text-center px-3 py-3 rounded-md text-sm font-medium text-[#FFFFFF] bg-[#AD7961] cursor-pointer"
              >
                Finish Session
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
