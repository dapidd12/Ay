
import { AppData, Semester } from './types';

export const calculateSemesterAverage = (semester: Semester): number => {
  if (!semester || semester.subjects.length === 0) return 0;
  const sum = semester.subjects.reduce((acc, sub) => acc + sub.score, 0);
  return sum / semester.subjects.length;
};

export const calculateOverallAverage = (semesters: Semester[]): number => {
  if (semesters.length === 0) return 0;
  const sumOfAverages = semesters.reduce((acc, sem) => acc + calculateSemesterAverage(sem), 0);
  return sumOfAverages / semesters.length;
};

export const STORAGE_KEY = 'smart_rapor_optimized_v1';

export const saveToStorage = (data: AppData) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

export const loadFromStorage = (): AppData | null => {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return null;
  try {
    const parsed = JSON.parse(data);
    return {
      userName: parsed.userName || '',
      semesters: parsed.semesters || [],
      targetAvg: parsed.targetAvg || 85,
      totalSemestersTarget: parsed.totalSemestersTarget || 6
    };
  } catch (e) {
    return null;
  }
};
