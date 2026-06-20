"use client";

import { useEffect, useState } from 'react';

interface SidebarProps {
  activeTab: 'ask' | 'dashboard';
  setActiveTab: (tab: 'ask' | 'dashboard') => void;
}

export default function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    // Check initial preference
    if (typeof document !== 'undefined') {
      const isDark = document.documentElement.classList.contains('dark');
      setIsDarkMode(isDark);
    }
  }, []);

  const toggleTheme = () => {
    if (typeof document !== 'undefined') {
      const isDark = document.documentElement.classList.toggle('dark');
      setIsDarkMode(isDark);
    }
  };

  return (
    <aside className="w-64 h-screen bg-sidebar border-r border-sidebar-border flex flex-col p-4 transition-colors duration-300 shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-10 pl-2 mt-2">
        <div className="w-8 h-8 rounded-full bg-spotify flex items-center justify-center shadow-lg shadow-spotify/20">
           <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
             <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.565.387-.86.207-2.377-1.454-5.37-1.783-8.894-.982-.336.076-.67-.135-.746-.472-.076-.336.136-.67.472-.746 3.848-.878 7.144-.51 9.82.128.297.18.388.565.208.865zm1.224-2.723c-.226.367-.707.487-1.074.26-2.72-1.672-6.87-2.157-10.08-1.182-.413.125-.85-.107-.975-.52-.125-.413.107-.85.52-.975 3.67-1.114 8.24-.575 11.35 1.34.367.226.487.708.26 1.076zm.105-2.81c-3.262-1.937-8.646-2.117-11.754-1.174-.5.15-1.025-.13-1.175-.63-.15-.5.13-1.026.63-1.176 3.59-1.09 9.53-.886 13.29 1.347.45.267.6.845.333 1.295-.266.45-.844.6-1.295.333l-.03-.017z" />
           </svg>
        </div>
        <div className="font-bold text-sm leading-tight text-foreground">
          Discovery<br/>Research Engine
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-2 flex-grow">
        <button
          onClick={() => setActiveTab('ask')}
          className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            activeTab === 'ask' 
              ? 'bg-card border border-sidebar-border shadow-sm text-foreground' 
              : 'text-muted hover:bg-card/50 hover:text-foreground border border-transparent'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          Ask
        </button>
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            activeTab === 'dashboard' 
              ? 'bg-card border border-sidebar-border shadow-sm text-foreground' 
              : 'text-muted hover:bg-card/50 hover:text-foreground border border-transparent'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
          </svg>
          Dashboard
        </button>
      </nav>

      {/* Theme Toggle */}
      <div className="mt-auto pt-4 border-t border-sidebar-border">
        <button
          onClick={toggleTheme}
          className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-muted hover:text-foreground transition-colors w-full border border-transparent hover:bg-card/50"
        >
          {isDarkMode ? (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              Light Mode
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
              Dark Mode
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
