/** Минимальный слой работы с DOM без фреймворков: h(), фрагменты, события. */

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

export function h(tag: string, attrs?: Attrs | null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class' || key === 'className') el.className = String(value);
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value as object);
      else if (key === 'dataset' && typeof value === 'object') {
        for (const [dk, dv] of Object.entries(value as Record<string, string>)) el.dataset[dk] = dv;
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (key === 'html') {
        el.innerHTML = String(value);
      } else if (key === 'text') {
        el.textContent = String(value);
      } else if (key in el && key !== 'list' && typeof value !== 'string') {
        (el as unknown as Record<string, unknown>)[key] = value;
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function iconButton(label: string, onClick: () => void, extraClass = ''): HTMLElement {
  return h('button', { class: `icon-btn ${extraClass}`, type: 'button', title: label, 'aria-label': label, onClick }, label);
}

export function el(tag: string): HTMLElement {
  return document.createElement(tag);
}

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function safeLocalGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeLocalSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* приватный режим */
  }
}

export function throttle<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: never[]) => {
    const now = Date.now();
    const wait = ms - (now - last);
    if (wait <= 0) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...args);
      }, wait);
    }
  }) as T;
}
