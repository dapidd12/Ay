
export interface Subject {
  id: string;
  name: string;
  score: number;
}

export interface Semester {
  id: number;
  subjects: Subject[];
}

export interface AppData {
  userName: string;
  semesters: Semester[];
  targetAvg: number;
  totalSemestersTarget: number;
}

export enum StatusColor {
  SAFE = 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10',
  WARNING = 'text-amber-400 border-amber-400/30 bg-amber-400/10',
  DANGER = 'text-rose-400 border-rose-400/30 bg-rose-400/10'
}
