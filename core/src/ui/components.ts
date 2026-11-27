import type { Route, Stop, StopBoard, TransportKind, Vehicle } from '../transport/types';
import { KIND_COLOR, KIND_EMOJI, KIND_LABEL, KIND_LABEL_PLURAL } from '../transport/types';
import { formatDistance, formatEta } from '../transport/geo';
import { h, clear } from './dom';

export function kindDot(kind: TransportKind): HTMLElement {
  return h('span', { class: 'kind-dot', style: { background: KIND_COLOR[kind] } });
}

export function routeTile(route: Route, active: boolean, onClick: () => void): HTMLElement {
  const ends = [route.from, route.to].filter(Boolean).join(' → ');
  return h(
    'button',
    { class: `route-tile${active ? ' route-tile--active' : ''}`, type: 'button', onClick },
    h('span', { class: 'route-tile__num' }, route.number),
    h('span', { class: 'route-tile__kind' }, kindDot(route.kind), KIND_LABEL[route.kind]),
    ends ? h('span', { class: 'route-tile__ends' }, ends) : null,
  );
}

export function kindChips(active: TransportKind | 'all', counts: Partial<Record<TransportKind, number>>, onPick: (k: TransportKind | 'all') => void): HTMLElement {
  const chips: HTMLElement[] = [];
  const all: TransportKind[] = ['bus', 'trolley', 'tram', 'minibus', 'electro'];
  const total = all.reduce((s, k) => s + (counts[k] ?? 0), 0);
  chips.push(
    h('button', { class: `chip${active === 'all' ? ' chip--active' : ''}`, type: 'button', onClick: () => onPick('all') }, `Все · ${total}`),
  );
  for (const k of all) {
    const n = counts[k] ?? 0;
    if (!n) continue;
    chips.push(
      h(
        'button',
        { class: `chip${active === k ? ' chip--active' : ''}`, type: 'button', onClick: () => onPick(k) },
        h('span', { class: 'kind-dot', style: { background: KIND_COLOR[k] } }),
        `${KIND_LABEL_PLURAL[k]} · ${n}`,
      ),
    );
  }
  return h('div', { class: 'chip-row' }, ...chips);
}

export function vehicleRow(v: Vehicle, onClick: () => void): HTMLElement {
  const eta = v.upcoming?.find((a) => a.minutes !== undefined);
  const left = eta
    ? h('div', {}, h('div', { class: 'row__value' }, formatEta(eta.minutes ?? 0)), h('div', { class: 'row__sub' }, eta.stop ?? ''))
    : h('div', { class: 'row__value' }, v.speedKmh !== undefined ? `${v.speedKmh} км/ч` : '—');
  return h(
    'button',
    { class: 'row', type: 'button', onClick },
    h(
      'div',
      { class: 'route-tile__num', style: { minWidth: '44px', color: KIND_COLOR[v.kind] } },
      v.routeNumber,
    ),
    h(
      'div',
      { class: 'row__grow' },
      h('div', { class: 'row__title' }, v.label ? `${v.label}` : 'Машина'),
      h(
        'div',
        { class: 'row__sub' },
        [v.status ? v.status : null, v.speedKmh !== undefined ? `${v.speedKmh} км/ч` : null, ageText(v.updatedAt)]
          .filter(Boolean)
          .join(' · ') || 'на линии',
      ),
    ),
    left,
  );
}

export function ageText(ts?: number): string | null {
  if (!ts) return null;
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return 'только что';
  if (s < 3600) return `${Math.round(s / 60)} мин назад`;
  return `${(s / 3600).toFixed(1)} ч назад`;
}

export function emptyState(icon: string, title: string, hint?: string): HTMLElement {
  return h(
    'div',
    { class: 'empty' },
    h('div', { class: 'empty__icon' }, icon),
    h('div', { style: { fontWeight: '700', color: 'var(--text)' } }, title),
    hint ? h('div', { style: { marginTop: '6px' } }, hint) : null,
  );
}

export function stopRow(stop: Stop, onClick: () => void): HTMLElement {
  return h(
    'button',
    { class: 'row', type: 'button', onClick },
    h('div', { class: 'row__grow' }, h('div', { class: 'row__title' }, stop.name), stop.routes?.length ? h('div', { class: 'row__sub' }, stop.routes.slice(0, 8).join(' · ')) : null),
    h('div', { class: 'row__value' }, 'табло →'),
  );
}

export function stopBoardView(board: StopBoard): HTMLElement {
  if (!board.entries.length) {
    return emptyState('🕓', 'Пока нет прогнозов', 'Источник не отдал табло для этой остановки');
  }
  return h(
    'div',
    { class: 'list' },
    ...board.entries.map((e) =>
      h(
        'div',
        { class: 'eta-line' },
        h('div', { class: 'eta-line__num', style: { color: KIND_COLOR[e.kind] } }, e.routeNumber),
        h('div', { class: 'eta-line__stop' }, KIND_LABEL[e.kind]),
        h('div', { class: 'eta-line__time' }, formatEta(e.minutes)),
      ),
    ),
  );
}

export function vehicleDetails(v: Vehicle): HTMLElement {
  const upcoming = v.upcoming ?? [];
  return h(
    'div',
    {},
    h(
      'div',
      { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
      h('div', { class: 'route-tile__num', style: { color: KIND_COLOR[v.kind], fontSize: '30px' } }, v.routeNumber),
      h(
        'div',
        { class: 'row__grow' },
        h('div', { class: 'row__title' }, `${KIND_LABEL[v.kind]}${v.label ? ` · ${v.label}` : ''}`),
        h('div', { class: 'row__sub' }, [v.status, v.speedKmh !== undefined ? `${v.speedKmh} км/ч` : null, ageText(v.updatedAt)].filter(Boolean).join(' · ') || 'на линии'),
      ),
      v.approx ? h('span', { class: 'badge badge--demo' }, '≈ позиция') : null,
    ),
    upcoming.length
      ? h(
          'div',
          { style: { marginTop: '8px' } },
          h('div', { class: 'section-title', style: { padding: '10px 2px 2px' } }, 'Ближайшие остановки'),
          ...upcoming.map((a) =>
            h(
              'div',
              { class: 'eta-line' },
              h('div', { class: 'eta-line__stop' }, a.stop),
              h('div', { class: 'eta-line__time' }, a.meters !== undefined && a.minutes === undefined ? formatDistance(a.meters) : formatEta(a.minutes ?? 0)),
            ),
          ),
        )
      : null,
  );
}

export function badge(text: string, kind: 'live' | 'demo' | 'error' | 'muted' = 'muted'): HTMLElement {
  const cls = kind === 'muted' ? 'badge' : `badge badge--${kind}`;
  return h('span', { class: cls }, text);
}

export function demoBanner(onClose?: () => void): HTMLElement {
  return h(
    'div',
    { class: 'card', style: { display: 'flex', gap: '10px', alignItems: 'flex-start', borderColor: 'color-mix(in srgb, var(--warn) 40%, transparent)' } },
    h('div', { style: { fontSize: '20px' } }, '🧪'),
    h(
      'div',
      { class: 'row__grow' },
      h('div', { class: 'row__title' }, 'Демо-режим'),
      h('div', { class: 'card__hint' }, 'Автобусы двигаются по симуляции, интернет не нужен. Переключите на живые данные в «Настройках».'),
    ),
    onClose ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Скрыть', onClick: onClose }, '✕') : null,
  );
}

export { clear };
