"use client";

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatTurn {
  id: string;
  question: string;
  answer: string;
  answer_points?: string[];
  source_counts: { PlayStore: number; AppStore: number };
  supporting_reviews: any[];
}

export default function AskView() {
  const [query, setQuery] = useState('');
  const [queryLoading, setQueryLoading] = useState(false);
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [expandedReviews, setExpandedReviews] = useState<Record<string, boolean>>({});
  
  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new history is added
  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const toggleExpand = (id: string) => {
    setExpandedReviews(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const handleAskSubmit = async (e: React.FormEvent | string) => {
    if (typeof e !== 'string') {
      e.preventDefault();
    }
    const submittedQuery = typeof e === 'string' ? e : query;
    if (!submittedQuery.trim()) return;

    try {
      setQueryLoading(true);
      setQuery(''); // clear input early for better UX
      
      const res = await fetch('http://localhost:4000/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: submittedQuery })
      });

      const data = await res.json();
      if (data.success) {
        setHistory(prev => [
          ...prev, 
          {
            id: Date.now().toString(),
            question: submittedQuery,
            answer: data.data.answer,
            answer_points: data.data.answer_points,
            source_counts: data.data.source_counts,
            supporting_reviews: data.data.supporting_reviews
          }
        ]);
      } else {
        alert(`Failed to get answer: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setQueryLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background relative overflow-hidden w-full border-l border-sidebar-border">
      {/* Scrollable Content Area */}
      <div className="flex-grow overflow-y-auto px-8 pb-32 pt-12 no-scrollbar">
        {history.length === 0 ? (
          // Welcome Screen
          <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto animate-in fade-in duration-700">
            <h1 className="text-3xl md:text-4xl font-extrabold text-foreground mb-4 text-center tracking-tight">
              What are users saying<br/>about music discovery?
            </h1>
            <p className="text-muted text-sm mb-8 text-center">Ask anything or try a popular question</p>
            
            <div className="flex flex-col gap-3 w-full">
              {[
                "Why do users feel recommendations are repetitive?",
                "What do users expect from Discover Weekly?",
                "Why do users repeat the same songs?",
                "What discovery frustrations are increasing?"
              ].map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => handleAskSubmit(q)}
                  className="w-full text-left px-5 py-3.5 rounded-xl border border-card-border bg-card text-muted hover:text-foreground hover:border-spotify hover:shadow-sm transition-all duration-200 text-sm flex items-center gap-3"
                >
                  <svg className="w-4 h-4 text-spotify opacity-70" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          // Chat History
          <div className="flex flex-col gap-8 max-w-3xl mx-auto">
            {history.map((turn) => (
              <div key={turn.id} className="flex flex-col gap-6 animate-in slide-in-from-bottom-4 fade-in duration-500">
                {/* User Message */}
                <div className="flex justify-end">
                  <div className="bg-user-msg text-foreground px-5 py-3 rounded-2xl rounded-tr-sm max-w-[80%] text-sm shadow-sm border border-divider">
                    {turn.question}
                  </div>
                </div>
                
                {/* AI Response */}
                <div className="flex justify-start">
                  <div className="bg-ai-msg text-foreground px-6 py-5 rounded-2xl rounded-tl-sm w-full border border-card-border shadow-sm flex flex-col gap-5">
                    <div className="text-sm leading-relaxed text-foreground markdown-body">
                      {turn.answer && (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            ul: ({node, ...props}) => <ul className="list-disc pl-5 my-3 space-y-2" {...props} />,
                            ol: ({node, ...props}) => <ol className="list-decimal pl-5 my-3 space-y-2" {...props} />,
                            li: ({node, ...props}) => <li className="pl-1" {...props} />,
                            p: ({node, ...props}) => <p className="mb-4 last:mb-0" {...props} />,
                            strong: ({node, ...props}) => <strong className="font-semibold text-foreground" {...props} />
                          }}
                        >
                          {turn.answer}
                        </ReactMarkdown>
                      )}
                      {turn.answer_points && turn.answer_points.length > 0 && (
                        <ul className="list-disc pl-5 my-3 space-y-2">
                          {turn.answer_points.map((pt, idx) => (
                            <li key={idx} className="pl-1">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  p: ({node, ...props}) => <span {...props} />,
                                  strong: ({node, ...props}) => <strong className="font-semibold text-foreground" {...props} />
                                }}
                              >
                                {pt}
                              </ReactMarkdown>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Sources Badge */}
                    {turn.source_counts && (turn.source_counts.PlayStore + turn.source_counts.AppStore > 0) && (
                      <div className="bg-background border border-divider rounded-xl p-4 flex flex-col gap-3">
                        <span className="text-[10px] font-bold text-muted uppercase tracking-wider">
                          Based on {(turn.source_counts?.PlayStore || 0) + (turn.source_counts?.AppStore || 0)} reviews from 2 sources
                        </span>
                        <div className="flex items-center gap-6">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-green-500/10 flex items-center justify-center text-green-500">
                               <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-xs font-bold">Play Store</span>
                              <span className="text-[10px] text-muted">{turn.source_counts?.PlayStore || 0} reviews</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
                               <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.14 1.36-.59 2.57-1.4 3.39-.85.86-2.11 1.44-3.14 1.36-.18-1.31.86-2.43 1.6-3.25z"/></svg>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-xs font-bold">App Store</span>
                              <span className="text-[10px] text-muted">{turn.source_counts?.AppStore || 0} reviews</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Expandable Supporting Reviews */}
                    {turn.supporting_reviews && (
                      <div className="border border-divider rounded-xl overflow-hidden bg-background">
                        {turn.supporting_reviews.length >= 3 ? (
                          <>
                            <button 
                              onClick={() => toggleExpand(turn.id)}
                              className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-sidebar transition-colors"
                            >
                              <div className="flex items-center gap-2 text-sm font-medium">
                                <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                </svg>
                                View supporting reviews ({turn.supporting_reviews.length})
                              </div>
                              <svg className={`w-4 h-4 text-muted transition-transform duration-300 ${expandedReviews[turn.id] ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                            
                            {expandedReviews[turn.id] && (
                              <div className="p-4 border-t border-divider flex flex-col gap-4 bg-background">
                                {turn.supporting_reviews.map((r, i) => (
                                  <div key={i} className="flex gap-3 pb-4 border-b border-divider last:border-0 last:pb-0">
                                    <div className="w-6 h-6 rounded-full bg-spotify/10 flex-shrink-0 flex items-center justify-center text-spotify mt-1">
                                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/></svg>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                      <div className="text-[10px] font-bold text-muted uppercase tracking-wider flex gap-2">
                                        <span>{r.sentiment || 'Neutral'}</span>
                                        <span>•</span>
                                        <span className="text-spotify">{r.theme || 'Feedback'}</span>
                                      </div>
                                      <p className="text-sm text-foreground whitespace-pre-line leading-relaxed">
                                        {r.review_text || "Review details unavailable"}
                                      </p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="px-4 py-3 bg-card text-xs text-muted flex items-center gap-2">
                            <svg className="w-4 h-4 text-muted/70 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            Not enough relevant reviews found
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            
            {/* Loading Indicator */}
            {queryLoading && (
              <div className="flex justify-start">
                <div className="bg-ai-msg text-foreground px-6 py-5 rounded-2xl rounded-tl-sm w-full border border-card-border shadow-sm animate-pulse flex flex-col gap-3">
                  <div className="h-4 bg-divider rounded w-1/4" />
                  <div className="h-3 bg-divider rounded w-3/4" />
                  <div className="h-3 bg-divider rounded w-5/6" />
                </div>
              </div>
            )}
            
            <div ref={endOfMessagesRef} />
          </div>
        )}
      </div>

      {/* Fixed Bottom Input */}
      <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-background via-background/90 to-transparent pt-12 pb-8 px-8 pointer-events-none">
        <form 
          onSubmit={handleAskSubmit} 
          className="max-w-3xl mx-auto relative flex items-center bg-card border border-card-border rounded-xl shadow-lg shadow-black/5 pointer-events-auto"
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask follow-up..."
            className="w-full bg-transparent px-5 py-4 text-sm text-foreground focus:outline-none placeholder:text-muted"
            disabled={queryLoading}
          />
          <button
            type="submit"
            disabled={queryLoading || !query.trim()}
            className={`absolute right-2 p-2.5 rounded-lg transition-colors ${
              !query.trim() || queryLoading
                ? 'text-muted bg-transparent cursor-not-allowed'
                : 'bg-foreground text-background hover:bg-spotify hover:text-white'
            }`}
          >
            {queryLoading ? (
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75" />
              </svg>
            )}
          </button>
        </form>
        <div className="text-center mt-3 text-[10px] text-muted pointer-events-auto">
          AI-generated responses may contain inaccuracies. Verify supporting reviews.
        </div>
      </div>
    </div>
  );
}
