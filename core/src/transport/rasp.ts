import type { Arrival } from './types';
import { hhmmToMinutes, minutesUntil } from './provider';

/**
 * Поле `rasp` Новосибирска: прогнозы по ближайшим остановкам.
 * Формат: «11:41+М. _"Речной вокзал"_|11:50+Дом Ленина|» либо статус «Обеденный+перерыв|».
 */
export function arrivalsFromRasp(rasp: string, nowMinutes: number): Arrival[] {
  if (!rasp) return [];
  const chunks = rasp.split('|');
  const out: Arrival[] = [];
  for (const raw of chunks) {
    const chunk = raw.trim();
    if (!chunk) continue;
    const timeMatch = /^(\d{1,2}:\d{2})\s*\+(.*)$/.exec(chunk);
    if (!timeMatch) continue;
    const [, time, rawStop] = timeMatch;
    const stop = rawStop.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    if (!stop) continue;
    const target = hhmmToMinutes(time);
    const minutes = target === undefined ? undefined : Math.max(0, minutesUntil(nowMinutes, target));
    out.push({ stop, time, minutes });
  }
  return out;
}

/** Строка статуса из rasp, если это не прогноз: «Обеденный перерыв», «Отстой», «-» */
export function statusFromRasp(rasp: string): string | undefined {
  const first = (rasp ?? '').split('|')[0]?.trim();
  if (!first) return undefined;
  if (/^\d{1,2}:\d{2}\+/.test(first)) return undefined;
  if (first === '-') return undefined;
  return first.replace(/\+/g, ' ');
}
