"use client";

import { useState, useMemo, useEffect, useRef } from "react";

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
  responseFile: File | null;
  answerKeyFile: File | null;
  label: string;
}

const cleanSubjectName = (raw: string): string => {
  let cleaned = raw.replace(/^\d+\s*[-–]\s*/, '').trim();
  cleaned = cleaned.replace(/\s*\(Domain\)\s*$/i, '').trim();
  return cleaned;
};

const parseAnswerKey = (fileContent: string): Record<string, { subject: string; correctOptionId: string }> => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(fileContent, 'text/html');
  const keyMap: Record<string, { subject: string; correctOptionId: string }> = {};

  const rows = Array.from(doc.getElementsByTagName('tr'));
  for (const row of rows) {
    const subjectSpan = row.querySelector('span[id$="lblSubject" i], span[id$="lblsubject" i]');
    const qnoSpan = row.querySelector('span[id$="lbl_QuestionNo" i], span[id$="lbl_questionno" i]');
    const ranswerSpan = row.querySelector('span[id$="lbl_RAnswer" i], span[id$="lbl_ranswer" i]');
    
    if (qnoSpan && ranswerSpan) {
      const subjectRaw = subjectSpan?.textContent?.trim() || '';
      const questionId = qnoSpan.textContent?.trim() || '';
      const correctOptionId = ranswerSpan.textContent?.trim() || '';
      const subject = cleanSubjectName(subjectRaw);
      if (subject && questionId) {
        keyMap[questionId] = { subject, correctOptionId };
      }
    }
  }

  if (Object.keys(keyMap).length === 0) {
    const spans = Array.from(doc.getElementsByTagName('span'));
    const subjectSpans = spans.filter(s => s.id && s.id.toLowerCase().endsWith('lblsubject'));
    const qnoSpans = spans.filter(s => s.id && s.id.toLowerCase().endsWith('lbl_questionno'));
    const ranswerSpans = spans.filter(s => s.id && s.id.toLowerCase().endsWith('lbl_ranswer'));

    const minLen = Math.min(subjectSpans.length, qnoSpans.length, ranswerSpans.length);
    for (let i = 0; i < minLen; i++) {
      const subjectRaw = subjectSpans[i].textContent?.trim() || '';
      const questionId = qnoSpans[i].textContent?.trim() || '';
      const correctOptionId = ranswerSpans[i].textContent?.trim() || '';
      const subject = cleanSubjectName(subjectRaw);
      if (subject && questionId) {
        keyMap[questionId] = { subject, correctOptionId };
      }
    }
  }

  if (Object.keys(keyMap).length === 0) {
    const spans = Array.from(doc.getElementsByTagName('span'));
    const texts = spans.map(s => s.textContent?.trim() || '').filter(t => t !== '');

    const qIndices: number[] = [];
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      if (t.length === 12 && /^\d+$/.test(t)) {
        qIndices.push(i);
      }
    }

    const codeToName: Record<string, string> = {};
    interface TempQuestion {
      qId: string;
      correctOptionId: string;
      subjectCode: string | null;
      fallbackSubject: string;
    }
    const tempQuestions: TempQuestion[] = [];

    for (const qIdx of qIndices) {
      const qId = texts[qIdx];
      const options: string[] = [];
      let correctOption = '';

      let idx = qIdx + 1;
      while (idx < Math.min(qIdx + 15, texts.length)) {
        const t = texts[idx];
        if (t.length === 13 && /^\d+$/.test(t)) {
          options.push(t);
        } else if (t.toLowerCase().startsWith('drop')) {
          correctOption = 'Dropped';
        }
        idx++;
      }

      if (options.length > 0) {
        correctOption = options[0];
      }

      if (!correctOption || (correctOption.length !== 13 && correctOption !== 'Dropped')) {
        continue;
      }

      const subjectParts: string[] = [];
      let prevIdx = qIdx - 1;
      while (prevIdx >= 0) {
        const t = texts[prevIdx];
        if (t.length === 13 && /^\d+$/.test(t)) {
          break;
        }
        if (/^\d+$/.test(t)) {
          const num = parseInt(t, 10);
          if (num < 100) {
            break;
          }
        }
        if (['sno', 'question no', 'correct', 'option(s)'].includes(t.toLowerCase())) {
          break;
        }
        subjectParts.unshift(t);
        prevIdx--;
      }

      const subjectRaw = subjectParts.join(' ').trim();
      const codeRegex = /\b(10[1-9]|1[1-9][0-9]|[234][0-9]{2}|501)\b/;
      const codeMatch = subjectRaw.match(codeRegex);
      const subjectCode = codeMatch ? codeMatch[1] : null;

      let nameCandidate = subjectRaw;
      if (subjectCode) {
        nameCandidate = nameCandidate.replace(new RegExp(`\\b${subjectCode}\\b`), '');
      }
      nameCandidate = nameCandidate.replace(/^\s*[-–]\s*/, '').trim();
      nameCandidate = nameCandidate.replace(/\s*[-–]\s*$/, '').trim();
      nameCandidate = nameCandidate.replace(/\(Domain\).*$/, '(Domain)').trim();

      if (subjectCode && nameCandidate) {
        const currentBest = codeToName[subjectCode] || '';
        if (nameCandidate.length > currentBest.length && !nameCandidate.toLowerCase().includes('none of these')) {
          codeToName[subjectCode] = nameCandidate;
        }
      }

      tempQuestions.push({
        qId,
        correctOptionId: correctOption,
        subjectCode,
        fallbackSubject: nameCandidate || 'Unknown'
      });
    }

    for (const q of tempQuestions) {
      const code = q.subjectCode;
      const rawSubject = (code && codeToName[code]) ? codeToName[code] : q.fallbackSubject;
      const subject = cleanSubjectName(rawSubject);
      keyMap[q.qId] = {
        subject,
        correctOptionId: q.correctOptionId
      };
    }
  }

  return keyMap;
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

const steps = [
  {
    step: "01",
    title: "Visit NTA Portal",
    description: "Visit cuet.nta.nic.in and click on \"Answer Key Challenge for CUET(UG) - 2026\".",
    badge: "Official Portal",
    image: "/step1.png"
  },
  {
    step: "02",
    title: "Authenticate",
    description: "Login with your credentials.",
    badge: "Credentials",
    illustration: "login"
  },
  {
    step: "03",
    title: "Locate Documents",
    description: "View question paper is your response sheet, you have them based on sessions you attended and View/Challenge answer key is your answer key.",
    badge: "Dashboard",
    image: "/step3.png"
  },
  {
    step: "04",
    title: "Save Response Sheets",
    description: "Let's start with the question paper: open one of them (session based) and save it with Ctrl + S as an HTML file (don't forget to rename it to remember what it was else it gets confusing). Do it for the rest of the response sheets too if you had multiple.",
    badge: "Response Sheet",
    illustration: "ctrl_s_response"
  },
  {
    step: "05",
    title: "Save Answer Keys",
    description: "Then comes the answer key, click on it as well, select your test paper, press Ctrl + S to save it, then change your test paper as per your shifts, then press Ctrl + S to save it.",
    badge: "Answer Key",
    illustration: "ctrl_s_key"
  },
  {
    step: "06",
    title: "Upload & Calculate",
    description: "Use add session to add the sessions as you had attended, carefully upload the response sheets and answer keys respectively, and click \"Generate Report\".",
    badge: "Evaluation",
    image: "/step6.png"
  }
];

export default function Home() {
  const [sessions, setSessions] = useState<SessionState[]>([
    { id: '1', responseFile: null, answerKeyFile: null, label: 'Session 1' }
  ]);
  const [results, setResults] = useState<Record<string, SubjectResult> | null>(null);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAllQuestions, setShowAllQuestions] = useState<Record<string, boolean>>({});
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const [dragOverState, setDragOverState] = useState<Record<string, { response: boolean; key: boolean }>>({});

  const fileInputRefs = useRef<Record<string, { response: HTMLInputElement | null; key: HTMLInputElement | null }>>({});

  useEffect(() => {
    if (typeof window !== "undefined") {
      const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      setTheme(isDark ? "dark" : "light");
      document.documentElement.classList.toggle("dark", isDark);
    }
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
      { id: String(nextIdx), responseFile: null, answerKeyFile: null, label: `Session ${nextIdx}` }
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

  const handleFileChange = (id: string, type: 'response' | 'key', file: File | null) => {
    setSessions(
      sessions.map(s => {
        if (s.id === id) {
          return {
            ...s,
            responseFile: type === 'response' ? file : s.responseFile,
            answerKeyFile: type === 'key' ? file : s.answerKeyFile
          };
        }
        return s;
      })
    );
  };

  const handleDragOver = (e: React.DragEvent, sessionId: string, type: 'response' | 'key') => {
    e.preventDefault();
    setDragOverState(prev => ({
      ...prev,
      [sessionId]: {
        ...prev[sessionId],
        [type]: true
      }
    }));
  };

  const handleDragLeave = (sessionId: string, type: 'response' | 'key') => {
    setDragOverState(prev => ({
      ...prev,
      [sessionId]: {
        ...prev[sessionId],
        [type]: false
      }
    }));
  };

  const handleDrop = (e: React.DragEvent, sessionId: string, type: 'response' | 'key') => {
    e.preventDefault();
    setDragOverState(prev => ({
      ...prev,
      [sessionId]: {
        ...prev[sessionId],
        [type]: false
      }
    }));
    const file = e.dataTransfer.files?.[0] || null;
    if (file && file.name.endsWith('.html')) {
      handleFileChange(sessionId, type, file);
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
      const allResults: Record<string, SubjectResult> = {};

      for (const session of sessions) {
        if (!session.responseFile || !session.answerKeyFile) {
          throw new Error(`Please upload both files for ${session.label}`);
        }

        const [responseHtml, answerKeyHtml] = await Promise.all([
          readFileText(session.responseFile),
          readFileText(session.answerKeyFile)
        ]);

        const answerKey = parseAnswerKey(answerKeyHtml);
        const responses = parseResponseSheet(responseHtml);

        const answerKeyCount = Object.keys(answerKey).length;
        const responseCount = Object.keys(responses).length;

        if (answerKeyCount === 0) {
          throw new Error(
            `Unable to parse any questions from the Answer Key file ("${session.answerKeyFile.name}"). ` +
            `Please make sure it is the correct HTML file containing the official answer key page.`
          );
        }

        if (responseCount === 0) {
          throw new Error(
            `Unable to parse any questions from the Response Sheet file ("${session.responseFile.name}"). ` +
            `Please make sure it is the correct HTML file and not a PDF, image, or raw login/error page.`
          );
        }

        let overlapCount = 0;
        for (const qId of Object.keys(answerKey)) {
          if (responses[qId]) {
            overlapCount++;
          }
        }

        if (overlapCount === 0) {
          throw new Error(
            `Found ${answerKeyCount} keys and ${responseCount} response questions, but they have 0 matching Question IDs. ` +
            `Please verify you uploaded the matching Answer Key and Response Sheet for this session.`
          );
        }

        for (const [questionId, ansData] of Object.entries(answerKey)) {
          const subject = ansData.subject;
          const correctOptionId = ansData.correctOptionId;

          if (!responses[questionId]) continue;

          const resp = responses[questionId];
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

          const isDropped = correctOptionId.toLowerCase().includes('drop') || !/^\d+$/.test(correctOptionId);

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
            } else if (chosenOptionId === correctOptionId) {
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
        
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 flex flex-col gap-12">

        {error && (
          <div className="border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 rounded-2xl flex items-start gap-3">
            <svg className="w-5 h-5 text-neutral-900 dark:text-white shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-sm font-medium text-neutral-900 dark:text-white">{error}</span>
          </div>
        )}

        {!results ? (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
            <div className="lg:col-span-2 flex flex-col gap-10">
              <div className="flex flex-col gap-4">
                <h1 className="text-4xl sm:text-5xl font-black leading-tight tracking-tight text-neutral-950 dark:text-white">
                  Calculate your CUET UG score.
                </h1>
                <p className="text-base text-neutral-500 dark:text-neutral-400 font-medium">
                  Select or drag-and-drop your HTML response sheets and answer keys below.
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="flex flex-col gap-3">
                        <span className="text-xs font-bold tracking-wider text-neutral-400 dark:text-neutral-500">
                          RESPONSE SHEET (.HTML)
                        </span>
                        <div
                          onDragOver={(e) => handleDragOver(e, session.id, 'response')}
                          onDragLeave={() => handleDragLeave(session.id, 'response')}
                          onDrop={(e) => handleDrop(e, session.id, 'response')}
                          onClick={() => fileInputRefs.current[session.id]?.response?.click()}
                          className={`border border-dashed rounded-2xl p-6 flex flex-col items-center justify-center gap-3 cursor-pointer min-h-[140px] transition-all duration-150 ${
                            dragOverState[session.id]?.response
                              ? 'border-neutral-900 bg-neutral-100 dark:border-white dark:bg-neutral-900/60 scale-[1.01]'
                              : 'border-neutral-300 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-600 bg-neutral-100/35 dark:bg-neutral-900/10 hover:bg-neutral-50/80 dark:hover:bg-neutral-900/20'
                          }`}
                        >
                          <input
                            type="file"
                            accept=".html"
                            ref={(el) => {
                              if (!fileInputRefs.current[session.id]) {
                                fileInputRefs.current[session.id] = { response: null, key: null };
                              }
                              fileInputRefs.current[session.id].response = el;
                            }}
                            className="hidden"
                            onChange={(e) => handleFileChange(session.id, 'response', e.target.files?.[0] || null)}
                          />
                          {session.responseFile ? (
                            <div className="flex flex-col items-center gap-2 text-center">
                              <svg className="w-8 h-8 text-neutral-950 dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span className="text-xs font-mono font-bold text-neutral-950 dark:text-white break-all max-w-[200px]">
                                {session.responseFile.name}
                              </span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-2 text-center text-neutral-400 dark:text-neutral-500">
                              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                              </svg>
                              <span className="text-xs font-bold tracking-tight">
                                Drag & Drop or Click to Select
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-3">
                        <span className="text-xs font-bold tracking-wider text-neutral-400 dark:text-neutral-500">
                          ANSWER KEY (.HTML)
                        </span>
                        <div
                          onDragOver={(e) => handleDragOver(e, session.id, 'key')}
                          onDragLeave={() => handleDragLeave(session.id, 'key')}
                          onDrop={(e) => handleDrop(e, session.id, 'key')}
                          onClick={() => fileInputRefs.current[session.id]?.key?.click()}
                          className={`border border-dashed rounded-2xl p-6 flex flex-col items-center justify-center gap-3 cursor-pointer min-h-[140px] transition-all duration-150 ${
                            dragOverState[session.id]?.key
                              ? 'border-neutral-900 bg-neutral-100 dark:border-white dark:bg-neutral-900/60 scale-[1.01]'
                              : 'border-neutral-300 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-600 bg-neutral-100/35 dark:bg-neutral-900/10 hover:bg-neutral-50/80 dark:hover:bg-neutral-900/20'
                          }`}
                        >
                          <input
                            type="file"
                            accept=".html"
                            ref={(el) => {
                              if (!fileInputRefs.current[session.id]) {
                                fileInputRefs.current[session.id] = { response: null, key: null };
                              }
                              fileInputRefs.current[session.id].key = el;
                            }}
                            className="hidden"
                            onChange={(e) => handleFileChange(session.id, 'key', e.target.files?.[0] || null)}
                          />
                          {session.answerKeyFile ? (
                            <div className="flex flex-col items-center gap-2 text-center">
                              <svg className="w-8 h-8 text-neutral-950 dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span className="text-xs font-mono font-bold text-neutral-950 dark:text-white break-all max-w-[200px]">
                                {session.answerKeyFile.name}
                              </span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-2 text-center text-neutral-400 dark:text-neutral-500">
                              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                              </svg>
                              <span className="text-xs font-bold tracking-tight">
                                Drag & Drop or Click to Select
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row justify-between items-center border-t border-neutral-200 dark:border-neutral-900 pt-6 gap-4">
                <button
                  type="button"
                  onClick={handleAddSession}
                  disabled={loading}
                  className="w-full sm:w-auto px-5 py-2.5 border border-neutral-250 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-900 text-neutral-950 dark:text-white text-xs font-bold tracking-tight rounded-xl transition-all cursor-pointer disabled:opacity-50"
                >
                  ADD SESSION
                </button>
                <button
                  type="button"
                  onClick={handleCalculate}
                  disabled={loading}
                  className="w-full sm:w-auto px-7 py-2.5 bg-neutral-950 dark:bg-white text-white dark:text-black hover:bg-neutral-800 dark:hover:bg-neutral-100 text-xs font-extrabold tracking-tight rounded-xl transition-all shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {loading ? "PROCESSING..." : "GENERATE REPORT"}
                </button>
              </div>

              <div className="border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/10 rounded-2xl p-5 flex items-center justify-between gap-4 mt-2">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-neutral-400 dark:bg-neutral-600 animate-pulse shrink-0"></div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                    <span className="text-xs font-mono font-bold tracking-wider text-neutral-900 dark:text-white uppercase shrink-0">
                      Instructions:
                    </span>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">
                      Scroll down to view the step-by-step guide on how to get the HTML files.
                    </span>
                  </div>
                </div>
                <svg className="w-4 h-4 text-neutral-400 dark:text-neutral-500 animate-bounce shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 13l-7 7-7-7m14-6l-7 7-7-7" />
                </svg>
              </div>
            </div>

            <div className="lg:col-span-1 flex flex-col gap-6">
              <div className="border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 rounded-3xl p-6 flex flex-col gap-4 shadow-sm shadow-black/[0.005]">
                <h3 className="text-xs font-bold tracking-wider text-neutral-400 dark:text-neutral-500 uppercase border-b border-neutral-100 dark:border-neutral-900 pb-3">
                  EVALUATION SCHEMA
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
                </div>
              </div>

              <div className="border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 rounded-3xl p-6 flex flex-col gap-5 shadow-sm shadow-black/[0.005]">
                <h3 className="text-xs font-bold tracking-wider text-neutral-400 dark:text-neutral-500 uppercase border-b border-neutral-100 dark:border-neutral-800 pb-3 font-mono">
                  DEVELOPMENT INFO
                </h3>
                <div className="flex flex-col gap-4 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-neutral-500 dark:text-neutral-400 font-medium">DEVELOPER</span>
                    <span className="font-bold text-neutral-900 dark:text-white font-mono">dotflux</span>
                  </div>
                  <div className="border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-950/20 rounded-2xl p-4 flex flex-col gap-2.5">
                    <div className="flex items-center gap-1.5 text-neutral-900 dark:text-white">
                      <svg className="w-4 h-4 shrink-0 text-neutral-900 dark:text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 .587l3.668 7.431 8.2 1.191-5.934 5.787 1.4 8.168L12 18.896l-7.334 3.857 1.4-8.168L.132 9.209l8.2-1.191L12 .587z" />
                      </svg>
                      <span className="font-bold uppercase tracking-wide text-[10px]">SUPPORT THE PROJECT</span>
                    </div>
                    <p className="text-[11px] text-neutral-600 dark:text-neutral-400 leading-relaxed font-medium">
                      If this evaluator helped you, please consider starring the repository. It keeps the project active and helps other students find it!
                    </p>
                    <a
                      href="https://github.com/dotflux/CuetScoreCalculator"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 flex items-center justify-center gap-2 w-full px-4 py-2 bg-neutral-950 dark:bg-white text-white dark:text-black hover:bg-neutral-800 dark:hover:bg-neutral-100 text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-sm cursor-pointer text-center"
                    >
                      <span>Star on GitHub</span>
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <section className="relative py-[5vh] bg-transparent transform-gpu border-t border-neutral-200 dark:border-neutral-900 mt-20">
            <div className="max-w-7xl mx-auto flex flex-col pb-[10vh] relative">
              <div className="z-0 mb-16 pt-[5vh]">
                <p className="font-mono text-xs tracking-[0.3em] font-bold uppercase text-neutral-400 dark:text-neutral-500 mb-4">Step-by-Step Guide</p>
                <h2 className="text-4xl md:text-6xl leading-[1.1] text-neutral-950 dark:text-white tracking-tight max-w-4xl font-black">
                  How to download <span className="italic font-medium text-neutral-500 dark:text-neutral-400">your documents</span>.
                </h2>
              </div>

              <div className="relative z-10 flex flex-col gap-16">
                {steps.map((step, index) => (
                  <div 
                    key={index}
                    className={`sticky w-full bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md rounded-[2.5rem] p-10 md:p-14 shadow-[0_20px_50px_rgba(0,0,0,0.02)] dark:shadow-[0_30px_60px_rgba(0,0,0,0.3)] flex flex-col md:flex-row items-center justify-between gap-12 group transition-all duration-700 ease-out origin-top border border-neutral-200 dark:border-neutral-800 ${index === 0 ? '' : 'mt-[40vh] md:mt-[50vh]'}`}
                    style={{ 
                      top: `calc(12vh + ${index * 4}vh)`, 
                      zIndex: index + 10,
                      transform: `scale(calc(1 - ${(steps.length - 1 - index) * 0.015}))`
                    }}
                  >
                    <div className="flex-1 max-w-2xl flex flex-col items-start gap-8">
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-xs tracking-[0.2em] uppercase font-bold text-neutral-500 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-800 px-4 py-2 rounded-full">
                          {step.badge}
                        </span>
                      </div>
                      
                      <div>
                        <h3 className="text-3xl md:text-4xl font-black mb-6 text-neutral-950 dark:text-white leading-tight">
                          {step.step}. {step.title}
                        </h3>
                        <p className="text-base md:text-lg text-neutral-500 dark:text-neutral-400 leading-relaxed font-medium">
                          {step.description}
                        </p>
                      </div>
                    </div>
                    
                    {step.image ? (
                      <div className="w-full md:w-[360px] lg:w-[440px] shrink-0 rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center p-2 group-hover:scale-[1.02] transition-transform duration-500">
                        <img src={step.image} alt={step.title} className="w-full h-auto object-contain rounded-xl max-h-[240px]" />
                      </div>
                    ) : (
                      <div className="w-full md:w-[360px] lg:w-[440px] shrink-0 h-[200px] md:h-[240px] rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-950/50 flex items-center justify-center relative overflow-hidden group-hover:scale-[1.02] transition-transform duration-500">
                        {step.illustration === "login" && (
                          <div className="flex flex-col gap-2 w-48 text-neutral-400 dark:text-neutral-600 font-mono text-[10px]">
                            <div className="h-6 rounded border border-neutral-200 dark:border-neutral-800 px-2 flex items-center justify-between">
                              <span>APPLICATION NO</span>
                              <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 dark:bg-neutral-600"></span>
                            </div>
                            <div className="h-6 rounded border border-neutral-200 dark:border-neutral-800 px-2 flex items-center justify-between">
                              <span>PASSWORD</span>
                              <span className="flex gap-0.5">
                                <span className="w-1 h-1 rounded-full bg-neutral-400 dark:bg-neutral-600"></span>
                                <span className="w-1 h-1 rounded-full bg-neutral-400 dark:bg-neutral-600"></span>
                                <span className="w-1 h-1 rounded-full bg-neutral-400 dark:bg-neutral-600"></span>
                              </span>
                            </div>
                            <div className="h-6 rounded bg-neutral-950 dark:bg-white text-white dark:text-black font-bold flex items-center justify-center uppercase tracking-wider text-[9px] mt-1">
                              Sign In
                            </div>
                          </div>
                        )}
                        {step.illustration?.startsWith("ctrl_s") && (
                          <div className="flex gap-3 items-center">
                            <div className="px-3.5 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-sm text-center min-w-[56px]">
                              <span className="block text-[9px] font-bold tracking-wider text-neutral-400 uppercase font-mono mb-0.5">Hold</span>
                              <span className="text-sm font-black font-mono text-neutral-900 dark:text-white">Ctrl</span>
                            </div>
                            <span className="text-lg font-bold text-neutral-300 dark:text-neutral-750 font-mono">+</span>
                            <div className="px-4 py-2.5 rounded-xl border-2 border-neutral-950 dark:border-white bg-neutral-950 dark:bg-white text-white dark:text-black shadow-sm text-center min-w-[56px] animate-pulse">
                              <span className="block text-[9px] font-bold tracking-wider opacity-60 uppercase font-mono mb-0.5">Press</span>
                              <span className="text-sm font-black font-mono">S</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start mt-6">
            <div className="lg:col-span-1 flex flex-col gap-6 lg:sticky lg:top-24">
              <div className="border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 rounded-3xl p-6 flex flex-col gap-5 shadow-sm shadow-black/[0.005]">
                <div className="flex flex-col border-b border-neutral-100 dark:border-neutral-900 pb-4">
                  <span className="text-[11px] font-bold tracking-widest text-neutral-400 dark:text-neutral-500 uppercase">
                    BEST OF 4 TOTAL
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
                    CUSTOM SELECTION TOTAL
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
                DETAILED BREAKDOWNS
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
                                  <th className="px-4 py-3">CHOSEN ID</th>
                                  <th className="px-4 py-3">CORRECT ID</th>
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
                                      <td className="px-4 py-3.5 font-mono">{q.qNumber || q.questionId}</td>
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
