/**
 * Платформенно-независимый HTTP-слой.
 * В вебе используется fetch, в Android — нативная реализация (передаётся через setHttpImpl).
 */

export interface HttpRequest {
  url: string;
  method?: 'GET' | 'POST';
  /** Прокси-префикс, например https://cors.example/?url= */
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  /** Текст ответа */
  text: string;
  /** Заголовки в нижнем регистре */
  headers: Record<string, string>;
}

export type HttpImpl = (req: HttpRequest) => Promise<HttpResponse>;

let impl: HttpImpl = fetchImpl;

async function fetchImpl(req: HttpRequest): Promise<HttpResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 15000);
  try {
    const res = await fetch(req.url, {
      method: req.method ?? 'GET',
      headers: { Accept: 'application/json, text/plain, */*', ...(req.headers ?? {}) },
      signal: ctrl.signal,
      // @ts-ignore — некоторые источники отдают данные без CORS; в нативном APK это не важно
      mode: 'cors',
      cache: 'no-store',
    });
    const text = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    return { status: res.status, text, headers };
  } finally {
    clearTimeout(timer);
  }
}

export function setHttpImpl(next: HttpImpl): void {
  impl = next;
}

export async function httpGet(url: string, opts: Partial<HttpRequest> = {}): Promise<HttpResponse> {
  return impl({ ...opts, url, method: 'GET' });
}

/** Прокси включается пользователем в настройках (веб-версия). Формат: {url} — куда подставить адрес. */
export interface ProxyConfig {
  enabled: boolean;
  /** Шаблон, например «https://proxy.example/?url={url}» или просто префикс */
  template: string;
}

export const DEFAULT_PROXY: ProxyConfig = {
  enabled: false,
  template: 'https://api.allorigins.win/raw?url={url}',
};

let proxy: ProxyConfig = DEFAULT_PROXY;

export function setProxy(next: ProxyConfig): void {
  proxy = next;
}

export function getProxy(): ProxyConfig {
  return proxy;
}

export function withProxy(url: string): string {
  if (!proxy.enabled || !proxy.template) return url;
  const enc = encodeURIComponent(url);
  if (proxy.template.includes('{url}')) return proxy.template.replace('{url}', enc);
  return proxy.template + enc;
}
