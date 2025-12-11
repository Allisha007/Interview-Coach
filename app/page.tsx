"use client";

import { useState, useRef, useEffect } from "react";

const API_BASE_URL = "http://localhost:8000";

type QuestionType = "硬技能" | "软技能" | "行业洞察" | "通用" | "自定义";

interface Question {
  id: string;
  text: string;
  type: QuestionType;
}

interface AnalysisResult {
  score: number;
  feedback: string;
  pros: string[];
  cons: string[];
  betterAnswer: string;
}

interface AudioTake {
  id: string;
  url: string;           
  timestamp: number;     
  durationString: string;
  questionText?: string; 
  analysis?: AnalysisResult; 
  transcription?: string; 
}

interface JobSession {
  id: string;
  title: string;
  questions: Question[];
  resumeText?: string;     
  resumeFileName?: string; 
  resumeFileUrl?: string; 
  createdAt: number;
}

export default function InterviewApp() {
  const [sessions, setSessions] = useState<JobSession[]>([]); // 初始为空，等待加载
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [showCreateSessionModal, setShowCreateSessionModal] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState("");

  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [showAddQuestionModal, setShowAddQuestionModal] = useState(false);
  const [manualQuestionInput, setManualQuestionInput] = useState("");
  const [manualQuestionType, setManualQuestionType] = useState<QuestionType>("自定义");
  const [generateCount, setGenerateCount] = useState(3); 

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editSessionTitle, setEditSessionTitle] = useState("");
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editQuestionText, setEditQuestionText] = useState("");

  const [activeQuestion, setActiveQuestion] = useState<Question | null>(null);
  const [practiceStatus, setPracticeStatus] = useState<"idle" | "recording" | "review" | "analyzing" | "result">("idle");
  const [audioTakes, setAudioTakes] = useState<AudioTake[]>([]);
  const [currentTakeId, setCurrentTakeId] = useState<string | null>(null);

  const [timer, setTimer] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeSession = sessions.find(s => s.id === activeSessionId);

  // --- 1. 页面加载：获取所有历史 Session ---
  useEffect(() => {
    const loadSessions = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/sessions`);
        const data = await res.json();
        if (data.sessions && data.sessions.length > 0) {
          const loadedSessions = data.sessions.map((s: any) => ({
            id: s.id,
            title: s.title,
            questions: [], // 题目稍后加载
            resumeText: s.resumeText,
            resumeFileName: s.resumeText ? "已关联简历 (历史记录)" : undefined, // 兼容显示
            createdAt: s.createdAt
          }));
          setSessions(loadedSessions);
          setActiveSessionId(loadedSessions[0].id);
        } else {
          // 如果没有历史记录，创建一个默认的
          const defaultSession = { id: "demo-1", title: "示例：产品经理", createdAt: Date.now(), questions: [] };
          setSessions([defaultSession]);
          setActiveSessionId("demo-1");
          // 也可以选择这里静默同步一下默认 Session
        }
      } catch (e) {
        console.error("加载历史失败:", e);
      }
    };
    loadSessions();
  }, []);

  // --- 2. 切换 Session 时：加载该 Session 的题目 ---
  useEffect(() => {
    if (!activeSessionId) return;
    // 如果是 demo session 且没存库，可能加载不到，这里简单处理
    if (activeSessionId.startsWith('demo')) return;

    const loadQuestions = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/questions?session_id=${activeSessionId}`);
        const data = await res.json();
        // 更新当前 session 的题目列表
        setSessions(prev => prev.map(s => 
          s.id === activeSessionId ? { ...s, questions: data.questions } : s
        ));
      } catch (e) {
        console.error("加载题目失败:", e);
      }
    };
    
    // 只有当题目为空时才加载（或者你可以选择每次都加载以保持同步）
    const current = sessions.find(s => s.id === activeSessionId);
    if (current && current.questions.length === 0) {
      loadQuestions();
    }
  }, [activeSessionId, sessions.length]); // 依赖 sessions.length 确保 sessions 初始化后再执行

  // --- 逻辑处理 ---

  const syncSessionToDb = async (session: JobSession) => {
    try {
      const formData = new FormData();
      formData.append("id", session.id); formData.append("title", session.title); formData.append("resume_text", session.resumeText || "");
      await fetch(`${API_BASE_URL}/api/session/create`, { method: "POST", body: formData });
    } catch (e) { console.error("Sync failed", e); }
  };

  const handleCreateSession = () => {
    if (!newSessionTitle.trim()) return;
    const newId = Date.now().toString();
    const newSession: JobSession = { id: newId, title: newSessionTitle, questions: [], createdAt: Date.now() };
    setSessions([newSession, ...sessions]); setActiveSessionId(newId); setNewSessionTitle(""); setShowCreateSessionModal(false);
    syncSessionToDb(newSession);
  };

  const handleDeleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("确定要删除这个岗位面试吗？")) return;
    // 这里没有写删除 API，实际项目应该调后端删除接口
    const newSessions = sessions.filter(s => s.id !== id);
    setSessions(newSessions);
    if (activeSessionId === id && newSessions.length > 0) setActiveSessionId(newSessions[0].id); else if (newSessions.length === 0) setActiveSessionId("");
  };

  const startEditSession = (e: React.MouseEvent, session: JobSession) => { e.stopPropagation(); setEditingSessionId(session.id); setEditSessionTitle(session.title); };
  const saveSessionTitle = () => { if (editingSessionId && editSessionTitle.trim()) { const updatedSessions = sessions.map(s => { if (s.id === editingSessionId) { const updated = { ...s, title: editSessionTitle }; syncSessionToDb(updated); return updated; } return s; }); setSessions(updatedSessions); } setEditingSessionId(null); };

  const handleResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !activeSession) return;
    const file = e.target.files[0];
    setIsUploadingResume(true);
    const formData = new FormData(); formData.append("file", file);
    try {
      const response = await fetch(`${API_BASE_URL}/api/parse_resume`, { method: "POST", body: formData });
      if (!response.ok) throw new Error("解析失败");
      const data = await response.json();
      const fileUrl = URL.createObjectURL(file);
      const updatedSession = { ...activeSession, resumeText: data.text, resumeFileName: file.name, resumeFileUrl: fileUrl };
      setSessions(prev => prev.map(s => s.id === activeSession.id ? updatedSession : s));
      await syncSessionToDb(updatedSession);
      alert(`✅ 简历 "${file.name}" 解析成功！`);
    } catch (err) { console.error(err); alert("❌ 简历解析失败"); } finally { setIsUploadingResume(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const handleDeleteResume = (e: React.MouseEvent) => { e.stopPropagation(); if (!activeSession) return; if (!confirm("确定要移除当前简历吗？")) return; const updatedSession = { ...activeSession, resumeText: "", resumeFileName: undefined, resumeFileUrl: undefined }; setSessions(prev => prev.map(s => s.id === activeSession.id ? updatedSession : s)); syncSessionToDb(updatedSession); };
  const handlePreviewResume = () => { if (activeSession?.resumeFileUrl) window.open(activeSession.resumeFileUrl, '_blank'); };

  const handleAiGenerate = async () => {
    if (!activeSession) return;
    setIsGenerating(true);
    const existingTexts = activeSession.questions.map(q => q.text);
    try {
      const response = await fetch(`${API_BASE_URL}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: activeSession.id, job_title: activeSession.title, count: generateCount, existing_questions: existingTexts, resume_text: activeSession.resumeText || "" }), });
      if (!response.ok) throw new Error("生成失败");
      const data = await response.json();
      updateSessionQuestions(activeSession.id, [...activeSession.questions, ...data.questions]);
    } catch (error) { console.error(error); alert("AI 生成失败，请检查后端"); } finally { setIsGenerating(false); }
  };

  // [Fix] 手动添加题目现在会保存到数据库
  const handleManualAddQuestion = async () => {
    if (!manualQuestionInput.trim() || !activeSession) return;
    
    // 乐观更新 UI
    const tempId = Date.now().toString(); 
    const newQ: Question = { id: tempId, type: manualQuestionType, text: manualQuestionInput };
    
    // 存库
    try {
      const formData = new FormData();
      formData.append("session_id", activeSession.id);
      formData.append("text", manualQuestionInput);
      formData.append("type", manualQuestionType);
      
      const res = await fetch(`${API_BASE_URL}/api/question/create`, { method: "POST", body: formData });
      const data = await res.json();
      
      if (data.status === 'success') {
        newQ.id = data.id; // 更新为真实的 UUID
        updateSessionQuestions(activeSession.id, [newQ, ...activeSession.questions]);
      } else {
        alert("保存失败");
      }
    } catch (e) {
      console.error(e);
      alert("网络错误，题目未保存");
    }
    
    setManualQuestionInput(""); setManualQuestionType("自定义"); setShowAddQuestionModal(false);
  };

  const startEditQuestion = (q: Question) => { setEditingQuestionId(q.id); setEditQuestionText(q.text); };
  const saveQuestionText = () => { if (editingQuestionId && editQuestionText.trim() && activeSession) { const updatedQuestions = activeSession.questions.map(q => q.id === editingQuestionId ? { ...q, text: editQuestionText } : q); updateSessionQuestions(activeSession.id, updatedQuestions); } setEditingQuestionId(null); };
  const updateSessionQuestions = (sessionId: string, newQuestions: Question[]) => { setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, questions: newQuestions } : s)); };
  
  const handleDeleteQuestion = async (qId: string) => {
    if (!confirm("确定要删除这道题吗？")) return;
    try {
      await fetch(`${API_BASE_URL}/api/question/delete?question_id=${qId}`, { method: "DELETE" });
      updateSessionQuestions(activeSession!.id, activeSession!.questions.filter(q => q.id !== qId));
    } catch (e) { alert("删除失败"); }
  };

  const enterPracticeMode = async (q: Question) => {
    setActiveQuestion(q);
    setPracticeStatus("idle");
    setAudioTakes([]); 
    setCurrentTakeId(null);
    try {
      // 获取历史记录
      const res = await fetch(`${API_BASE_URL}/api/attempts?question_id=${q.id}`);
      const data = await res.json();
      if (data.attempts) setAudioTakes(data.attempts);
    } catch (e) { console.error(e); }
  };

  const exitPracticeMode = () => { if (practiceStatus === 'recording') stopRecording(); setActiveQuestion(null); };
  
  const startRecording = async () => { try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const mediaRecorder = new MediaRecorder(stream); mediaRecorderRef.current = mediaRecorder; audioChunksRef.current = []; mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); }; mediaRecorder.onstop = () => { const url = URL.createObjectURL(new Blob(audioChunksRef.current, { type: "audio/wav" })); const newTake: AudioTake = { id: Date.now().toString(), url, timestamp: Date.now(), durationString: formatTime(timer) }; setAudioTakes(prev => [...prev, newTake]); setCurrentTakeId(newTake.id); }; mediaRecorder.start(); setPracticeStatus("recording"); setTimer(0); timerIntervalRef.current = setInterval(() => setTimer(t => t + 1), 1000); } catch (err) { alert("请允许麦克风权限"); } };
  
  const stopRecording = () => { if (mediaRecorderRef.current && practiceStatus === "recording") { mediaRecorderRef.current.stop(); mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop()); if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); setPracticeStatus("review"); } };
  
  const submitForAnalysis = async () => {
    if (!currentTakeId || !activeQuestion || !activeSession) return;
    setPracticeStatus("analyzing");
    const currentTake = audioTakes.find(t => t.id === currentTakeId);
    if (!currentTake) return;
    try {
      const audioBlob = await fetch(currentTake.url).then(r => r.blob());
      const audioFile = new File([audioBlob], "recording.wav", { type: "audio/wav" });
      const formData = new FormData();
      formData.append("file", audioFile); formData.append("question_text", activeQuestion.text); formData.append("job_title", activeSession.title); formData.append("resume_text", activeSession.resumeText || ""); formData.append("question_id", activeQuestion.id); formData.append("attempt_id", currentTakeId);
      const response = await fetch(`${API_BASE_URL}/api/analyze`, { method: "POST", body: formData });
      if (!response.ok) throw new Error("分析失败");
      const data = await response.json();
      setAudioTakes(prev => prev.map(t => t.id === currentTakeId ? { ...t, url: data.audio_url || t.url, analysis: data.analysis, transcription: data.transcription } : t));
      setPracticeStatus("result");
    } catch (error) { console.error(error); alert("分析失败"); setPracticeStatus("review"); }
  };

  const handleBackToIdle = () => { setPracticeStatus("idle"); setCurrentTakeId(null); };
  const handleHistoryClick = (take: AudioTake) => { setCurrentTakeId(take.id); if (take.analysis) setPracticeStatus("result"); else setPracticeStatus("review"); };
  const handleDeleteTake = (e: React.MouseEvent, takeId: string) => { e.stopPropagation(); const newTakes = audioTakes.filter(t => t.id !== takeId); setAudioTakes(newTakes); if (currentTakeId === takeId) handleBackToIdle(); };
  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2,'0')}:${(s % 60).toString().padStart(2,'0')}`;
  const currentTake = audioTakes.find(t => t.id === currentTakeId);
  const getTagColor = (type: QuestionType) => { switch (type) { case '硬技能': return 'bg-blue-50 text-blue-600 border-blue-100'; case '软技能': return 'bg-orange-50 text-orange-600 border-orange-100'; case '行业洞察': return 'bg-purple-50 text-purple-600 border-purple-100'; case '通用': return 'bg-gray-100 text-gray-600 border-gray-200'; default: return 'bg-indigo-50 text-indigo-600 border-indigo-100'; } };

  return (
    <div className="flex h-screen bg-gray-50 font-sans text-slate-800 overflow-hidden">
      {/* ... (UI 代码与之前一致，直接复用上一个回复的 UI 部分即可) ... */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col shrink-0 z-20">
        <div className="h-16 flex items-center px-6 border-b border-gray-100"><div className="flex items-center gap-2 font-bold text-lg text-indigo-600"><div className="w-6 h-6 bg-indigo-600 rounded-md flex items-center justify-center text-white text-xs">AI</div>Interview Coach</div></div>
        <div className="p-4"><button onClick={() => setShowCreateSessionModal(true)} className="w-full py-3 bg-slate-900 text-white rounded-xl shadow-lg hover:bg-slate-800 transition-all flex items-center justify-center gap-2 font-medium text-sm"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>新建岗位面试</button></div>
        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1">
          <div className="px-3 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider">我的岗位</div>
          {sessions.map(session => (
            <div key={session.id} onClick={() => setActiveSessionId(session.id)} className={`group flex items-center justify-between px-3 py-3 rounded-lg cursor-pointer transition-colors text-sm font-medium ${activeSessionId === session.id ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'}`}>
              <div className="flex items-center gap-3 overflow-hidden flex-1"><svg className={`w-5 h-5 shrink-0 ${activeSessionId === session.id ? 'text-indigo-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>{editingSessionId === session.id ? (<input autoFocus value={editSessionTitle} onChange={(e) => setEditSessionTitle(e.target.value)} onBlur={saveSessionTitle} onKeyDown={(e) => e.key === 'Enter' && saveSessionTitle()} onClick={(e) => e.stopPropagation()} className="w-full bg-white border border-indigo-300 rounded px-1 text-sm outline-none"/>) : (<span className="truncate" title={session.title}>{session.title}</span>)}</div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={(e) => startEditSession(e, session)} className="p-1 hover:bg-indigo-100 hover:text-indigo-600 rounded"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg></button><button onClick={(e) => handleDeleteSession(e, session.id)} className="p-1 hover:bg-red-100 hover:text-red-600 rounded"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button></div>
            </div>
          ))}
        </div>
        {activeSession && (
          <div className="p-4 border-t border-gray-100 bg-gray-50/50">
            <input type="file" accept=".pdf,.docx" onChange={handleResumeUpload} ref={fileInputRef} className="hidden" />
            {activeSession.resumeFileName ? (
              <div className="flex items-center justify-between bg-white border border-indigo-100 rounded-lg p-2 shadow-sm group">
                <div className="flex items-center gap-2 overflow-hidden cursor-pointer" onClick={handlePreviewResume} title="点击预览"><div className="w-8 h-8 bg-red-50 text-red-500 rounded flex items-center justify-center shrink-0"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg></div><div className="flex flex-col min-w-0"><span className="text-xs font-medium text-gray-700 truncate">{activeSession.resumeFileName}</span><span className="text-[10px] text-green-600 flex items-center gap-0.5"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>已解析</span></div></div>
                <div className="flex gap-1 shrink-0"><button onClick={() => fileInputRef.current?.click()} className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors" title="替换简历"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg></button><button onClick={handleDeleteResume} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="移除简历"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button></div>
              </div>
            ) : (
              <button onClick={() => fileInputRef.current?.click()} disabled={isUploadingResume} className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/50 transition-all">{isUploadingResume ? (<><div className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div> 正在解析...</>) : (<><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg> 上传简历 (PDF/Word)</>)}</button>
            )}
          </div>
        )}
        <div className="p-4 border-t border-gray-100"><div className="flex items-center gap-3"><div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-xs font-bold">U</div><div className="text-sm font-medium text-gray-700">User</div></div></div>
      </aside>

      <main className="flex-1 flex flex-col h-full relative overflow-hidden">
        {!activeSession && (<div className="flex-1 flex flex-col items-center justify-center text-gray-400"><p>请在左侧选择或新建一个岗位</p></div>)}
        {activeSession && !activeQuestion && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <header className="h-16 border-b border-gray-100 flex items-center justify-between px-8 bg-white shrink-0">
              <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">{activeSession.title}<span className="text-xs font-normal text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-100">面试准备</span></h1>
              <div className="flex items-center gap-4">
                <button onClick={() => setShowAddQuestionModal(true)} className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-indigo-600 transition-colors">+ 手动添加</button>
                <div className="h-6 w-px bg-gray-200"></div>
                <div className="flex items-center gap-2">
                   <div className="flex items-center bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 focus-within:ring-2 focus-within:ring-indigo-100 focus-within:border-indigo-300 transition-all">
                      <span className="text-xs text-gray-400 whitespace-nowrap mr-1">生成</span>
                      <input type="number" min={1} max={9} value={generateCount} onChange={(e) => {const val = parseInt(e.target.value); if (!isNaN(val)) setGenerateCount(Math.min(9, Math.max(1, val)));}} className="w-6 bg-transparent text-center text-sm font-bold text-gray-700 outline-none" />
                      <span className="text-xs text-gray-400 ml-1">题</span>
                   </div>
                   <button onClick={handleAiGenerate} disabled={isGenerating} className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-all flex items-center gap-2 ${isGenerating ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-100'}`}>
                     {isGenerating ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> AI 生成中...</> : <>✨ AI 生成</>}
                   </button>
                </div>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto p-8 bg-gray-50/50">
              <div className="max-w-4xl mx-auto space-y-4">
                {!isGenerating && activeSession.questions.length === 0 && (<div className="text-center py-20"><div className="inline-block p-4 bg-white rounded-full shadow-sm mb-4 text-4xl">🚀</div><h3 className="text-lg font-bold text-gray-800 mb-2">开始你的准备</h3><p className="text-gray-500 mb-6">该岗位暂无题目，上传简历可获得更精准的面试题。</p></div>)}
                {isGenerating && (<div className="space-y-4">{Array(generateCount).fill(0).map((_, i) => <div key={i} className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm animate-pulse"><div className="h-4 bg-gray-200 rounded w-1/3 mb-3"></div><div className="h-6 bg-gray-200 rounded w-3/4"></div></div>)}</div>)}
                {activeSession.questions.map((q, index) => (
                  <div key={q.id} className="group bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all flex flex-col sm:flex-row sm:items-start justify-between gap-4 animate-slide-up" style={{animationDelay: `${index * 50}ms`}}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2"><span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase border ${getTagColor(q.type)}`}>{q.type}</span></div>
                      {editingQuestionId === q.id ? (
                        <div className="flex flex-col gap-2"><textarea autoFocus value={editQuestionText} onChange={(e) => setEditQuestionText(e.target.value)} onKeyDown={(e) => {if (e.key === 'Enter' && !e.shiftKey) {e.preventDefault(); saveQuestionText();}}} className="w-full p-2 border border-indigo-300 rounded-lg outline-none text-lg text-gray-800 bg-indigo-50/30 resize-none" rows={3}/><div className="flex gap-2"><button onClick={saveQuestionText} className="px-3 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700">保存</button><button onClick={() => setEditingQuestionId(null)} className="px-3 py-1 bg-gray-200 text-gray-600 text-xs rounded hover:bg-gray-300">取消</button></div></div>
                      ) : (
                        <h3 className="text-gray-800 font-medium text-lg leading-snug pr-4 group-hover:text-indigo-900 transition-colors">{q.text}
                          <button onClick={() => startEditQuestion(q)} className="ml-2 inline-flex opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-500 transition-opacity" title="编辑"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg></button>
                          <button onClick={() => handleDeleteQuestion(q.id)} className="ml-2 inline-flex opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity" title="删除"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                        </h3>
                      )}
                    </div>
                    <button onClick={() => enterPracticeMode(q)} className="shrink-0 px-5 py-2.5 rounded-lg bg-white border border-gray-200 text-gray-600 font-medium hover:bg-indigo-600 hover:text-white hover:border-transparent transition-all active:scale-95 shadow-sm mt-2 sm:mt-0">开始练习</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* PRACTICE MODE OVERLAY - 这部分保持之前完整的 UI 逻辑 */}
        {activeQuestion && (
          <div className="absolute inset-0 z-30 bg-gray-50 flex flex-col animate-slide-up">
            <div className="h-16 px-8 flex items-center justify-between bg-white border-b border-gray-100 shrink-0">
               <button onClick={exitPracticeMode} className="flex items-center text-gray-500 hover:text-indigo-600 transition-colors font-medium"><svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg> 返回题目列表</button>
               <div className="text-sm text-gray-400">正在练习: {activeSession?.title}</div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="min-h-full flex flex-col items-center justify-center p-8">
                <div className="w-full max-w-3xl bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100 flex flex-col min-h-[500px]">
                  <div className="bg-indigo-600 p-8 text-white text-center shrink-0">
                    <span className="inline-block bg-indigo-500 text-indigo-100 text-xs px-3 py-1 rounded-full mb-4">当前问题</span>
                    <h1 className="text-2xl font-bold leading-relaxed">{activeQuestion.text}</h1>
                  </div>
                  <div className="flex-1 flex flex-col items-center justify-center p-8 relative w-full">
                    {practiceStatus === "idle" && <div className="w-full flex flex-col items-center h-full"><div className="flex-1 flex flex-col items-center justify-center min-h-[200px] w-full"><div className="mb-8 text-gray-400 text-sm font-medium">准备好后，点击麦克风开始回答</div><button onClick={startRecording} className="relative w-24 h-24 rounded-full bg-white text-indigo-600 shadow-[0_0_20px_rgba(79,70,229,0.15)] hover:shadow-[0_0_30px_rgba(79,70,229,0.3)] hover:scale-105 transition-all flex items-center justify-center group border-4 border-indigo-50"><svg className="w-10 h-10 group-hover:text-indigo-700 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg></button></div>{audioTakes.length > 0 && <div className="w-full border-t border-gray-100 pt-6 pb-2 animate-fade-in flex-1 overflow-hidden flex flex-col"><div className="flex items-center justify-between px-2 mb-4 shrink-0"><p className="text-xs font-bold text-gray-400 uppercase tracking-wider">历史练习记录 ({audioTakes.length})</p></div><div className="space-y-3 overflow-y-auto pr-2 pb-10 custom-scrollbar">{audioTakes.slice().reverse().map((take, idx) => (<div key={take.id} onClick={() => handleHistoryClick(take)} className="relative flex flex-col p-4 bg-white rounded-xl cursor-pointer border border-gray-100 hover:border-indigo-300 hover:shadow-md transition-all group"><div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center text-[10px] font-bold">#{audioTakes.length - idx}</span><span className="text-xs text-gray-400 font-medium">{new Date(take.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>{take.analysis ? <div className="px-2 py-1 rounded-md text-xs font-bold border bg-emerald-100 text-emerald-700 border-emerald-200">{take.analysis.score} 分</div> : <span className="text-[10px] bg-slate-100 text-slate-400 px-2 py-1 rounded-full">未分析</span>}</div>{take.analysis ? <p className="text-sm text-gray-700 line-clamp-1">{take.analysis.feedback}</p> : <p className="text-sm text-gray-400 italic">点击查看...</p>}<button onClick={(e) => handleDeleteTake(e, take.id)} className="absolute top-3 right-3 p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md opacity-0 group-hover:opacity-100 transition-all"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button></div>))}</div></div>}</div>}
                    {practiceStatus === "recording" && <div className="text-center"><div className="text-5xl font-mono font-bold text-indigo-600 mb-10">{formatTime(timer)}</div><div className="relative mb-10"><span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-20 animate-ping"></span><button onClick={stopRecording} className="relative w-24 h-24 rounded-full bg-red-500 text-white hover:bg-red-600 flex items-center justify-center shadow-xl transition-all"><div className="w-8 h-8 bg-white rounded-md"></div></button></div><p className="text-gray-400">点击停止录音</p></div>}
                    {practiceStatus === "review" && currentTake && <div className="w-full flex flex-col items-center animate-fade-in"><button onClick={handleBackToIdle} className="absolute top-0 left-0 text-gray-400 hover:text-gray-600 flex items-center text-sm transition-colors"><svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7 7-7m8 14l-7-7 7-7"></path></svg>重录/返回</button><h3 className="text-xl font-bold text-gray-800 mb-2">录音完成</h3><p className="text-gray-400 mb-8 text-sm">时长 {currentTake.durationString}</p><div className="bg-gray-50 p-4 rounded-2xl w-full max-w-md border border-gray-100 mb-8 flex justify-center"><audio src={currentTake.url} controls className="w-full" /></div>{!currentTake.analysis ? <div className="flex gap-4"><button onClick={handleBackToIdle} className="px-6 py-3 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium">稍后</button><button onClick={submitForAnalysis} className="px-8 py-3 rounded-xl bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 transition-all font-medium flex items-center gap-2">提交分析 ✨</button></div> : <div className="text-gray-500 text-sm">该录音已分析，请查看结果详情</div>}</div>}
                    {practiceStatus === "analyzing" && <div className="text-center"><div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-100 border-t-indigo-600 mx-auto mb-6"></div><h3 className="text-lg font-medium text-gray-800">AI 面试官正在分析...</h3></div>}
                    {practiceStatus === "result" && currentTake?.analysis && <div className="w-full h-full flex flex-col animate-fade-in overflow-y-auto"><button onClick={handleBackToIdle} className="absolute top-0 left-0 text-gray-400 hover:text-gray-600 flex items-center text-sm transition-colors"><svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7 7-7m8 14l-7-7 7-7"></path></svg>返回录音</button><div className="flex flex-col items-center justify-center mb-8 border-b border-gray-100 pb-6 mt-6"><div className="text-5xl font-bold text-indigo-600 tracking-tight mb-2">{currentTake.analysis.score} <span className="text-lg text-gray-400 font-normal">分</span></div><div className="w-full max-w-sm mt-4 bg-gray-50 p-3 rounded-xl border border-gray-200"><div className="flex justify-between text-xs text-gray-400 mb-1 px-1"><span>录音回顾</span><span>{currentTake.durationString}</span></div><audio src={currentTake.url} controls className="w-full h-8" /></div></div><div className="space-y-4 pb-10">{currentTake.transcription && <div className="p-4 bg-slate-50 rounded-xl border border-slate-100"><h4 className="font-bold text-slate-700 mb-2 text-sm flex items-center gap-2">🎙️ 你的回答</h4><p className="text-slate-600 text-sm leading-relaxed italic">"{currentTake.transcription}"</p></div>}<div className="p-5 bg-gray-50 rounded-xl border border-gray-100"><h4 className="font-bold text-gray-800 mb-2">💬 整体点评</h4><p className="text-gray-600 text-sm leading-relaxed">{currentTake.analysis.feedback}</p></div><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div className="p-5 bg-green-50/50 rounded-xl border border-green-100"><h4 className="font-bold text-green-800 mb-3 text-sm">✅ 亮点</h4><ul className="list-disc list-inside space-y-1">{currentTake.analysis.pros.map((p,i)=><li key={i} className="text-sm text-green-700">{p}</li>)}</ul></div><div className="p-5 bg-orange-50/50 rounded-xl border border-orange-100"><h4 className="font-bold text-orange-800 mb-3 text-sm">💡 建议</h4><ul className="list-disc list-inside space-y-1">{currentTake.analysis.cons.map((c,i)=><li key={i} className="text-sm text-orange-700">{c}</li>)}</ul></div></div><div className="p-5 bg-indigo-50 rounded-xl border border-indigo-100"><h4 className="font-bold text-indigo-900 mb-2 text-sm">✨ 优化回答示范</h4><p className="text-indigo-800 text-sm leading-relaxed">{currentTake.analysis.betterAnswer}</p></div></div></div>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

      </main>

      {showCreateSessionModal && <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"><div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-sm animate-scale-in"><h2 className="text-lg font-bold text-gray-800 mb-4">新建岗位面试</h2><input autoFocus value={newSessionTitle} onChange={e => setNewSessionTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateSession()} placeholder="例如：高级Java开发、产品总监..." className="w-full p-3 border border-gray-200 rounded-xl mb-6 outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 text-sm" /><div className="flex justify-end gap-3"><button onClick={() => setShowCreateSessionModal(false)} className="px-4 py-2 rounded-lg text-gray-500 hover:bg-gray-100 text-sm">取消</button><button onClick={handleCreateSession} disabled={!newSessionTitle.trim()} className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 text-sm">创建</button></div></div></div>}
      {showAddQuestionModal && <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"><div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-md animate-scale-in"><h2 className="text-lg font-bold text-gray-800 mb-4">添加自定义题目</h2><div className="flex flex-wrap gap-2 mb-4">{(["自定义", "硬技能", "软技能", "通用", "行业洞察"] as QuestionType[]).map(type => (<button key={type} onClick={() => setManualQuestionType(type)} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${manualQuestionType === type ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-300'}`}>{type}</button>))}</div><textarea autoFocus value={manualQuestionInput} onChange={e => setManualQuestionInput(e.target.value)} placeholder="输入你在 JD 或面经上看到的题目..." className="w-full p-4 border border-gray-200 rounded-xl mb-6 outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 min-h-[120px] text-sm resize-none" /><div className="flex justify-end gap-3"><button onClick={() => setShowAddQuestionModal(false)} className="px-4 py-2 rounded-lg text-gray-500 hover:bg-gray-100 text-sm">取消</button><button onClick={handleManualAddQuestion} disabled={!manualQuestionInput.trim()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm">添加</button></div></div></div>}
    </div>
  );
}