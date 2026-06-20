import { useState, useEffect } from 'react';
import { AnalysisSummary } from '../types/analysis';

type ThemeType = 'Discovery' | 'Control' | 'Variety' | 'Quality' | 'Interface';

const THEME_COLORS: Record<ThemeType, string> = {
  Discovery: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  Control: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  Variety: 'bg-green-500/10 text-green-500 border-green-500/20',
  Quality: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  Interface: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
};

function assignTheme(text: string): ThemeType {
  const lower = text.toLowerCase();
  if (lower.includes('control') || lower.includes('setting') || lower.includes('slider') || lower.includes('option') || lower.includes('custom') || lower.includes('hide')) return 'Control';
  if (lower.includes('variet') || lower.includes('repetit') || lower.includes('same') || lower.includes('diverse') || lower.includes('fresh')) return 'Variety';
  if (lower.includes('discover') || lower.includes('recommend') || lower.includes('algorithm') || lower.includes('artist') || lower.includes('new')) return 'Discovery';
  if (lower.includes('ui') || lower.includes('interface') || lower.includes('button') || lower.includes('app') || lower.includes('click')) return 'Interface';
  return 'Quality';
}

interface DashboardViewProps {
  summary: AnalysisSummary | null;
  loading?: boolean;
  onRefreshComplete?: () => void;
}

export default function DashboardView({ summary, loading, onRefreshComplete }: DashboardViewProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<string>('');
  const [scrapeDetails, setScrapeDetails] = useState<any>(null);

  const getProgressMessage = (statusData: any) => {
    if (statusData.stage === 'scraping') {
      return 'Scraping fresh reviews...';
    }
    if (statusData.stage === 'classifying') {
      return `Classifying... (${statusData.classifiedCount || 0}/${statusData.totalPending || 0})`;
    }
    if (statusData.stage === 'importing') {
      return 'Importing data...';
    }
    return 'Refreshing...';
  };

  const getRichStageLabel = (stage: string) => {
    switch (stage) {
      case 'scraping':
        return "Digging through Play Store, App Store & Community... 🔍";
      case 'classifying':
        return "Teaching the AI what's bugging your users... 🧠";
      case 'importing':
        return "Tidying up the data warehouse... 📦";
      case 'idle':
        return "All set! Fresh insights are in. ✨";
      default:
        return "Refreshing user data... ⏳";
    }
  };

  const calculatePercentage = (details: any) => {
    if (!details) return 0;
    if (details.stage === 'scraping') return 0;
    if (details.stage === 'importing') return 100;
    if (details.stage === 'idle') return 100;
    if (!details.totalPending || details.totalPending === 0) return 0;
    return Math.min(Math.round((details.classifiedCount / details.totalPending) * 100), 100);
  };

  useEffect(() => {
    let pollInterval: NodeJS.Timeout;
    
    const checkInitialStatus = async () => {
      try {
        const res = await fetch(`http://localhost:4000/api/scrape/status?t=${Date.now()}`, {
          cache: 'no-store',
        });
        const data = await res.json();
        if (data.isScraping) {
          setRefreshing(true);
          setScrapeDetails(data);
          setRefreshStatus(getProgressMessage(data));
          
          pollInterval = setInterval(async () => {
            try {
              const statusRes = await fetch(`http://localhost:4000/api/scrape/status?t=${Date.now()}`, {
                cache: 'no-store',
              });
              const statusData = await statusRes.json();
              
              if (!statusData.isScraping) {
                clearInterval(pollInterval);
                setRefreshing(false);
                setScrapeDetails(null);
                setRefreshStatus('');
                if (statusData.error) {
                  alert(`Refresh failed: ${statusData.error}`);
                } else if (onRefreshComplete) {
                  onRefreshComplete();
                }
              } else {
                setScrapeDetails(statusData);
                setRefreshStatus(getProgressMessage(statusData));
              }
            } catch (pollErr) {
              console.error('Error polling scrape status:', pollErr);
            }
          }, 2000);
        }
      } catch (err) {
        console.error('Error checking initial scraping status:', err);
      }
    };
    
    checkInitialStatus();
    
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [onRefreshComplete]);

  const handleRefresh = async () => {
    if (refreshing) return;
    try {
      setRefreshing(true);
      setRefreshStatus('Starting scraper...');
      setScrapeDetails({ stage: 'scraping', classifiedCount: 0, totalPending: 0 });
      
      const res = await fetch('http://localhost:4000/api/scrape', {
        method: 'POST',
      });
      const data = await res.json();
      if (!data.success && data.message !== 'Scrape already in progress') {
        throw new Error(data.message || 'Failed to start scraping');
      }

      setRefreshStatus('Scraping in progress...');
      
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`http://localhost:4000/api/scrape/status?t=${Date.now()}`, {
            cache: 'no-store',
          });
          const statusData = await statusRes.json();
          
          if (!statusData.isScraping) {
            clearInterval(pollInterval);
            setRefreshing(false);
            setScrapeDetails(null);
            setRefreshStatus('');
            if (statusData.error) {
              alert(`Refresh failed: ${statusData.error}`);
            } else if (onRefreshComplete) {
              onRefreshComplete();
            }
          } else {
            setScrapeDetails(statusData);
            setRefreshStatus(getProgressMessage(statusData));
          }
        } catch (pollErr) {
          console.error('Error polling scrape status:', pollErr);
        }
      }, 2000);

    } catch (err: any) {
      console.error(err);
      alert(err.message || 'An error occurred while starting refresh.');
      setRefreshing(false);
      setScrapeDetails(null);
      setRefreshStatus('');
    }
  };

  if (loading || !summary) {
    return (
      <div className="w-full h-full p-8 bg-background flex flex-col gap-6 animate-pulse">
        <div className="h-8 bg-card-border rounded w-48 mb-4"></div>
        <div className="grid grid-cols-4 gap-4">
          <div className="h-24 bg-card-border rounded-xl"></div>
          <div className="h-24 bg-card-border rounded-xl"></div>
          <div className="h-24 bg-card-border rounded-xl"></div>
          <div className="h-24 bg-card-border rounded-xl"></div>
        </div>
        <div className="h-64 bg-card-border rounded-xl mt-4"></div>
      </div>
    );
  }

  // Format date to something like "May 18, 2026"
  const lastUpdated = new Date().toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });

  const maxPainPointCount = summary.topPainPoints.length > 0 ? summary.topPainPoints[0].count : 1;

  // Group user needs by theme
  const groupedNeeds: Record<string, typeof summary.topUserNeeds> = {};
  if (summary && summary.topUserNeeds) {
    // Increase to 10 to ensure we get a good spread of needs to group
    summary.topUserNeeds.slice(0, 10).forEach(need => {
      const theme = assignTheme(need.name);
      if (!groupedNeeds[theme]) groupedNeeds[theme] = [];
      groupedNeeds[theme].push(need);
    });
  }

  return (
    <div className="w-full h-full p-8 md:p-12 overflow-y-auto bg-background text-foreground border-l border-sidebar-border">
      <div className="max-w-5xl mx-auto flex flex-col gap-8">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-divider pb-4">
          <div className="flex items-baseline gap-4">
            <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
            <span className="text-xs text-muted">Last updated: {lastUpdated}</span>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold border transition-all duration-200 ${
                refreshing
                  ? 'bg-card border-card-border text-muted cursor-not-allowed'
                  : 'bg-spotify border-spotify hover:bg-spotify/90 text-white shadow-sm'
              }`}
            >
              {refreshing ? (
                <>
                  <svg className="animate-spin h-3.5 w-3.5 text-muted" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {scrapeDetails ? `Refreshing (${calculatePercentage(scrapeDetails)}%)` : (refreshStatus || 'Refreshing...')}
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                  Refresh Data
                </>
              )}
            </button>
          </div>
        </div>

        {/* Rich Scraper Progress UI Card when refreshing is active */}
        {refreshing && scrapeDetails && (
          <div className="bg-card border border-spotify/20 rounded-xl p-6 shadow-md flex flex-col gap-4 transition-all duration-300">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <div className="flex items-center gap-3">
                <div className="relative flex h-3.5 w-3.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-spotify opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-spotify"></span>
                </div>
                <span className="text-sm font-semibold tracking-wide text-foreground">
                  {getRichStageLabel(scrapeDetails.stage)}
                </span>
              </div>
              {scrapeDetails.stage === 'classifying' && scrapeDetails.totalPending > 0 && (
                <span className="text-xs font-semibold text-muted font-mono bg-sidebar-border px-3 py-1 rounded-full whitespace-nowrap self-start sm:self-auto">
                  Classified {scrapeDetails.classifiedCount} of {scrapeDetails.totalPending} ({calculatePercentage(scrapeDetails)}%)
                </span>
              )}
            </div>

            {/* Visual progress bar container */}
            <div className="w-full bg-sidebar-border h-2 rounded-full overflow-hidden relative">
              <div
                className="h-full bg-gradient-to-r from-spotify to-green-400 transition-all duration-500 ease-out rounded-full"
                style={{ width: `${calculatePercentage(scrapeDetails)}%` }}
              />
            </div>
            
            {/* Context/status line */}
            <div className="flex justify-between items-center text-[10px] text-muted">
              <span>Status: <span className="font-bold text-spotify">{scrapeDetails.stage.toUpperCase()}</span></span>
              {scrapeDetails.stage === 'scraping' && <span>Fetching playstore, appstore & community feeds...</span>}
              {scrapeDetails.stage === 'classifying' && <span>Rate-limit batching active (2s delay per 10 reviews)</span>}
              {scrapeDetails.stage === 'importing' && <span>Upserting records to Supabase storage...</span>}
            </div>
          </div>
        )}

        {/* Top Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-card border border-card-border rounded-xl p-5 shadow-sm flex flex-col justify-center items-center gap-1 hover:border-spotify transition-colors">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">Total Reviews</span>
            <span className="text-3xl font-bold">{summary.totalReviews}</span>
          </div>
          <div className="bg-card border border-card-border rounded-xl p-5 shadow-sm flex flex-col justify-center items-center gap-1 hover:border-spotify transition-colors">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">Play Store</span>
            <span className="text-3xl font-bold">{summary.sources.PlayStore}</span>
          </div>
          <div className="bg-card border border-card-border rounded-xl p-5 shadow-sm flex flex-col justify-center items-center gap-1 hover:border-spotify transition-colors">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">App Store</span>
            <span className="text-3xl font-bold">{summary.sources.AppStore}</span>
          </div>
          <div className="bg-card border border-card-border rounded-xl p-5 shadow-sm flex flex-col justify-center items-center gap-1 hover:border-spotify transition-colors">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">Community</span>
            <span className="text-3xl font-bold">{summary.sources.SpotifyCommunity ?? 0}</span>
          </div>
        </div>

        {/* Top Pain Points Section */}
        <div className="bg-card border border-card-border rounded-xl p-6 shadow-sm">
          <h2 className="text-base font-bold mb-6">Top Pain Points</h2>
          
          <div className="flex flex-col gap-5">
            {summary.topPainPoints.length > 0 ? (
              summary.topPainPoints.map((pp, idx) => (
                <div key={idx} className="flex items-center gap-4">
                  <span className="text-sm font-medium w-1/3 truncate" title={pp.name}>
                    {pp.name}
                  </span>
                  <div className="flex-grow flex items-center h-2 bg-sidebar-border rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-spotify transition-all duration-1000 ease-out" 
                      style={{ width: `${Math.max((pp.count / maxPainPointCount) * 100, 2)}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted w-24 text-right tabular-nums">
                    {pp.count} ({pp.percentage}%)
                  </span>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted text-center py-4">No pain points analyzed yet.</div>
            )}
          </div>
        </div>

        {/* Top User Needs */}
        <div className="bg-card border border-card-border rounded-xl p-6 shadow-sm flex flex-col h-full">
          <h2 className="text-base font-bold mb-6">Top User Needs</h2>
          
          <div className="flex flex-col gap-8 flex-grow">
            {summary.topUserNeeds.length > 0 ? (
              Object.entries(groupedNeeds).map(([theme, needs]) => (
                <div key={theme} className="flex flex-col gap-3">
                  <h3 className="text-xs font-bold text-muted uppercase tracking-wider">{theme}</h3>
                  <ul className="flex flex-col gap-3">
                    {needs.map((need, idx) => (
                      <li key={idx} className="text-sm flex items-start justify-between gap-4 text-foreground bg-background p-3 rounded-lg border border-card-border">
                        <span className="leading-snug">{need.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap font-medium ${THEME_COLORS[theme as ThemeType]}`}>
                          {theme}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted">No user needs analyzed yet.</div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
