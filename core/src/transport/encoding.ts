/**
 * Декодирование cp1251 → utf-8 для WAP-страниц Новосибирска.
 * Работает и в браузере, и в WebView (TextDecoder поддерживается обоими).
 */

export function isMojibake(s: string): boolean {
  // «ÐžÑ„Ð¸Ñ†Ð¸Ð°Ð»ÑŒÐ½Ñ‹Ð¹» — типичный признак utf-8, прочитанного как cp1251
  return /[ÐÑ][\u0080-\u00BF\u2018-\u203A]/.test(s);
}

let cachedTable: string | null = null;

function buildTable(): string {
  // Верхняя половина cp1251 (0x80..0xFF) в порядке кодов
  const upper =
    'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—\u0098™љ›њќћџ\u00A0ЎўЈ¤Ґ¦§Ё©Є«¬\u00AD®Ї°±Ііґµ¶·ё№є»јЅѕї' +
    'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя';
  let t = '';
  for (let i = 0; i < 128; i++) t += String.fromCharCode(i);
  return t + upper;
}

function decodeCp1251Manual(text: string): string {
  if (!cachedTable) cachedTable = buildTable();
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) out += text[i];
    else if (code >= 0x400 && code <= 0x45f) out += text[i]; // уже кириллица
    else if (code >= 128 && code <= 255) out += cachedTable[code];
    else out += text[i];
  }
  return out;
}

/** Перекодировать строку, если она похожа на cp1251-байты, прочитанные как latin1. */
export function decodeCp1251(text: string): string {
  if (!text) return text;
  if (/[А-Яа-яЁё]/.test(text) && !isMojibake(text)) return text;
  if (!/[^\x00-\x7F]/.test(text)) return text;
  return decodeCp1251Manual(text);
}
