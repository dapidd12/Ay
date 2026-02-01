
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AppData, Semester, Subject } from './types';
import { 
  calculateSemesterAverage, 
  calculateOverallAverage, 
  saveToStorage, 
  loadFromStorage 
} from './utils';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

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
  const [showSummaryPopup, setShowSummaryPopup] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  
  const reportRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (isLoaded) saveToStorage(data);
  }, [data, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    const targetCount = Math.max(1, data.totalSemestersTarget);
    
    setData(prev => {
      const currentSems = [...prev.semesters];
      if (currentSems.length < targetCount) {
        const toAdd = targetCount - currentSems.length;
        const newSems = Array.from({ length: toAdd }, (_, i) => ({ 
          id: currentSems.length + i + 1, 
          subjects: currentSems[0]?.subjects.map(s => ({ ...s, score: 0 })) || [] 
        }));
        return { ...prev, semesters: [...currentSems, ...newSems] };
      } else if (currentSems.length > targetCount) {
        return { ...prev, semesters: currentSems.slice(0, targetCount) };
      }
      return prev;
    });
    
    if (activeSemesterId > targetCount) {
      setActiveSemesterId(1);
    }
  }, [data.totalSemestersTarget, isLoaded]);

  const activeSemester = useMemo(() => 
    data.semesters.find(s => s.id === activeSemesterId) || null,
    [data.semesters, activeSemesterId]
  );

  const getSemesterStatus = useCallback((semester: Semester) => {
    if (!semester || semester.subjects.length === 0) return 'empty';
    const scoredCount = semester.subjects.filter(s => s.score > 0).length;
    if (scoredCount === 0) return 'empty';
    if (scoredCount < semester.subjects.length) return 'partial';
    return 'complete';
  }, []);

  const completeSemesters = useMemo(() => 
    data.semesters.filter(s => getSemesterStatus(s) === 'complete'), 
  [data.semesters, getSemesterStatus]);

  const overallAvg = useMemo(() => calculateOverallAverage(completeSemesters), [completeSemesters]);
  const totalScore = useMemo(() => {
    return completeSemesters.reduce((acc, sem) => 
      acc + sem.subjects.reduce((sAcc, sub) => sAcc + sub.score, 0), 0
    );
  }, [completeSemesters]);

  const validation = useMemo(() => {
    const hasPartial = data.semesters.some(s => getSemesterStatus(s) === 'partial');
    const hasComplete = completeSemesters.length > 0;
    const isValidTarget = data.targetAvg > 0 && data.targetAvg <= 100;
    const isValidSemCount = data.totalSemestersTarget > 0;

    return { 
      hasPartial, 
      hasComplete, 
      isValidTarget, 
      isValidSemCount, 
      canCalculate: !hasPartial && hasComplete && isValidTarget && isValidSemCount 
    };
  }, [data, completeSemesters, getSemesterStatus]);

  const neededAvg = useMemo(() => {
    const remaining = data.totalSemestersTarget - completeSemesters.length;
    if (remaining <= 0) return 0;
    const targetTotalSum = data.targetAvg * data.totalSemestersTarget;
    const currentSumOfAverages = completeSemesters.reduce((acc, sem) => acc + calculateSemesterAverage(sem), 0);
    const needed = (targetTotalSum - currentSumOfAverages) / remaining;
    return Math.max(0, needed);
  }, [data.targetAvg, data.totalSemestersTarget, completeSemesters]);

  const handleAddSubject = () => {
    const newId = generateId();
    setData(prev => ({
      ...prev,
      semesters: prev.semesters.map(s => ({
        ...s,
        subjects: [...s.subjects, { id: newId, name: '', score: 0 }]
      }))
    }));
    setShowResults(false);
  };

  const handleUpdateSubject = (subId: string, field: keyof Subject, value: string | number) => {
    setData(prev => ({
      ...prev,
      semesters: prev.semesters.map(s => {
        if (field === 'name') {
          return {
            ...s,
            subjects: s.subjects.map(sub => sub.id === subId ? { ...sub, name: value as string } : sub)
          };
        }
        if (s.id === activeSemesterId) {
          return {
            ...s,
            subjects: s.subjects.map(sub => sub.id === subId ? { ...sub, [field]: value } : sub)
          };
        }
        return s;
      })
    }));
    setShowResults(false);
  };

  const handleDeleteSubject = (subId: string) => {
    setData(prev => ({
      ...prev,
      semesters: prev.semesters.map(s => ({
        ...s,
        subjects: s.subjects.filter(sub => sub.id !== subId)
      }))
    }));
    setShowResults(false);
  };

  const triggerAnalysis = () => {
    if (!validation.canCalculate) return;
    setIsCalculating(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      setIsCalculating(false);
      setShowSummaryPopup(true);
    }, 1200);
  };

  const handleExportPDF = async () => {
    if (!reportRef.current) return;
    setIsExporting(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        backgroundColor: '#030712',
        logging: false,
        useCORS: true,
        ignoreElements: (element) => element.id === 'export-button-container'
      });
      const imgData = canvas.toDataURL('image/png');
      const pdfWidth = 450;
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: [pdfWidth, pdfHeight]
      });
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Rapor_${data.userName || 'Siswa'}.pdf`);
    } catch (error) {
      console.error('Export Error:', error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen text-slate-100 selection:bg-cyan-500/30">
      
      {/* Modal Welcome */}
      {showWelcome && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/95 backdrop-blur-3xl">
          <div className="glass-card rounded-[2rem] p-6 md:p-12 w-full max-w-md text-center animate-in shadow-2xl">
            <div className="w-16 h-16 bg-gradient-to-br from-cyan-400 to-indigo-500 rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-lg">
              <span className="text-white font-black text-3xl">R</span>
            </div>
            <h2 className="text-2xl md:text-3xl font-extrabold text-white mb-2">Halo Siswa!</h2>
            <p className="text-slate-400 mb-8 text-sm md:text-base">Mari mulai merancang masa depan akademikmu.</p>
            <input 
              type="text" 
              value={data.userName}
              onChange={(e) => setData(prev => ({ ...prev, userName: e.target.value }))}
              className="w-full bg-slate-900/50 border border-white/10 rounded-xl py-4 px-6 text-center text-lg font-bold text-white outline-none focus:border-cyan-500 mb-6 transition-all"
              placeholder="Ketik Nama Kamu"
              onKeyDown={(e) => e.key === 'Enter' && data.userName && setShowWelcome(false)}
            />
            <button 
              onClick={() => data.userName && setShowWelcome(false)}
              disabled={!data.userName}
              className={`w-full py-4 rounded-xl font-bold uppercase tracking-widest transition-all ${
                data.userName ? 'bg-cyan-500 text-slate-950 shadow-xl' : 'bg-slate-800 text-slate-600'
              }`}
            >
              Lanjutkan
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 glass-card border-b border-white/5 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-16 md:h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 md:w-10 md:h-10 bg-cyan-500 rounded-lg flex items-center justify-center shadow-lg">
              <span className="text-slate-950 font-black text-lg md:text-xl">R</span>
            </div>
            <h1 className="text-lg md:text-xl font-extrabold text-white">Smart<span className="text-cyan-400">Rapor</span></h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-[9px] font-bold text-slate-500 uppercase">Siswa</p>
              <p className="text-xs md:text-sm font-bold text-white truncate max-w-[100px]">{data.userName || 'Tamu'}</p>
            </div>
            <div onClick={() => setShowWelcome(true)} className="w-8 h-8 md:w-10 md:h-10 bg-slate-800 rounded-full border border-white/10 flex items-center justify-center text-cyan-400 cursor-pointer">
              <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            </div>
          </div>
        </div>
      </header>

      {/* Konten Utama */}
      <main className="flex-grow max-w-6xl mx-auto w-full px-4 md:px-6 py-8 md:py-12">
        
        {/* Intro */}
        <section className="mb-10 md:mb-16 animate-in">
          <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-2 md:mb-4">
            Halo, <span className="text-cyan-400">{data.userName.split(' ')[0] || 'Siswa'}!</span> 👋
          </h2>
          <p className="text-slate-400 text-sm md:text-lg max-w-2xl">
            Atur target nilaimu dan lihat berapa nilai yang harus kamu kejar di semester selanjutnya.
          </p>
        </section>

        {/* Konfigurasi */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-10 md:mb-12 animate-in" style={{animationDelay: '0.1s'}}>
          <div className="glass-card rounded-2xl md:rounded-3xl p-6 md:p-8 border-l-4 md:border-l-8 border-l-cyan-500">
            <label className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Target Rata-Rata</label>
            <div className="flex items-end gap-2">
              <input 
                type="number" 
                value={data.targetAvg || ''} 
                onChange={(e) => setData(prev => ({ ...prev, targetAvg: Math.min(100, parseFloat(e.target.value) || 0) }))} 
                className="bg-transparent text-4xl md:text-6xl font-black tech-font text-cyan-400 outline-none w-full"
                placeholder="85"
              />
              <span className="text-xl font-bold text-slate-700 pb-2">%</span>
            </div>
          </div>
          <div className="glass-card rounded-2xl md:rounded-3xl p-6 md:p-8 border-l-4 md:border-l-8 border-l-indigo-500">
            <label className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Lama Studi (Semester)</label>
            <div className="flex items-end gap-2">
              <input 
                type="number" 
                value={data.totalSemestersTarget || ''} 
                onChange={(e) => setData(prev => ({ ...prev, totalSemestersTarget: Math.min(12, parseInt(e.target.value) || 0) }))} 
                className="bg-transparent text-4xl md:text-6xl font-black tech-font text-white outline-none w-full"
                placeholder="6"
              />
              <span className="text-xl font-bold text-slate-700 pb-2">SEM</span>
            </div>
          </div>
        </section>

        {/* Navigasi Semester */}
        <div className="mb-6 md:mb-8 overflow-x-auto pb-4 no-scrollbar animate-in" style={{animationDelay: '0.2s'}}>
          <div className="flex gap-3 md:gap-4 min-w-max">
            {data.semesters.map(sem => {
              const status = getSemesterStatus(sem);
              const active = activeSemesterId === sem.id;
              return (
                <button 
                  key={sem.id} 
                  onClick={() => setActiveSemesterId(sem.id)} 
                  className={`flex-shrink-0 px-5 md:px-8 py-4 md:py-6 rounded-xl md:rounded-2xl transition-all border ${
                    active 
                      ? 'bg-gradient-to-br from-cyan-500 to-indigo-600 text-slate-950 border-cyan-400 shadow-lg scale-105 z-10' 
                      : 'glass-card border-white/5 text-slate-500'
                  }`}
                >
                  <span className={`text-[8px] md:text-[10px] font-bold uppercase block mb-1 ${active ? 'text-slate-950/60' : 'text-slate-600'}`}>Semester</span>
                  <span className={`text-xl md:text-2xl font-black tech-font ${active ? 'text-slate-950' : 'text-white'}`}>{sem.id}</span>
                  {status === 'complete' && <div className="absolute -top-1 -right-1 w-4 h-4 md:w-5 md:h-5 bg-emerald-500 rounded-full border border-[#030712] flex items-center justify-center text-[10px] text-slate-950">✓</div>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Input List */}
        <section className="glass-card rounded-2xl md:rounded-[2.5rem] p-6 md:p-10 mb-10 animate-in" style={{animationDelay: '0.3s'}}>
          {activeSemester ? (
            <>
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <div>
                  <h3 className="text-xl md:text-3xl font-extrabold text-white">Semester {activeSemesterId}</h3>
                  <p className="text-[11px] md:text-xs text-slate-500 mt-1">Masukkan nilai per mata pelajaran.</p>
                </div>
                {activeSemesterId === 1 && (
                  <button onClick={handleAddSubject} className="w-full md:w-auto px-6 py-3 bg-cyan-500 text-slate-950 rounded-xl font-bold flex items-center justify-center gap-2 text-xs uppercase tracking-widest transition-all hover:scale-105 active:scale-95 shadow-lg">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4" /></svg>
                    Tambah Mapel
                  </button>
                )}
              </div>

              <div className="space-y-3">
                {activeSemester.subjects.length === 0 ? (
                  <div className="py-12 text-center border-2 border-dashed border-white/5 rounded-2xl bg-white/5 text-slate-600 text-xs font-bold uppercase tracking-widest">
                    Belum ada mata pelajaran
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {activeSemester.subjects.map((sub, i) => (
                      <div key={sub.id} className="flex items-center gap-3 bg-slate-900/40 p-3 md:p-4 rounded-xl border border-white/5">
                        <span className="text-[10px] tech-font text-slate-700 font-black w-6">{(i + 1).toString().padStart(2, '0')}</span>
                        <input 
                          type="text" 
                          value={sub.name} 
                          readOnly={activeSemesterId !== 1} 
                          onChange={(e) => handleUpdateSubject(sub.id, 'name', e.target.value)} 
                          className={`flex-grow bg-transparent text-white font-bold text-sm md:text-base outline-none truncate ${activeSemesterId !== 1 ? 'opacity-50' : 'focus:text-cyan-400'}`} 
                          placeholder="Nama Mapel"
                        />
                        <div className="flex items-center gap-2">
                          <input 
                            type="number" 
                            value={sub.score || ''} 
                            onChange={(e) => handleUpdateSubject(sub.id, 'score', Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))} 
                            className="w-14 md:w-20 bg-slate-950 border border-white/10 rounded-lg py-2 text-center text-cyan-400 font-bold tech-font text-base md:text-xl outline-none" 
                            placeholder="0"
                          />
                          {activeSemesterId === 1 && (
                            <button onClick={() => handleDeleteSubject(sub.id)} className="p-1 text-slate-700 hover:text-rose-500">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : <div className="py-12 text-center text-slate-700 font-bold">Pilih Semester</div>}
        </section>

        {/* Button Action */}
        <div className="max-w-xl mx-auto text-center px-4 mb-16 animate-in" style={{animationDelay: '0.4s'}}>
          <button 
            disabled={!validation.canCalculate || isCalculating} 
            onClick={triggerAnalysis} 
            className={`w-full py-5 md:py-7 rounded-2xl font-black text-sm md:text-lg uppercase tracking-[0.3em] transition-all shadow-2xl ${
              validation.canCalculate && !isCalculating 
                ? 'bg-gradient-to-r from-cyan-500 to-indigo-500 text-slate-950 hover:brightness-110 active:scale-95' 
                : 'bg-slate-900 text-slate-700 border border-white/5 opacity-50 cursor-not-allowed'
            }`}
          >
            {isCalculating ? 'Menganalisis...' : 'Hitung Hasil'}
          </button>
          {!validation.canCalculate && (
            <p className="mt-4 text-[9px] md:text-[10px] text-amber-500 font-bold uppercase tracking-widest opacity-60">
              Lengkapi data di setiap semester untuk memulai analisis
            </p>
          )}
        </div>

        {/* Modal Hasil */}
        {showSummaryPopup && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/98 backdrop-blur-3xl overflow-y-auto">
            <div className="glass-card rounded-[2rem] md:rounded-[3rem] p-8 md:p-12 w-full max-w-lg text-center animate-in relative my-auto">
              <button onClick={() => setShowSummaryPopup(false)} className="absolute top-6 right-6 text-slate-600 hover:text-white"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg></button>
              <h2 className="text-2xl md:text-4xl font-black mb-6 uppercase text-white">{data.userName || 'Siswa'}</h2>
              <div className="bg-slate-950 p-8 md:p-10 rounded-[2rem] border border-white/5 mb-8">
                <span className="text-slate-500 text-[10px] font-bold block mb-2 uppercase tracking-widest">Rata-Rata Kamu</span>
                <div className="text-6xl md:text-8xl font-black text-white tech-font">{overallAvg.toFixed(1)}</div>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-white/5 p-4 rounded-2xl border border-white/5"><span className="text-[9px] text-slate-600 uppercase block mb-1">Total Poin</span><span className="text-xl md:text-2xl font-black text-cyan-400 tech-font">{totalScore}</span></div>
                <div className="bg-white/5 p-4 rounded-2xl border border-white/5"><span className="text-[9px] text-slate-600 uppercase block mb-1">Semester</span><span className="text-xl md:text-2xl font-black text-slate-200 tech-font">{completeSemesters.length}</span></div>
              </div>
              <button onClick={() => { setShowSummaryPopup(false); setShowResults(true); }} className="w-full py-5 bg-white text-slate-950 rounded-xl font-black uppercase text-xs tracking-widest shadow-xl">Prediksi Lengkap</button>
            </div>
          </div>
        )}

        {/* Detail Laporan */}
        {showResults && (
          <div ref={reportRef} className="mt-20 md:mt-32 space-y-16 md:space-y-24 animate-in pb-32">
            <div className="text-center relative py-6">
               <div className="absolute top-1/2 left-0 w-full h-px bg-white/5 -z-10"></div>
               <h2 className="text-xl md:text-3xl font-black text-white uppercase px-6 md:px-10 bg-[#030712] inline-block tracking-tighter">Analisis <span className="text-cyan-400">Strategis</span></h2>
            </div>

            <div id="export-button-container" className="flex justify-center pb-8">
              <button onClick={handleExportPDF} disabled={isExporting} className="flex items-center gap-3 bg-slate-900 border border-white/10 px-6 py-3 rounded-xl hover:bg-cyan-500/10 transition-all text-cyan-400 font-bold uppercase text-[10px] tracking-widest">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                {isExporting ? 'Proses...' : 'Simpan PDF'}
              </button>
            </div>

            {/* Cards Per Semester */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
              {data.semesters.map(sem => {
                const status = getSemesterStatus(sem);
                const avg = calculateSemesterAverage(sem);
                return (
                  <div key={sem.id} className="glass-card rounded-[2rem] p-6 md:p-8 border border-white/5">
                    <div className="flex justify-between items-center mb-6">
                      <span className="text-[10px] text-slate-600 font-black uppercase tracking-widest">SMT {sem.id}</span>
                      {status === 'complete' && <span className="text-cyan-400 font-black tech-font text-xl md:text-2xl">{avg.toFixed(1)}</span>}
                    </div>
                    <div className="space-y-2">
                      {status === 'empty' ? <p className="text-[9px] text-slate-800 font-black uppercase text-center py-4 italic">Belum ada data</p> : sem.subjects.map(s => (
                        <div key={s.id} className="flex justify-between text-[10px] text-slate-400 uppercase font-bold">
                          <span className="truncate pr-2">{s.name || 'Mapel'}</span>
                          <span className="text-white shrink-0">{s.score}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Prediksi Panel */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
              <div className="glass-card rounded-[2.5rem] p-10 text-center border-t-4 border-cyan-500 bg-[#0a0f1d] lg:col-span-1">
                <h4 className="text-slate-600 text-[10px] uppercase tracking-widest mb-6 font-black">Rerata Sekarang</h4>
                <div className="text-6xl md:text-7xl font-black text-white tech-font leading-none mb-4">{overallAvg.toFixed(1)}</div>
                <div className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">{totalScore} Poin Terkumpul</div>
              </div>
              <div className="glass-card rounded-[2.5rem] p-8 md:p-12 flex flex-col justify-center border border-white/5 bg-slate-950/80 lg:col-span-2">
                <h4 className="text-slate-600 text-[10px] uppercase tracking-widest mb-8 font-black">Target Masa Depan</h4>
                <div className="flex flex-col md:flex-row items-center gap-8 md:gap-12">
                  <div className="text-center md:text-left bg-cyan-500/10 p-8 rounded-[2rem] border border-cyan-500/20 shrink-0">
                    <div className="text-6xl md:text-7xl font-black text-cyan-400 tech-font leading-none">{neededAvg.toFixed(1)}</div>
                    <p className="text-[9px] text-cyan-500/60 mt-2 uppercase font-black tracking-widest">Minimal Rata-Rata Sisa</p>
                  </div>
                  <div className="text-center md:text-left">
                    <p className="text-sm md:text-lg text-slate-300 italic leading-relaxed border-l-2 md:border-l-4 border-cyan-500/30 pl-6 md:pl-8">
                      "Kamu butuh rata-rata minimal <b className="text-white">{neededAvg.toFixed(1)}</b> di semester sisa untuk mencapai target <b className="text-cyan-400">{data.targetAvg}%</b>."
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-20 border-t border-white/5 py-12 md:py-16 bg-slate-950 text-center px-4">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-cyan-500 rounded-lg flex items-center justify-center font-black text-slate-950 shadow-md">D</div>
            <p className="text-white font-extrabold tracking-widest uppercase text-sm">Dafid</p>
          </div>
          <p className="text-slate-700 text-[9px] md:text-[10px] uppercase tracking-[0.3em] font-black">Smart Rapor Academic Analytics v9.2.0</p>
          <a href="https://dapidhub.my.id" target="_blank" rel="noopener noreferrer" className="text-cyan-500 hover:text-white transition-colors text-[10px] font-black uppercase tracking-widest">dapidhub.my.id</a>
        </div>
      </footer>

    </div>
  );
};

export default App;
