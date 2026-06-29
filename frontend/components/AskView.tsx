"use client";

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface ChatTurn {
  id: string;
  question: string;
  answer: string;
  answer_points?: string[];
  source_counts: { PlayStore: number; AppStore: number; SpotifyCommunity?: number };
  supporting_reviews: any[];
}

interface AskViewProps {
  history: ChatTurn[];
  onHistoryChange: (history: ChatTurn[]) => void;
  onClearHistory: () => void;
}

export default function AskView({ history, onHistoryChange, onClearHistory }: AskViewProps) {
  const [query, setQuery] = useState('');
  const [queryLoading, setQueryLoading] = useState(false);

  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new history is added
  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const handleAskSubmit = async (e: React.FormEvent | string) => {
    if (typeof e !== 'string') {
      e.preventDefault();
    }
    const submittedQuery = typeof e === 'string' ? e : query;
    if (!submittedQuery.trim()) return;

    try {
      setQueryLoading(true);
      setQuery(''); // clear input early for better UX
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const res = await fetch(`${apiUrl}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: submittedQuery })
      });

      const data = await res.json();
      if (data.success) {
        onHistoryChange([
          ...history,
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
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-divider bg-background/50 backdrop-blur-md z-10 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-spotify animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Discovery Assistant</span>
        </div>

        <button
          onClick={onClearHistory}
          disabled={history.length === 0}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all duration-200 ${history.length === 0
              ? 'border-divider bg-card/20 text-muted/30 cursor-not-allowed'
              : 'border-card-border bg-card text-muted hover:text-foreground hover:border-spotify hover:bg-sidebar'
            }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-grow overflow-y-auto px-8 pb-32 pt-6 no-scrollbar">
        {history.length === 0 ? (
          // Welcome Screen
          <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto animate-in fade-in duration-700">
            <h1 className="text-3xl md:text-4xl font-extrabold text-foreground mb-4 text-center tracking-tight">
              What are users saying<br />about music discovery?
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
                            ul: ({ node, ...props }) => <ul className="list-disc pl-5 my-3 space-y-2" {...props} />,
                            ol: ({ node, ...props }) => <ol className="list-decimal pl-5 my-3 space-y-2" {...props} />,
                            li: ({ node, ...props }) => <li className="pl-1" {...props} />,
                            p: ({ node, ...props }) => <p className="mb-4 last:mb-0" {...props} />,
                            strong: ({ node, ...props }) => <strong className="font-semibold text-foreground" {...props} />
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
                                  p: ({ node, ...props }) => <span {...props} />,
                                  strong: ({ node, ...props }) => <strong className="font-semibold text-foreground" {...props} />
                                }}
                              >
                                {pt}
                              </ReactMarkdown>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

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
            placeholder="Type your question here..."
            className="w-full bg-transparent px-5 py-4 text-sm text-foreground focus:outline-none placeholder:text-muted"
            disabled={queryLoading}
          />
          <button
            type="submit"
            disabled={queryLoading || !query.trim()}
            className={`absolute right-2 p-2.5 rounded-lg transition-colors ${!query.trim() || queryLoading
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
          AI-generated responses may contain inaccuracies.
        </div>
      </div>
    </div>
  );
}
