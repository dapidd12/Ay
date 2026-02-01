
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AppData, Semester, Subject } from './types';
import { 
  calculateSemesterAverage, 
  calculateOverallAverage, 
  saveToStorage, 
  loadFromStorage 
} from './utils';
import { GoogleGenAI, Type } from "@google/genai";

const generateId = () => Math.random().toString(36).substring(2, 11);

const INITIAL_DATA: AppData = {
  userName: '',
  semesters: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, subjects: [] })),
  targetAvg: 85,
  totalSemestersTarget: 6
};

const App: React.FC = () => {
  const [data, setData] = useState<AppData>(INITIAL_DATA);
  const [activeSemesterId, setActiveSemesterId] = useState<number>(1);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [showWelcome, setShowWelcome] = useState(false);
  const [showFinalModal, setShowFinalModal] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [summarySemesterId, setSummarySemesterId] = useState<number | null>(null);
  
  const reportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load data on mount
  useEffect(() => {
    const saved = loadFromStorage();
    if (saved) {
      setData(saved);
      if (!saved.userName) setShowWelcome(true);
    } else {
      setShowWelcome(true);
    }
    setIsLoaded(true);
  }, []);

  // Save data on changes
  useEffect(() => {
    if (isLoaded) saveToStorage(data);
  }, [data, isLoaded]);

  // Handle semester count changes
  useEffect(() => {
    if (!isLoaded) return;
    const targetCount = Math.max(1, data.totalSemestersTarget);
    
    if (data.semesters.length !== targetCount) {
      setData(prev => {
        let currentSems = [...prev.semesters];
        if (currentSems.length < targetCount) {
          const toAdd = targetCount - currentSems.length;
          const s1 = currentSems[0];
          const newSems = Array.from({ length: toAdd }, (_, i) => ({ 
            id: currentSems.length + i + 1, 
            subjects: s1?.subjects.map(s => ({ ...s, score: 0, id: generateId() })) || [] 
          }));
          currentSems = [...currentSems, ...newSems];
        } else {
          currentSems = currentSems.slice(0, targetCount);
        }
        return { ...prev, semesters: currentSems };
      });
    }
  }, [data.totalSemestersTarget, isLoaded, data.semesters.length]);

  const getSemesterStatus = useCallback((semester: Semester) => {
    if (!semester || semester.subjects.length === 0) return 'empty';
    const scoredCount = semester.subjects.filter(s => s.score > 0).length;
    if (scoredCount === 0) return 'empty';
    if (scoredCount < semester.subjects.length) return 'partial';
    return 'complete';
  }, []);

  const activeSemester = useMemo(() => 
    data.semesters.find(s => s.id === activeSemesterId) || null,
    [data.semesters, activeSemesterId]
  );

  const completeSemesters = useMemo(() => 
    data.semesters.filter(s => getSemesterStatus(s) === 'complete'), 
  [data.semesters, getSemesterStatus]);

  const averagesHistory = useMemo(() => 
    completeSemesters.map(s => calculateSemesterAverage(s)),
  [completeSemesters]);

  const overallAvg = useMemo(() => calculateOverallAverage(completeSemesters), [completeSemesters]);
  
  const neededAvg = useMemo(() => {
    const remaining = data.totalSemestersTarget - completeSemesters.length;
    if (remaining <= 0) return 0;
    const targetTotalSum = data.targetAvg * data.totalSemestersTarget;
    const currentSumOfAverages = completeSemesters.reduce((acc, sem) => acc + calculateSemesterAverage(sem), 0);
    const needed = (targetTotalSum - currentSumOfAverages) / remaining;
    return Math.max(0, Math.min(100, needed));
  }, [data.targetAvg, data.totalSemestersTarget, completeSemesters]);

  const diagnosticData = useMemo(() => {
    if (averagesHistory.length === 0) return null;
    if (averagesHistory.length === 1) return { trend: 'STABIL', trendColor: 'text-indigo-400', consistency: 100 };
    
    const last = averagesHistory[averagesHistory.length - 1];
    const prev = averagesHistory[averagesHistory.length - 2];
    const diff = last - prev;
    
    const trend = diff > 0.2 ? 'MENINGKAT' : diff < -0.2 ? 'MENURUN' : 'STABIL';
    const trendColor = diff > 0.2 ? 'text-emerald-400' : diff < -0.2 ? 'text-rose-400' : 'text-indigo-400';
    
    const mean = averagesHistory.reduce((a, b) => a + b, 0) / averagesHistory.length;
    const variance = averagesHistory.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / averagesHistory.length;
    const consistency = Math.max(0, Math.min(100, Math.round(100 - (Math.sqrt(variance) * 5))));
    
    return { trend, trendColor, consistency };
  }, [averagesHistory]);

  const allSemestersComplete = useMemo(() => 
    completeSemesters.length === data.totalSemestersTarget && completeSemesters.length > 0,
  [completeSemesters.length, data.totalSemestersTarget]);

  const validation = useMemo(() => {
    const hasPartial = data.semesters.some(s => getSemesterStatus(s) === 'partial');
    const hasComplete = completeSemesters.length > 0;
    return { 
      canCalculate: !hasPartial && hasComplete && data.targetAvg > 0 && data.totalSemestersTarget > 0,
      hasPartial
    };
  }, [data, completeSemesters, getSemesterStatus]);

  const syncS1ToOthers = (allSemesters: Semester[]) => {
    const s1 = allSemesters[0];
    if (!s1) return allSemesters;
    return allSemesters.map(s => {
      if (s.id === 1) return s;
      const newSubjects = s1.subjects.map(template => {
        const existing = s.subjects.find(sub => sub.name === template.name);
        return existing ? existing : { ...template, score: 0, id: generateId() };
      });
      return { ...s, subjects: newSubjects };
    });
  };

  const handleUpdateSubject = (subId: string, field: keyof Subject, value: string | number) => {
    setData(prev => {
      const updatedSems = prev.semesters.map(s => {
        if (s.id === activeSemesterId) {
          return { ...s, subjects: s.subjects.map(sub => sub.id === subId ? { ...sub, [field]: value } : sub) };
        }
        return s;
      });

      if (activeSemesterId === 1 && field === 'name') {
        return { ...prev, semesters: syncS1ToOthers(updatedSems) };
      }
      return { ...prev, semesters: updatedSems };
    });
    setShowResults(false);
  };

  const handleDeleteSubject = (subId: string) => {
    setData(prev => {
      const s1 = prev.semesters[0];
      const targetSub = s1.subjects.find(s => s.id === subId);
      if (!targetSub) return prev;

      const newS1Subjects = s1.subjects.filter(s => s.id !== subId);
      const newS1 = { ...s1, subjects: newS1Subjects };

      const newSemesters = prev.semesters.map(s => {
        if (s.id === 1) return newS1;
        return { ...s, subjects: s.subjects.filter(sub => sub.name !== targetSub.name) };
      });

      return { ...prev, semesters: newSemesters };
    });
    setShowResults(false);
  };

  const handleAddSubject = () => {
    setData(prev => {
      const newId = generateId();
      const updatedSems = prev.semesters.map(s => {
        if (s.id === 1) {
          return { ...s, subjects: [...s.subjects, { id: newId, name: '', score: 0 }] };
        }
        return s;
      });
      return { ...prev, semesters: syncS1ToOthers(updatedSems) };
    });
  };

  const handleScanImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsScanning(true);
    setScanProgress({ current: 0, total: files.length });
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
      const scanPromises = Array.from(files).map(async (file: File) => {
        const base64 = await new Promise<string>(r => {
          const reader = new FileReader();
          reader.onloadend = () => r((reader.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: { parts: [{ inlineData: { data: base64, mimeType: file.type } }, { text: "Extract subjects and scores. Return JSON: { subjects: [{ name: string, score: number }] }" }] },
          config: { responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { subjects: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, score: { type: Type.NUMBER } }, required: ["name", "score"] } } }, required: ["subjects"] } }
        });
        setScanProgress(prev => ({ ...prev, current: prev.current + 1 }));
        return JSON.parse(response.text || '{"subjects":[]}').subjects || [];
      });
      const allResultsArray = await Promise.all(scanPromises);
      const allDetected = allResultsArray.flat();
      setData(prev => {
        const updatedSems = prev.semesters.map(s => {
          if (s.id === activeSemesterId) {
            const current = [...s.subjects];
            allDetected.forEach(item => {
              const idx = current.findIndex(c => c.name.toLowerCase().replace(/\s/g,'') === item.name.toLowerCase().replace(/\s/g,''));
              if (idx > -1) { if (item.score > 0) current[idx].score = item.score; }
              else { current.push({ id: generateId(), name: item.name, score: item.score }); }
            });
            return { ...s, subjects: current };
          }
          return s;
        });

        if (activeSemesterId === 1) {
          return { ...prev, semesters: syncS1ToOthers(updatedSems) };
        }
        return { ...prev, semesters: updatedSems };
      });
    } catch (err) { alert("Pindaian Gagal. Periksa koneksi internet."); } finally { setIsScanning(false); }
  };

  const triggerAnalysis = useCallback(() => {
    if (!validation.canCalculate) return;
    setIsCalculating(true);
    setTimeout(() => {
      setIsCalculating(false);
      setShowResults(true);
      if (allSemestersComplete) setShowFinalModal(true);
      reportRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 1200);
  }, [validation.canCalculate, allSemestersComplete]);

  const renderModal = (title: string, content: React.ReactNode, onClose: () => void, accentColor: string = "border-indigo-500") => (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
      <div className={`glass-card rounded-[2rem] w-full max-w-xl p-6 md:p-10 animate-in border-t-8 ${accentColor} shadow-3xl overflow-y-auto max-h-[90vh]`}>
        <div className="flex justify-between items-center mb-6">
           <h3 className="text-xl md:text-2xl font-black uppercase tracking-tighter text-slate-100">{title}</h3>
           <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-slate-400">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" strokeWidth="2" strokeLinecap="round"/></svg>
           </button>
        </div>
        <div className="text-slate-200">
          {content}
        </div>
        <button onClick={onClose} className="w-full mt-8 py-4 bg-indigo-600 text-white font-black uppercase tracking-widest rounded-xl hover:bg-indigo-500 active:scale-95 transition-all shadow-xl">Tutup</button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen text-slate-100 selection:bg-indigo-500/30">
      
      {/* Scanning Loader */}
      {isScanning && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-xl">
           <div className="w-16 h-16 md:w-24 md:h-24 mb-6 relative">
              <div className="absolute inset-0 border-4 border-indigo-500/10 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-t-indigo-500 rounded-full animate-spin"></div>
           </div>
           <p className="tech-font text-indigo-400 animate-pulse text-[10px] md:text-xs tracking-[0.4em] uppercase font-black">AI Memproses Rapor...</p>
        </div>
      )}

      {/* Guide Modal */}
      {showGuide && renderModal(
        "Panduan Penggunaan 📖",
        <div className="space-y-6">
          <div className="flex gap-5 items-start">
            <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center text-indigo-400 font-bold shrink-0">1</div>
            <div>
              <p className="font-bold text-slate-100 mb-1">Atur Target</p>
              <p className="text-sm text-slate-400">Tentukan target nilai rata-rata yang ingin Anda capai dan total semester masa studi Anda di bagian atas dashboard.</p>
            </div>
          </div>
          <div className="flex gap-5 items-start">
            <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center text-indigo-400 font-bold shrink-0">2</div>
            <div>
              <p className="font-bold text-slate-100 mb-1">Master Template (SMT 1)</p>
              <p className="text-sm text-slate-400">Gunakan <b>Semester 1</b> untuk menyusun daftar mata pelajaran. Perubahan di sini akan otomatis disinkronkan ke seluruh semester lainnya.</p>
            </div>
          </div>
          <div className="flex gap-5 items-start">
            <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center text-indigo-400 font-bold shrink-0">3</div>
            <div>
              <p className="font-bold text-slate-100 mb-1">Input Nilai & Scan AI</p>
              <p className="text-sm text-slate-400">Isi nilai tiap mata pelajaran secara manual atau gunakan tombol <b>Scan AI</b> untuk mengekstrak nilai dari foto rapor Anda secara instan.</p>
            </div>
          </div>
          <div className="flex gap-5 items-start">
            <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center text-indigo-400 font-bold shrink-0">4</div>
            <div>
              <p className="font-bold text-slate-100 mb-1">Analisis Strategis</p>
              <p className="text-sm text-slate-400">Setelah data terisi, klik tombol <b>Lihat Strategi</b> di bawah untuk melihat proyeksi nilai minimal yang harus Anda capai di sisa semester.</p>
            </div>
          </div>
        </div>,
        () => setShowGuide(false)
      )}

      {/* Modals */}
      {showWelcome && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/95 backdrop-blur-3xl">
          <div className="glass-card rounded-[2.5rem] p-8 md:p-14 w-full max-w-lg text-center animate-in shadow-3xl border-t-8 border-indigo-500">
            <h2 className="text-3xl md:text-4xl font-black mb-2 text-slate-100">Smart<span className="text-indigo-400">Rapor</span></h2>
            <p className="text-slate-400 text-[10px] uppercase tracking-[0.4em] font-black mb-8">Platform Analisis Akademik</p>
            <input 
              type="text" 
              value={data.userName} 
              onChange={e => setData(prev => ({ ...prev, userName: e.target.value }))} 
              className="w-full bg-slate-900/50 border-2 border-white/10 rounded-xl py-4 md:py-6 px-6 md:px-8 text-center text-lg md:text-xl font-bold text-white outline-none focus:border-indigo-500 transition-all mb-6" 
              placeholder="Masukkan namamu" 
              onKeyDown={e => e.key === 'Enter' && data.userName && setShowWelcome(false)}
            />
            <button 
              onClick={() => data.userName && setShowWelcome(false)} 
              className="w-full py-4 md:py-6 bg-indigo-600 text-white rounded-xl font-black uppercase tracking-widest shadow-xl hover:bg-indigo-500 active:scale-95 transition-all"
            >
              Mulai Eksplorasi
            </button>
          </div>
        </div>
      )}

      {showFinalModal && renderModal(
        overallAvg >= data.targetAvg ? "TARGET TERCAPAI 🎓" : "PERLU EVALUASI 🔥",
        <div className="text-center">
          <div className={`text-6xl md:text-8xl font-black tech-font mb-4 ${overallAvg >= data.targetAvg ? 'text-emerald-400' : 'text-amber-400'}`}>
            {overallAvg.toFixed(1)}%
          </div>
          <p className="text-lg md:text-xl leading-relaxed text-slate-300 mb-6 md:mb-8">
            {overallAvg >= data.targetAvg 
              ? `Selamat ${data.userName}! Kamu melampaui target ${data.targetAvg}%. Semua usaha kerasmu membuahkan hasil luar biasa.`
              : `Halo ${data.userName}, rerata akhir ${overallAvg.toFixed(1)}% belum mencapai target ${data.targetAvg}%. Jadikan ini motivasi untuk berjuang lebih gigih!`
            }
          </p>
          <div className={`p-6 md:p-8 rounded-2xl border bg-white/5 border-white/10 italic text-slate-400 text-sm shadow-inner`}>
            {overallAvg >= data.targetAvg ? "“Kesuksesan bukanlah kunci kebahagiaan. Kebahagiaanlah kunci kesuksesan.”" : "“Kegagalan adalah satu-satunya kesempatan untuk memulai lagi dengan lebih cerdas.”"}
          </div>
        </div>,
        () => setShowFinalModal(false),
        overallAvg >= data.targetAvg ? 'border-emerald-500' : 'border-amber-500'
      )}

      {summarySemesterId !== null && (() => {
        const sem = data.semesters.find(s => s.id === summarySemesterId);
        if (!sem) return null;
        const avg = calculateSemesterAverage(sem);
        const sorted = [...sem.subjects].sort((a,b) => b.score - a.score);
        return renderModal(
          `Hasil Semester ${summarySemesterId}`,
          <div className="space-y-4 md:space-y-6">
             <div className="p-6 md:p-8 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 text-center">
                <span className="text-[10px] font-black uppercase text-indigo-400 tracking-widest block mb-2">Rerata Nilai</span>
                <span className="text-4xl md:text-5xl font-black tech-font text-white">{avg.toFixed(1)}</span>
             </div>
             <div className="grid grid-cols-2 gap-3 md:gap-4">
                <div className="p-4 bg-emerald-500/5 rounded-xl border border-emerald-500/10 text-center">
                   <p className="text-[8px] font-black text-emerald-400 uppercase mb-2">Tertinggi</p>
                   <p className="text-xs font-bold truncate text-slate-200">{sorted[0]?.name || '-'}</p>
                   <p className="text-xl font-black tech-font text-emerald-400">{sorted[0]?.score || 0}</p>
                </div>
                <div className="p-4 bg-rose-500/5 rounded-xl border border-rose-500/10 text-center">
                   <p className="text-[8px] font-black text-rose-400 uppercase mb-2">Terendah</p>
                   <p className="text-xs font-bold truncate text-slate-200">{sorted[sorted.length-1]?.name || '-'}</p>
                   <p className="text-xl font-black tech-font text-rose-400">{sorted[sorted.length-1]?.score || 0}</p>
                </div>
             </div>
             <div className="bg-slate-900/60 p-4 rounded-xl max-h-48 overflow-y-auto no-scrollbar border border-white/5">
                {sorted.map(s => (
                  <div key={s.id} className="flex justify-between items-center py-2 border-b border-white/5 last:border-0 px-2">
                     <span className="text-xs text-slate-400 truncate pr-4">{s.name}</span>
                     <span className={`tech-font font-bold text-sm ${s.score >= avg ? 'text-emerald-400' : 'text-rose-400'}`}>{s.score}</span>
                  </div>
                ))}
             </div>
          </div>,
          () => setSummarySemesterId(null)
        );
      })()}

      <header className="sticky top-0 z-40 glass-card border-b border-white/5 backdrop-blur-2xl h-16 md:h-20 px-4 md:px-8 flex items-center shadow-xl">
        <div className="max-w-7xl mx-auto w-full flex justify-between items-center">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 md:w-10 md:h-10 bg-indigo-600 rounded-lg flex items-center justify-center font-black text-white text-xl shadow-lg">S</div>
             <h1 className="text-lg md:text-xl font-black tracking-tighter text-slate-100">Smart<span className="text-indigo-400">Rapor</span></h1>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            <button 
              onClick={() => setShowGuide(true)}
              className="hidden md:flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-full border border-white/5 transition-all font-bold text-[10px] uppercase tracking-widest text-indigo-300"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Panduan
            </button>
            <div onClick={() => setShowWelcome(true)} className="flex items-center gap-2 md:gap-3 cursor-pointer group bg-white/5 p-1 md:pl-4 md:pr-1 rounded-full border border-white/5 hover:border-indigo-500/40 transition-all shadow-sm">
              <div className="hidden sm:block text-right">
                  <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">User</p>
                  <p className="text-xs font-bold text-slate-200">{data.userName || 'Tamu'}</p>
              </div>
              <div className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-slate-800 flex items-center justify-center text-indigo-400 shadow-inner group-hover:bg-indigo-600 group-hover:text-white transition-all">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" strokeWidth="2.5" /></svg>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-grow max-w-7xl mx-auto w-full px-4 md:px-8 py-8 md:py-12">
        <section className="mb-8 md:mb-12 animate-in text-center md:text-left">
           <h2 className="text-4xl md:text-7xl font-black mb-4 tracking-tighter leading-none text-slate-100">Kalkulasi <br className="hidden md:block" /> <span className="text-indigo-500">Masa Depan.</span></h2>
           <p className="text-slate-400 max-w-2xl text-sm md:text-lg mx-auto md:mx-0 font-medium leading-relaxed">Platform analisis rapor cerdas untuk memantau target pendidikan dengan presisi tinggi dan teknologi AI.</p>
        </section>

        {/* Dynamic Stats */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-10 md:mb-12 animate-in">
           <div className="glass-card p-6 md:p-8 rounded-2xl border-l-8 border-indigo-500 shadow-xl transition-all hover:translate-y-[-2px]">
              <span className="text-[8px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Target Akhir</span>
              <div className="flex items-center gap-3">
                 <input 
                   type="number" 
                   value={data.targetAvg || ''} 
                   onChange={e => setData(prev => ({ ...prev, targetAvg: Math.min(100, parseFloat(e.target.value) || 0) }))} 
                   className="bg-transparent text-4xl md:text-5xl font-black tech-font text-white w-20 md:w-24 outline-none focus:text-indigo-400 transition-colors" 
                 />
                 <span className="text-slate-700 font-black text-2xl">%</span>
              </div>
           </div>
           <div className="glass-card p-6 md:p-8 rounded-2xl border-l-8 border-indigo-400 shadow-xl transition-all hover:translate-y-[-2px]">
              <span className="text-[8px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Jumlah SMT</span>
              <div className="flex items-center gap-3">
                 <input 
                   type="number" 
                   value={data.totalSemestersTarget || ''} 
                   onChange={e => setData(prev => ({ ...prev, totalSemestersTarget: Math.min(12, parseInt(e.target.value) || 0) }))} 
                   className="bg-transparent text-4xl md:text-5xl font-black tech-font text-white w-20 md:w-24 outline-none focus:text-indigo-400 transition-colors" 
                 />
                 <span className="text-slate-700 font-black text-2xl">SMT</span>
              </div>
           </div>
           
           <div className="col-span-1 sm:col-span-2 grid grid-cols-2 gap-4">
              <div className="glass-card p-5 md:p-6 rounded-2xl flex flex-col justify-center border border-white/5 shadow-md">
                 <p className="text-[8px] md:text-[9px] font-black text-slate-600 uppercase mb-1">Tren Saat Ini</p>
                 <p className={`text-xl md:text-2xl font-black tech-font ${diagnosticData?.trendColor || 'text-slate-400'}`}>{diagnosticData?.trend || 'STABIL'}</p>
              </div>
              <div className="glass-card p-5 md:p-6 rounded-2xl flex flex-col justify-center border border-white/5 shadow-md">
                 <p className="text-[8px] md:text-[9px] font-black text-slate-600 uppercase mb-1">Target SMT Sisa</p>
                 <p className="text-xl md:text-2xl font-black tech-font text-white">{allSemestersComplete ? 'DONE' : `${neededAvg.toFixed(1)}%`}</p>
              </div>
           </div>
        </section>

        {/* Semester Tabs */}
        <div className="flex gap-2 md:gap-4 overflow-x-auto pb-6 no-scrollbar mb-8 animate-in px-2">
           {data.semesters.map(s => {
             const active = activeSemesterId === s.id;
             const status = getSemesterStatus(s);
             return (
               <button 
                key={s.id} 
                onClick={() => setActiveSemesterId(s.id)} 
                className={`relative flex-shrink-0 min-w-[85px] md:min-w-[130px] px-5 md:px-10 py-6 md:py-10 rounded-2xl border-2 transition-all duration-300 flex flex-col items-center ${
                  active 
                    ? 'bg-indigo-600 text-white border-indigo-400 scale-105 z-10 shadow-2xl' 
                    : 'glass-card text-slate-500 border-white/5 hover:border-white/20'
                }`}
               >
                 <span className={`text-[8px] md:text-[10px] font-black uppercase mb-1 ${active ? 'opacity-80' : 'opacity-40'}`}>SMT</span>
                 <span className={`text-2xl md:text-4xl font-black tech-font ${active ? 'text-white' : 'text-slate-300'}`}>{s.id}</span>
                 {status === 'complete' && (
                    <div className="absolute -top-1.5 -right-1.5 md:-top-3 md:-right-3 w-6 h-6 md:w-9 md:h-9 bg-emerald-500 rounded-full border-2 md:border-4 border-slate-950 flex items-center justify-center text-[8px] md:text-[10px] text-slate-950 font-black shadow-lg">✓</div>
                 )}
               </button>
             );
           })}
        </div>

        {/* Editor Area */}
        <section className="glass-card rounded-[2rem] md:rounded-[3.5rem] p-6 md:p-14 mb-14 animate-in shadow-2xl relative overflow-hidden">
           {activeSemester ? (
             <>
               <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-10">
                  <div className="w-full md:w-auto">
                    <h3 className="text-2xl md:text-4xl font-black tracking-tight mb-2 text-slate-100">Semester {activeSemesterId}</h3>
                    <div className="flex flex-wrap items-center gap-4">
                       {activeSemesterId === 1 && (
                         <span className="text-[8px] md:text-[10px] font-black text-indigo-400 uppercase tracking-widest bg-indigo-500/10 px-4 py-1.5 rounded-full border border-indigo-500/20 shadow-inner">
                           Master Template
                         </span>
                       )}
                       {getSemesterStatus(activeSemester) === 'complete' && (
                         <button 
                          onClick={() => setSummarySemesterId(activeSemesterId)} 
                          className="flex items-center gap-2 text-[9px] md:text-[10px] font-black text-indigo-300 uppercase tracking-widest hover:text-white transition-all group"
                         >
                           <svg className="w-4 h-4 md:w-5 md:h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" strokeWidth="2.5" /></svg>
                           Statistik SMT
                         </button>
                       )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3 md:gap-5 w-full md:w-auto">
                    <button 
                      onClick={() => fileInputRef.current?.click()} 
                      className="flex-1 md:flex-none px-6 md:px-10 py-3.5 md:py-4 bg-white/5 border border-white/10 rounded-xl font-black text-[10px] md:text-[11px] uppercase tracking-widest hover:bg-white/10 transition-all flex items-center justify-center gap-3 shadow-md"
                    >
                       <svg className="w-4 h-4 md:w-5 md:h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" strokeWidth="2.5" /><circle cx="12" cy="13" r="3" strokeWidth="2.5" /></svg>
                       Scan AI
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleScanImage} multiple className="hidden" accept="image/*" />
                    {activeSemesterId === 1 && (
                      <button onClick={handleAddSubject} className="flex-1 md:flex-none px-8 md:px-12 py-3.5 md:py-4 bg-indigo-600 text-white rounded-xl font-black text-[10px] md:text-[11px] uppercase tracking-widest hover:bg-indigo-500 shadow-xl transition-all">Tambah Mapel</button>
                    )}
                  </div>
               </div>

               <div className="grid gap-4 md:gap-5">
                 {activeSemester.subjects.length === 0 ? (
                   <div className="py-24 md:py-28 text-center border-4 border-dashed border-white/5 rounded-2xl md:rounded-[3rem] bg-white/[0.01]">
                      <p className="text-slate-600 font-black uppercase text-[10px] md:text-xs tracking-[0.5em]">Input Mapel di SMT 1 untuk Memulai</p>
                   </div>
                 ) : activeSemester.subjects.map((sub, i) => (
                   <div key={sub.id} className="flex flex-col sm:flex-row items-center gap-4 md:gap-8 bg-slate-900/40 p-5 md:p-7 rounded-xl md:rounded-[2rem] border border-white/5 group hover:border-indigo-500/30 transition-all shadow-lg">
                      <div className="flex items-center gap-4 md:gap-8 w-full sm:w-auto flex-grow">
                         <span className="tech-font text-slate-700 font-black text-sm md:text-base w-8 md:w-10 text-center opacity-40">{(i+1).toString().padStart(2,'0')}</span>
                         <input 
                           type="text" 
                           value={sub.name} 
                           readOnly={activeSemesterId !== 1} 
                           onChange={e => handleUpdateSubject(sub.id, 'name', e.target.value)} 
                           className={`flex-grow bg-transparent font-bold outline-none text-base md:text-xl transition-colors ${activeSemesterId === 1 ? 'focus:text-indigo-400 text-slate-100' : 'text-slate-400 cursor-not-allowed'}`} 
                           placeholder="Mata Pelajaran" 
                         />
                      </div>
                      <div className="flex items-center gap-4 md:gap-8 w-full sm:w-auto justify-between sm:justify-end">
                         <div className="relative">
                           <input 
                             type="number" 
                             value={sub.score || ''} 
                             onChange={e => handleUpdateSubject(sub.id, 'score', Math.min(100, parseInt(e.target.value) || 0))} 
                             className="w-24 md:w-32 bg-slate-950 border border-white/10 rounded-xl md:rounded-2xl py-3 md:py-4 text-center text-indigo-400 font-black tech-font text-xl md:text-3xl outline-none focus:border-indigo-500 transition-all shadow-inner" 
                             placeholder="0" 
                           />
                         </div>
                         {activeSemesterId === 1 && (
                           <button onClick={() => handleDeleteSubject(sub.id)} className="p-3 md:p-4 text-slate-700 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition-all shadow-sm">
                              <svg className="w-6 h-6 md:w-7 md:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                           </button>
                         )}
                      </div>
                   </div>
                 ))}
               </div>
             </>
           ) : <div className="py-24 text-center text-slate-700 tech-font font-black uppercase tracking-widest text-xs">Akses Modul Gagal</div>}
        </section>

        {/* Global Action */}
        <div className="max-w-2xl mx-auto mb-20 md:mb-32 text-center px-4">
           <button 
            disabled={!validation.canCalculate || isCalculating} 
            onClick={triggerAnalysis} 
            className={`w-full py-6 md:py-9 rounded-[2rem] md:rounded-[3rem] font-black text-xl md:text-2xl uppercase tracking-[0.3em] md:tracking-[0.5em] transition-all duration-300 shadow-2xl ${
              validation.canCalculate 
                ? 'bg-gradient-to-r from-indigo-600 to-indigo-800 text-white hover:brightness-110 hover:scale-[1.01] active:scale-95' 
                : 'bg-slate-900 text-slate-700 opacity-50 cursor-not-allowed border border-white/5'
            }`}
           >
              {isCalculating ? 'Menganalisis...' : allSemestersComplete ? 'Hasil Tuntas' : 'Lihat Strategi'}
           </button>
           {!validation.canCalculate && (
             <p className="mt-6 md:mt-8 text-[9px] md:text-[11px] text-amber-500/60 font-black uppercase tracking-[0.3em] md:tracking-[0.4em]">Selesaikan input SMT aktif untuk kalkulasi</p>
           )}
        </div>

        {/* Strategy Roadmap */}
        {showResults && (
          <div ref={reportRef} className="space-y-24 md:space-y-36 animate-in pb-48">
             <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 md:gap-12">
                <div className="glass-card p-10 md:p-14 rounded-[3rem] text-center border-t-8 border-indigo-500 bg-slate-950 flex flex-col justify-center shadow-3xl">
                   <span className="text-slate-500 text-[9px] md:text-[10px] font-black uppercase tracking-widest mb-8 block">Rerata Akhir</span>
                   <div className="text-7xl md:text-9xl font-black tech-font mb-4 text-white leading-none">{overallAvg.toFixed(1)}</div>
                   <div className="text-[10px] md:text-[12px] font-black text-indigo-400 uppercase tracking-[0.3em] py-3 bg-indigo-500/10 rounded-full border border-indigo-500/20 max-w-[220px] mx-auto shadow-inner">Cumulative IQ Matrix</div>
                </div>

                <div className="glass-card p-10 md:p-14 rounded-[3rem] lg:col-span-2 border-t-8 border-indigo-400 bg-[#0a0f1d]/60 shadow-3xl flex flex-col justify-center relative overflow-hidden">
                   <h4 className="text-slate-500 text-[9px] md:text-[10px] font-black uppercase tracking-widest mb-10">Strategi Kelulusan</h4>
                   <div className="flex flex-col sm:flex-row items-center gap-8 md:gap-14">
                      <div className="p-10 md:p-12 bg-indigo-500/10 rounded-[2.5rem] border border-indigo-500/20 text-center shadow-2xl relative min-w-[180px]">
                         <div className="text-6xl md:text-8xl font-black text-indigo-400 tech-font mb-2 leading-none">{allSemestersComplete ? '✓' : `${neededAvg.toFixed(1)}%`}</div>
                         <p className="text-[9px] md:text-[10px] font-black text-indigo-500/50 uppercase tracking-widest">{allSemestersComplete ? 'Studi Selesai' : 'Min. Target / SMT'}</p>
                      </div>
                      <div className="flex-grow text-center sm:text-left">
                         {allSemestersComplete ? (
                           <div className="space-y-4">
                             <p className="text-2xl md:text-3xl text-slate-100 font-bold leading-tight">Perjalanan Tuntas.</p>
                             <p className="text-lg md:text-xl text-slate-400 italic font-medium leading-relaxed border-l-4 border-emerald-500/30 pl-8 md:pl-12">"Seluruh rekam jejak akademikmu telah tuntas diproses. Terima kasih telah menggunakan platform kami."</p>
                           </div>
                         ) : (
                           <p className="text-2xl md:text-3xl text-slate-200 italic font-medium leading-relaxed border-l-4 border-indigo-500/30 pl-8 md:pl-12">"Diperlukan rerata minimal <b className="text-indigo-400">{neededAvg.toFixed(1)}%</b> di sisa semester untuk menggapai target <b className="text-white">{data.targetAvg}%</b>."</p>
                         )}
                      </div>
                   </div>
                </div>
             </div>

             {!allSemestersComplete && (
               <div className="space-y-10 md:space-y-14">
                  <div className="flex items-center gap-6 md:gap-8">
                     <h3 className="text-2xl md:text-3xl font-black uppercase tracking-tighter text-slate-100">Peta <span className="text-indigo-500">Target Mapel</span></h3>
                     <div className="h-px bg-white/5 flex-grow"></div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 md:gap-10">
                     {data.semesters[0].subjects.map((s, idx) => {
                       const targetVal = Math.ceil(neededAvg);
                       const isHighEffort = targetVal > 90;
                       return (
                         <div key={idx} className={`glass-card p-10 md:p-12 rounded-[2.5rem] border-l-8 transition-all hover:scale-[1.03] shadow-xl ${isHighEffort ? 'border-rose-500 bg-rose-500/[0.03]' : 'border-indigo-500 bg-indigo-500/[0.02]'}`}>
                            <div className="flex justify-between items-start mb-8 md:mb-10">
                               <h5 className="text-base md:text-lg font-black text-slate-300 uppercase truncate pr-4">{s.name || 'Mapel Baru'}</h5>
                               <div className={`px-4 py-1.5 text-[9px] font-black rounded-xl uppercase shadow-md ${isHighEffort ? 'bg-rose-500/20 text-rose-400' : 'bg-indigo-500/10 text-indigo-400'}`}>{isHighEffort ? 'KRITIS' : 'TARGET'}</div>
                            </div>
                            <div className="space-y-4 md:space-y-5">
                               {data.semesters.filter(sem => getSemesterStatus(sem) !== 'complete').map(sem => (
                                 <div key={sem.id} className="flex justify-between items-center py-3 md:py-4 border-b border-white/5 last:border-0">
                                    <span className="text-[11px] md:text-[12px] font-bold text-slate-500 uppercase tracking-tighter">SMT {sem.id}</span>
                                    <span className="tech-font text-2xl md:text-3xl font-black text-white">{targetVal}</span>
                                 </div>
                               ))}
                            </div>
                         </div>
                       );
                     })}
                  </div>
               </div>
             )}
          </div>
        )}
      </main>

      <footer className="mt-auto border-t border-white/5 py-20 md:py-28 bg-slate-950 text-center px-6 relative overflow-hidden">
         <div className="absolute bottom-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-800 via-indigo-400 to-indigo-800"></div>
         <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-10 md:gap-14">
            <div className="flex items-center gap-4 md:gap-5">
               <div className="w-12 h-12 md:w-14 md:h-14 bg-indigo-600 rounded-2xl flex items-center justify-center font-black text-white text-3xl shadow-2xl">D</div>
               <div className="text-left">
                  <p className="text-slate-100 font-black tracking-widest uppercase text-base md:text-lg leading-tight">Dafid Hub Intel</p>
                  <p className="text-[9px] md:text-[10px] text-slate-600 font-bold uppercase tracking-[0.4em]">Future Intelligence Systems</p>
               </div>
            </div>
            <div className="text-slate-800 text-[10px] md:text-[11px] font-black uppercase tracking-[0.4em] md:tracking-[0.7em] tech-font">grade_os_v13.0.0_final</div>
            <div className="flex gap-6 md:gap-8">
               <a href="https://dapidhub.my.id" target="_blank" className="px-10 md:px-12 py-4 md:py-5 rounded-2xl border-2 border-indigo-500/20 text-indigo-400 hover:bg-indigo-600 hover:text-white transition-all font-black uppercase text-[10px] md:text-[11px] tracking-widest shadow-2xl">Developer Ecosystem</a>
            </div>
         </div>
         <p className="mt-16 text-[10px] md:text-[11px] text-slate-700 font-medium uppercase tracking-[0.3em]">&copy; 2025 Smart Rapor Analytics. Merancang Masa Depan.</p>
      </footer>
    </div>
  );
};

export default App;
