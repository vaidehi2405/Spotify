"use client";

import { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import AskView, { ChatTurn } from '../components/AskView';
import DashboardView from '../components/DashboardView';
import { AnalysisSummary } from '../types/analysis';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'ask' | 'dashboard'>('ask');
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);

  // Fetch summary data
  const fetchData = async () => {
    try {
      setLoading(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const summaryRes = await fetch(`${apiUrl}/api/analysis-summary?t=${Date.now()}`, {
        cache: 'no-store',
      });
      const summaryData = await summaryRes.json();
      if (summaryData.success) {
        setSummary(summaryData.summary);
      } else {
        throw new Error(summaryData.error || 'Failed to fetch summary');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred while loading data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-sans selection:bg-spotify selection:text-white transition-colors duration-300">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <main className="flex-grow h-full overflow-hidden">
        {activeTab === 'ask' ? (
          <AskView 
            history={chatHistory} 
            onHistoryChange={setChatHistory} 
            onClearHistory={() => setChatHistory([])}
          />
        ) : (
          <DashboardView summary={summary} loading={loading} onRefreshComplete={fetchData} />
        )}
      </main>
    </div>
  );
}
