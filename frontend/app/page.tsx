"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import axios from "axios";

interface QuestionResult {
  questionId: string;
  qNumber: string;
  chosenOptionId: string | null;
  chosenOptionNum: string;
  correctOptionId: string;
  result: string;
  points: number;
  status: string;
}

interface SubjectResult {
  subjectName: string;
  score: number;
  questions: QuestionResult[];
}

interface SessionState {
  id: string;
  inputType: "file" | "url";
  responseFile: File | null;
  responseUrl: string;
  label: string;
}

interface FinalKeyInfo {
  key: string;
  subjectCode: string;
  subjectName: string;
  date: string;
}

const cleanSubjectName = (raw: string): string => {
  let cleaned = raw.replace(/^\d+\s*[-–]\s*/, '').trim();
  cleaned = cleaned.replace(/\s*\(Domain\)\s*$/i, '').trim();
  return cleaned;
};

const parseResponseSheet = (fileContent: string): Record<string, any> => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(fileContent, 'text/html');
  const responses: Record<string, any> = {};

  const getValueByFlexKey = (obj: Record<string, string>, searchKey: string): string => {
    const normalizedSearch = searchKey.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [k, v] of Object.entries(obj)) {
      if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedSearch) {
        return v;
      }
    }
    return '';
  };

  const questionPanels = Array.from(doc.getElementsByClassName('question-pnl'));
  
  if (questionPanels.length > 0) {
    for (const panel of questionPanels) {
      const menuTbl = panel.querySelector('table.menu-tbl') || panel.querySelector('table');
      if (!menuTbl) continue;

      const qNumTd = panel.querySelector('td.bold[valign="top"][align="center"]') || panel.querySelector('td.bold');
      const qNumber = qNumTd ? qNumTd.textContent?.trim() || '' : '';

      const rows = Array.from(menuTbl.querySelectorAll('tr'));
      const data: Record<string, string> = {};
      for (const row of rows) {
        const tds = Array.from(row.querySelectorAll('td'));
        if (tds.length === 2) {
          const key = (tds[0].textContent || '').trim().replace(/:$/, '').trim();
          const val = (tds[1].textContent || '').trim();
          data[key] = val;
        }
      }

      const questionId = getValueByFlexKey(data, 'Question ID');
      const status = getValueByFlexKey(data, 'Status');
      const chosenOptionNum = getValueByFlexKey(data, 'Chosen Option').trim();

      const optionIds: Record<number, string> = {};
      for (let i = 1; i <= 4; i++) {
        const val = getValueByFlexKey(data, `Option ${i} ID`);
        if (val) {
          optionIds[i] = val;
        }
      }

      let chosenOptionId: string | null = null;
      if (chosenOptionNum && /^\d+$/.test(chosenOptionNum)) {
        const num = parseInt(chosenOptionNum, 10);
        chosenOptionId = optionIds[num] || null;
      }

      if (questionId) {
        responses[questionId] = {
          status,
          chosenOptionNum,
          chosenOptionId,
          optionIds,
          qNumber
        };
      }
    }
  }

  if (Object.keys(responses).length === 0) {
    const allTables = Array.from(doc.getElementsByTagName('table'));
    const candidateTables = allTables.filter(tbl => {
      const text = tbl.textContent || '';
      return text.toLowerCase().includes('question id') || text.toLowerCase().includes('questionid');
    });

    for (const table of candidateTables) {
      const rows = Array.from(table.querySelectorAll('tr'));
      const data: Record<string, string> = {};
      for (const row of rows) {
        const tds = Array.from(row.querySelectorAll('td'));
        if (tds.length === 2) {
          const key = (tds[0].textContent || '').trim().replace(/:$/, '').trim();
          const val = (tds[1].textContent || '').trim();
          data[key] = val;
        }
      }

      const questionId = getValueByFlexKey(data, 'Question ID');
      if (!questionId) continue;

      const status = getValueByFlexKey(data, 'Status');
      const chosenOptionNum = getValueByFlexKey(data, 'Chosen Option').trim();

      const optionIds: Record<number, string> = {};
      for (let i = 1; i <= 4; i++) {
        const val = getValueByFlexKey(data, `Option ${i} ID`);
        if (val) {
          optionIds[i] = val;
        }
      }

      let chosenOptionId: string | null = null;
      if (chosenOptionNum && /^\d+$/.test(chosenOptionNum)) {
        const num = parseInt(chosenOptionNum, 10);
        chosenOptionId = optionIds[num] || null;
      }

      let qNumber = '';
      let parent = table.parentElement;
      while (parent && !qNumber) {
        const qNumTd = parent.querySelector('td.bold[valign="top"][align="center"]') || parent.querySelector('td.bold');
        if (qNumTd) {
          qNumber = qNumTd.textContent?.trim() || '';
          break;
        }
        const text = parent.textContent || '';
        const match = text.match(/Q\.\s*(\d+)/i);
        if (match) {
          qNumber = 'Q.' + match[1];
          break;
        }
        parent = parent.parentElement;
      }

      responses[questionId] = {
        status,
        chosenOptionNum,
        chosenOptionId,
        optionIds,
        qNumber
      };
    }
  }

  return responses;
};

export default function Home() {
  const [sessions, setSessions] = useState<SessionState[]>([
    { id: '1', inputType: 'url', responseFile: null, responseUrl: '', label: 'Session 1' }
  ]);
  const [results, setResults] = useState<Record<string, SubjectResult> | null>(null);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAllQuestions, setShowAllQuestions] = useState<Record<string, boolean>>({});
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  
  const [finalKeys, setFinalKeys] = useState<Record<string, FinalKeyInfo> | null>(null);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [errorKeys, setErrorKeys] = useState<string | null>(null);

  const [dragOverState, setDragOverState] = useState<Record<string, boolean>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (typeof window !== "undefined") {
      const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      setTheme(isDark ? "dark" : "light");
      document.documentElement.classList.toggle("dark", isDark);
    }
    
    const fetchKeys = async () => {
      try {
        const response = await axios.get('/final_keys.json');
        setFinalKeys(response.data);
      } catch (err: any) {
        setErrorKeys('Failed to load final answer keys database.');
      } finally {
        setLoadingKeys(false);
      }
    };
    
    fetchKeys();
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
  };

  const handleAddSession = () => {
    const nextIdx = sessions.length + 1;
    setSessions([
      ...sessions,
      { id: String(nextIdx), inputType: 'url', responseFile: null, responseUrl: '', label: `Session ${nextIdx}` }
    ]);
  };

  const handleRemoveSession = (id: string) => {
    if (sessions.length === 1) return;
    const filtered = sessions.filter(s => s.id !== id);
    const updated = filtered.map((s, index) => ({
      ...s,
      label: `Session ${index + 1}`
    }));
    setSessions(updated);
  };

  const handleFileChange = (id: string, file: File | null) => {
    setSessions(
      sessions.map(s => {
        if (s.id === id) {
          return {
            ...s,
            responseFile: file
          };
        }
        return s;
      })
    );
  };

  const handleInputTypeChange = (id: string, type: 'file' | 'url') => {
    setSessions(
      sessions.map(s => {
        if (s.id === id) {
          return {
            ...s,
            inputType: type
          };
        }
        return s;
      })
    );
  };

  const handleUrlChange = (id: string, url: string) => {
    setSessions(
      sessions.map(s => {
        if (s.id === id) {
          return {
            ...s,
            responseUrl: url
          };
        }
        return s;
      })
    );
  };

  const handleDragOver = (e: React.DragEvent, sessionId: string) => {
    e.preventDefault();
    setDragOverState(prev => ({
      ...prev,
      [sessionId]: true
    }));
  };

  const handleDragLeave = (sessionId: string) => {
    setDragOverState(prev => ({
      ...prev,
      [sessionId]: false
    }));
  };

  const handleDrop = (e: React.DragEvent, sessionId: string) => {
    e.preventDefault();
    setDragOverState(prev => ({
      ...prev,
      [sessionId]: false
    }));
    const file = e.dataTransfer.files?.[0] || null;
    if (file && file.name.endsWith('.html')) {
      handleFileChange(sessionId, file);
    }
  };

  const readFileText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string || '');
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  };

  const handleCalculate = async () => {
    setError(null);
    setLoading(true);

    try {
      if (!finalKeys) {
        throw new Error('Final answer keys database is not loaded yet. Please wait a moment.');
      }

      const allResults: Record<string, SubjectResult> = {};

      for (const session of sessions) {
        let responseHtml = "";
        if (session.inputType === "url") {
          if (!session.responseUrl || !session.responseUrl.trim()) {
            throw new Error(`Please paste the response sheet URL for ${session.label}`);
          }
          const apiResponse = await axios.post('/api/fetch-response-sheet', { url: session.responseUrl.trim() });
          responseHtml = apiResponse.data;
        } else {
          if (!session.responseFile) {
            throw new Error(`Please upload the response sheet HTML file for ${session.label}`);
          }
          responseHtml = await readFileText(session.responseFile);
        }

        const responses = parseResponseSheet(responseHtml);
        const responseCount = Object.keys(responses).length;

        if (responseCount === 0) {
          const displayLabel = session.inputType === "url" ? "URL" : (session.responseFile?.name || "file");
          throw new Error(
            `Unable to parse any questions from the Response Sheet ${session.inputType === 'url' ? 'URL' : 'file'} ("${displayLabel}"). ` +
            `Please make sure it is the correct HTML URL/file containing the response panel.`
          );
        }

        for (const [questionId, resp] of Object.entries(responses)) {
          const ansData = finalKeys[questionId];
          if (!ansData) continue;

          const rawSubject = ansData.subjectName || 'Unknown';
          const subject = cleanSubjectName(rawSubject);
          const correctOptionId = ansData.key;

          const status = resp.status;
          const chosenOptionId = resp.chosenOptionId;
          const chosenOptionNum = resp.chosenOptionNum;
          const qNumber = resp.qNumber;

          const isAttempted = !(
            status === "Not Answered" ||
            status === "Not Visited" ||
            status === "" ||
            !chosenOptionNum ||
            chosenOptionNum === "--" ||
            chosenOptionId === null ||
            !/^\d+$/.test(chosenOptionNum)
          );

          const isDropped = correctOptionId.toLowerCase() === 'drop';

          let isCorrect = false;
          if (!isDropped && chosenOptionId) {
            const correctIds = correctOptionId.split(',').map(s => s.trim().replace(/,$/, ''));
            isCorrect = correctIds.includes(chosenOptionId);
          }

          let points = 0;
          let resultLabel = '';

          if (isDropped) {
            if (isAttempted) {
              points = 5;
              resultLabel = "DROPPED (ATTEMPTED) ✓";
            } else {
              points = 0;
              resultLabel = "DROPPED (UNATTEMPTED)";
            }
          } else {
            if (!isAttempted) {
              points = 0;
              resultLabel = "NOT ATTEMPTED";
            } else if (isCorrect) {
              points = 5;
              resultLabel = "CORRECT ✓";
            } else {
              points = -1;
              resultLabel = "WRONG ✗";
            }
          }

          if (!allResults[subject]) {
            allResults[subject] = {
              subjectName: subject,
              score: 0,
              questions: []
            };
          }

          allResults[subject].score += points;
          allResults[subject].questions.push({
            questionId,
            qNumber,
            chosenOptionId,
            chosenOptionNum,
            correctOptionId,
            result: resultLabel,
            points,
            status
          });
        }
      }

      if (Object.keys(allResults).length === 0) {
        throw new Error('No matched questions found between response sheet and final keys PDF database.');
      }

      setResults(allResults);
      const subjectsFound = Object.keys(allResults);
      setSelectedSubjects(subjectsFound);
    } catch (err: any) {
      setError(err.message || 'An error occurred while parsing the files.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSubjectSelection = (subj: string) => {
    if (selectedSubjects.includes(subj)) {
      setSelectedSubjects(selectedSubjects.filter(s => s !== subj));
    } else {
      setSelectedSubjects([...selectedSubjects, subj]);
    }
  };

  const handleToggleShowAll = (subj: string) => {
    setShowAllQuestions(prev => ({
      ...prev,
      [subj]: !prev[subj]
    }));
  };

  const handleReset = () => {
    setResults(null);
    setSelectedSubjects([]);
    setShowAllQuestions({});
    setError(null);
  };

  const allSubjectsTotal = useMemo(() => {
    if (!results) return 0;
    return Object.values(results).reduce((sum, s) => sum + s.score, 0);
  }, [results]);

  const customCombinationTotal = useMemo(() => {
    if (!results) return 0;
    return selectedSubjects.reduce((sum, name) => {
      const s = results[name];
      return sum + (s ? s.score : 0);
    }, 0);
  }, [results, selectedSubjects]);

  const parsedSubjects = useMemo(() => {
    if (!results) return [];
    return Object.values(results);
  }, [results]);

  const bestOf4Total = useMemo(() => {
    if (!results) return 0;
    const sortedScores = Object.values(results)
      .map(s => s.score)
      .sort((a, b) => b - a);
    return sortedScores.slice(0, 4).reduce((sum, score) => sum + score, 0);
  }, [results]);

  return (
    <div className="min-h-screen relative bg-neutral-50 dark:bg-black text-neutral-900 dark:text-neutral-50 transition-colors duration-200">
      <div className="absolute top-6 right-6 z-50 flex items-center gap-3">
        {results && (
          <button
            type="button"
            onClick={handleReset}
            className="text-xs font-bold tracking-tight text-neutral-950 dark:text-white bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-900 dark:hover:bg-neutral-850 border border-neutral-200 dark:border-neutral-800 px-4 py-1.5 rounded-xl transition-all cursor-pointer"
          >
            RESET
          </button>
        )}
        <button
          type="button"
          onClick={toggleTheme}
          className="p-2 flex items-center justify-center bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-900 dark:hover:bg-neutral-850 border border-neutral-200 dark:border-neutral-800 rounded-xl transition-all cursor-pointer"
        >
          {theme === "light" ? (
            <svg className="w-4 h-4 text-neutral-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
          )}
        </button>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 flex flex-col gap-12">
        {errorKeys && (
          <div className="border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/10 p-5 rounded-2xl flex items-start gap-3">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-sm font-medium text-red-800 dark:text-red-300">{errorKeys}</span>
          </div>
        )}

        {error && (
          <div className="border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 rounded-2xl flex items-start gap-3">
            <svg className="w-5 h-5 text-neutral-900 dark:text-white shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-sm font-medium text-neutral-900 dark:text-white">{error}</span>
          </div>
        )}

        {!results ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
            <div className="lg:col-span-2 flex flex-col gap-10">
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-450 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider">
                    OFFICIAL FINAL ANSWER KEY PDF DATABASE LOADED
                  </span>
                </div>
                <h1 className="text-4xl sm:text-5xl font-black leading-tight tracking-tight text-neutral-950 dark:text-white">
                  CUET UG 2026 Score Calculator.
                </h1>
                <p className="text-base text-neutral-500 dark:text-neutral-400 font-medium">
                  Upload your session HTML response sheets or paste the Digialm URLs to evaluate your scores against the final key database.
                </p>
              </div>

              <div className="flex flex-col gap-6">
                {sessions.map((session) => (
                  <div key={session.id} className="border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 rounded-3xl p-6 sm:p-8 flex flex-col gap-6 shadow-sm shadow-black/[0.005]">
                    <div className="flex justify-between items-center">
                      <h2 className="text-sm font-bold tracking-tight text-neutral-900 dark:text-white uppercase">
                        {session.label}
                      </h2>
                      {sessions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveSession(session.id)}
                          className="text-xs font-bold text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer"
                        >
                          REMOVE SESSION
                        </button>
                      )}
                    </div>

                    <div className="flex gap-2 border-b border-neutral-100 dark:border-neutral-850 pb-3">
                      <button
                        type="button"
                        onClick={() => handleInputTypeChange(session.id, 'url')}
                        className={`px-4 py-1.5 rounded-xl text-xs font-bold tracking-tight transition-all border cursor-pointer ${
                          session.inputType === 'url'
                            ? 'bg-neutral-950 text-white border-neutral-950 dark:bg-white dark:text-black dark:border-white'
                            : 'bg-transparent text-neutral-400 border-transparent hover:text-neutral-900 dark:hover:text-white'
                        }`}
                      >
                        PASTE URL
                      </button>
                      <button
                        type="button"
                        onClick={() => handleInputTypeChange(session.id, 'file')}
                        className={`px-4 py-1.5 rounded-xl text-xs font-bold tracking-tight transition-all border cursor-pointer ${
                          session.inputType === 'file'
                            ? 'bg-neutral-950 text-white border-neutral-950 dark:bg-white dark:text-black dark:border-white'
                            : 'bg-transparent text-neutral-400 border-transparent hover:text-neutral-900 dark:hover:text-white'
                        }`}
                      >
                        UPLOAD FILE
                      </button>
                      
                    </div>

                    {session.inputType === 'file' ? (
                      <div className="flex flex-col gap-3">
                        <span className="text-xs font-bold tracking-wider text-neutral-400 dark:text-neutral-500">
                          RESPONSE SHEET (.HTML)
                        </span>
                        <div
                          onDragOver={(e) => handleDragOver(e, session.id)}
                          onDragLeave={() => handleDragLeave(session.id)}
                          onDrop={(e) => handleDrop(e, session.id)}
                          onClick={() => fileInputRefs.current[session.id]?.click()}
                          className={`border border-dashed rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer min-h-[140px] transition-all duration-150 ${
                            dragOverState[session.id]
                              ? 'border-neutral-900 bg-neutral-100 dark:border-white dark:bg-neutral-900/60 scale-[1.01]'
                              : 'border-neutral-300 dark:border-neutral-800 hover:border-neutral-450 dark:hover:border-neutral-600 bg-neutral-100/35 dark:bg-neutral-900/10 hover:bg-neutral-50/80 dark:hover:bg-neutral-900/20'
                          }`}
                        >
                          <input
                            type="file"
                            accept=".html"
                            ref={(el) => {
                              fileInputRefs.current[session.id] = el;
                            }}
                            className="hidden"
                            onChange={(e) => handleFileChange(session.id, e.target.files?.[0] || null)}
                          />
                          {session.responseFile ? (
                            <div className="flex flex-col items-center gap-2 text-center">
                              <svg className="w-8 h-8 text-neutral-950 dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span className="text-xs font-mono font-bold text-neutral-950 dark:text-white break-all max-w-[300px]">
                                {session.responseFile.name}
                              </span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-2 text-center text-neutral-400 dark:text-neutral-500">
                              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                              </svg>
                              <span className="text-xs font-bold tracking-tight">
                                Drag & Drop or Click to Select Response Sheet HTML
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        <span className="text-xs font-bold tracking-wider text-neutral-400 dark:text-neutral-500">
                          RESPONSE SHEET URL
                        </span>
                        <input
                          type="text"
                          value={session.responseUrl}
                          onChange={(e) => handleUrlChange(session.id, e.target.value)}
                          placeholder="Paste response sheet URL here..."
                          className="w-full px-4 py-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/10 text-sm font-medium focus:outline-none focus:border-neutral-500 transition-all font-mono"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row justify-between items-center border-t border-neutral-200 dark:border-neutral-900 pt-6 gap-4">
                <button
                  type="button"
                  onClick={handleAddSession}
                  disabled={loading || loadingKeys}
                  className="w-full sm:w-auto px-5 py-2.5 border border-neutral-250 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-900 text-neutral-950 dark:text-white text-xs font-bold tracking-tight rounded-xl transition-all cursor-pointer disabled:opacity-50"
                >
                  ADD SESSION
                </button>
                <button
                  type="button"
                  onClick={handleCalculate}
                  disabled={loading || loadingKeys}
                  className="w-full sm:w-auto px-7 py-2.5 bg-neutral-950 dark:bg-white text-white dark:text-black hover:bg-neutral-800 dark:hover:bg-neutral-100 text-xs font-extrabold tracking-tight rounded-xl transition-all shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {loading ? "PROCESSING..." : loadingKeys ? "LOADING DATABASE..." : "EVALUATE SCORING"}
                </button>
              </div>
            </div>

            <div className="lg:col-span-1 flex flex-col gap-6">
              <div className="border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 rounded-3xl p-6 flex flex-col gap-4 shadow-sm shadow-black/[0.005]">
                <h3 className="text-xs font-bold tracking-wider text-neutral-400 dark:text-neutral-500 uppercase border-b border-neutral-100 dark:border-neutral-900 pb-3">
                  FINAL EVALUATION SCHEMA
                </h3>
                <div className="flex flex-col gap-3.5 text-xs font-mono">
                  <div className="flex justify-between items-center">
                    <span className="text-neutral-500 dark:text-neutral-400">CORRECT RESPONSE</span>
                    <span className="font-bold text-neutral-950 dark:text-white">+5 PTS</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-neutral-500 dark:text-neutral-400">INCORRECT RESPONSE</span>
                    <span className="font-bold text-neutral-950 dark:text-white">-1 PTS</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-neutral-500 dark:text-neutral-400">UNATTEMPTED</span>
                    <span className="font-bold text-neutral-950 dark:text-white">0 PTS</span>
                  </div>
                  <div className="border-t border-neutral-100 dark:border-neutral-900 pt-3 flex flex-col gap-2">
                    <span className="text-[10px] font-bold tracking-tight text-neutral-400 uppercase">DROPPED QUESTIONS</span>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-neutral-500 dark:text-neutral-400">ATTEMPTED</span>
                      <span className="font-bold text-neutral-950 dark:text-white">+5 PTS</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-neutral-500 dark:text-neutral-400">UNATTEMPTED</span>
                      <span className="font-bold text-neutral-950 dark:text-white">0 PTS</span>
                    </div>
                  </div>
                  <div className="border-t border-neutral-100 dark:border-neutral-900 pt-3 flex flex-col gap-2">
                    <span className="text-[10px] font-bold tracking-tight text-neutral-400 uppercase">MULTIPLE CORRECT KEYS</span>
                    <p className="text-[10px] text-neutral-500 leading-normal font-sans">
                      If NTA final key contains multiple comma-separated keys, matching any correct key yields +5 PTS.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start mt-6">
            <div className="lg:col-span-1 flex flex-col gap-6 lg:sticky lg:top-24">
              <div className="border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 rounded-3xl p-6 flex flex-col gap-5 shadow-sm shadow-black/[0.005]">
                <div className="flex flex-col border-b border-neutral-100 dark:border-neutral-900 pb-4">
                  <span className="text-[11px] font-bold tracking-widest text-neutral-400 dark:text-neutral-500 uppercase">
                    BEST OF 4 SCORE
                  </span>
                  <span className="text-4xl font-black tracking-tight text-neutral-950 dark:text-white mt-1">
                    {bestOf4Total}
                  </span>
                  <span className="text-xs font-semibold text-neutral-400 mt-1">
                    Out of {Math.min(parsedSubjects.length, 4) * 250}
                  </span>
                </div>

                <div className="flex flex-col border-b border-neutral-100 dark:border-neutral-900 py-4">
                  <span className="text-[11px] font-bold tracking-widest text-neutral-400 dark:text-neutral-500 uppercase">
                    CUSTOM SELECTION SCORE
                  </span>
                  <span className="text-4xl font-black tracking-tight text-neutral-950 dark:text-white mt-1">
                    {customCombinationTotal}
                  </span>
                  <span className="text-xs font-semibold text-neutral-400 mt-1">
                    Out of {selectedSubjects.length * 250}
                  </span>
                </div>

                <div className="flex flex-col pt-4">
                  <span className="text-[11px] font-bold tracking-widest text-neutral-400 dark:text-neutral-500 uppercase">
                    ALL SUBJECTS TOTAL
                  </span>
                  <span className="text-2xl font-bold tracking-tight text-neutral-950 dark:text-white mt-1">
                    {allSubjectsTotal}
                  </span>
                  <span className="text-xs font-semibold text-neutral-400 mt-1">
                    Out of {parsedSubjects.length * 250}
                  </span>
                </div>
              </div>

              <div className="border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 rounded-3xl p-6 flex flex-col gap-4 shadow-sm shadow-black/[0.005]">
                <h3 className="text-xs font-bold tracking-tight text-neutral-900 dark:text-white">
                  SUBJECTS SELECTOR
                </h3>
                <div className="flex flex-wrap gap-2">
                  {parsedSubjects.map((s) => {
                    const isChecked = selectedSubjects.includes(s.subjectName);
                    return (
                      <button
                        key={s.subjectName}
                        type="button"
                        onClick={() => handleToggleSubjectSelection(s.subjectName)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border cursor-pointer ${
                          isChecked
                            ? "bg-neutral-950 text-white border-neutral-950 dark:bg-white dark:text-black dark:border-white"
                            : "bg-transparent text-neutral-500 border-neutral-200 dark:border-neutral-800 hover:border-neutral-450 dark:hover:border-neutral-600"
                        }`}
                      >
                        {s.subjectName} ({s.score})
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="lg:col-span-2 flex flex-col gap-8">
              <h2 className="text-xl font-extrabold tracking-tight text-neutral-950 dark:text-white">
                DETAILED BREAKDOWNS (FINAL EVALUATION)
              </h2>

              <div className="flex flex-col gap-6">
                {parsedSubjects.map((s) => {
                  const wrongQuestions = s.questions.filter((q) => q.result.startsWith("WRONG"));
                  const correctCount = s.questions.filter((q) => q.result.startsWith("CORRECT")).length;
                  const wrongCount = wrongQuestions.length;
                  const unattemptedCount = s.questions.filter((q) => q.result === "NOT ATTEMPTED").length;
                  const droppedCount = s.questions.filter((q) => q.result.startsWith("DROPPED")).length;

                  const sortedQuestions = [...s.questions].sort((a, b) => {
                    const aNum = parseInt(a.qNumber.replace("Q.", ""), 10);
                    const bNum = parseInt(b.qNumber.replace("Q.", ""), 10);
                    if (isNaN(aNum) && isNaN(bNum)) return 0;
                    if (isNaN(aNum)) return 1;
                    if (isNaN(bNum)) return -1;
                    return aNum - bNum;
                  });

                  const isShowingAll = showAllQuestions[s.subjectName] || false;
                  const displayedQuestions = isShowingAll ? sortedQuestions : wrongQuestions;

                  return (
                    <div key={s.subjectName} className="border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 rounded-3xl overflow-hidden shadow-sm shadow-black/[0.005]">
                      <div className="p-6 bg-neutral-50/50 dark:bg-neutral-900/10 border-b border-neutral-100 dark:border-neutral-900 flex flex-col gap-4">
                        <div className="flex justify-between items-baseline gap-4">
                          <h3 className="text-lg font-bold tracking-tight text-neutral-950 dark:text-white">
                            {s.subjectName}
                          </h3>
                          <span className="text-xl font-black tracking-tight text-neutral-950 dark:text-white shrink-0">
                            {s.score} pts
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-4 text-xs font-mono font-medium text-neutral-500 dark:text-neutral-400">
                          <span>CORRECT: <strong className="text-neutral-950 dark:text-white">{correctCount}</strong></span>
                          <span>WRONG: <strong className="text-neutral-950 dark:text-white">{wrongCount}</strong></span>
                          <span>UNATTEMPTED: <strong className="text-neutral-950 dark:text-white">{unattemptedCount}</strong></span>
                          {droppedCount > 0 && (
                            <span>DROPPED: <strong className="text-neutral-950 dark:text-white">{droppedCount}</strong></span>
                          )}
                        </div>
                      </div>

                      <div className="p-6">
                        <div className="flex justify-between items-center mb-4">
                          <h4 className="text-xs font-bold tracking-wider text-neutral-400 dark:text-neutral-500 uppercase font-mono">
                            {isShowingAll ? "ALL QUESTIONS" : "INCORRECT RESPONSES"}
                          </h4>
                          <button
                            type="button"
                            onClick={() => handleToggleShowAll(s.subjectName)}
                            className="text-xs font-bold text-neutral-600 dark:text-neutral-400 hover:text-neutral-950 dark:hover:text-white underline cursor-pointer"
                          >
                            {isShowingAll ? "SHOW WRONG ONLY" : "SHOW ALL STATS"}
                          </button>
                        </div>

                        {displayedQuestions.length === 0 ? (
                          <div className="border border-dashed border-neutral-200 dark:border-neutral-800 rounded-2xl py-12 text-center text-sm font-mono text-neutral-400">
                            {isShowingAll ? "NO STATS AVAILABLE" : "NO WRONG ANSWERS"}
                          </div>
                        ) : (
                          <div className="overflow-x-auto border border-neutral-200 dark:border-neutral-800 rounded-2xl custom-scrollbar">
                            <table className="w-full border-collapse text-left text-xs">
                              <thead>
                                <tr className="bg-neutral-50 dark:bg-neutral-900/20 border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 font-mono font-bold">
                                  <th className="px-4 py-3">Q.NO</th>
                                  <th className="px-4 py-3">QUESTION ID</th>
                                  <th className="px-4 py-3">CHOSEN ID</th>
                                  <th className="px-4 py-3">FINAL KEY</th>
                                  <th className="px-4 py-3 text-right">STATUS</th>
                                  <th className="px-4 py-3 text-right">PTS</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-900 font-medium">
                                {displayedQuestions.map((q) => {
                                  let labelClass = "text-neutral-400 dark:text-neutral-600";
                                  if (q.result.startsWith("CORRECT")) {
                                    labelClass = "text-neutral-950 dark:text-white";
                                  } else if (q.result.startsWith("WRONG")) {
                                    labelClass = "text-neutral-500 dark:text-neutral-400";
                                  } else if (q.result.startsWith("DROPPED")) {
                                    labelClass = "text-neutral-800 dark:text-neutral-350";
                                  }

                                  return (
                                    <tr key={q.questionId} className={`hover:bg-neutral-50/50 dark:hover:bg-neutral-900/10 transition-colors ${labelClass}`}>
                                      <td className="px-4 py-3.5 font-mono">{q.qNumber || "—"}</td>
                                      <td className="px-4 py-3.5 font-mono">{q.questionId}</td>
                                      <td className="px-4 py-3.5 font-mono">{q.chosenOptionId || "—"}</td>
                                      <td className="px-4 py-3.5 font-mono">{q.correctOptionId}</td>
                                      <td className="px-4 py-3.5 text-right font-bold tracking-tight">{q.result}</td>
                                      <td className="px-4 py-3.5 text-right font-mono font-bold">{q.points > 0 ? `+${q.points}` : q.points}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
