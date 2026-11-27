import type { TransitProvider } from '../transport/provider';
import { createProvider, resetDemo } from '../transport';
import { setProxy } from '../transport/http';
import type { CityId, DataMode, Route, Stop, StopBoard, TransportKind, Vehicle } from '../transport/types';
import { CITIES, KIND_LABEL } from '../transport/types';
import { demoLineFor } from '../data/demo-lines';
import { BusMap } from './map';
import { Store, type SelectionState } from './store';
import { h, clear, throttle, isIos, safeLocalGet, safeLocalSet } from './dom';
import { alertDialog } from './dialogs';
import {
  badge,
  demoBanner,
  emptyState,
  kindChips,
  routeTile,
  stopBoardView,
  stopRow,
  vehicleDetails,
  vehicleRow,
} from './components';

type Tab = 'map' | 'routes' | 'stops' | 'settings';

interface RecentRoute {
  key: string;
  city: CityId;
  number: string;
}

export interface AppOptions {
  /** Подпись версии в настройках */
  version?: string;
  /** Дополнительные пункты в настройках (например, «Скачать APK») */
  extraSettings?: (app: BusApp) => HTMLElement[];
  /** Платформа: web | android (влияет на подсказки) */
  platform?: 'web' | 'android';
}

export class BusApp {
  readonly store = new Store();
  private provider!: TransitProvider;
  private routes: Route[] = [];
  private selected: SelectionState = { route: null, kindFilter: 'all', query: '', vehicles: [], selectedVehicleId: null, status: 'idle', stop: null };
  private tab: Tab = 'map';
  private map!: BusMap;
  private pollTimer: number | null = null;
  private board: StopBoard | null = null;
  private overview: Vehicle[] = [];
  /** Панель свёрнута до заголовка — больше карты */
  private collapsed = true;
  private busesStops: Stop[] = [];
  private refs: {
    root: HTMLElement;
    mapHost: HTMLElement;
    topbar: HTMLElement;
    sheet: HTMLElement;
    tabbar: HTMLElement;
    fab: HTMLElement;
  } | null = null;
  private toastEl: HTMLElement | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private opts: AppOptions = {}) {}

  mount(root: HTMLElement): void {
    this.applyTheme();
    root.innerHTML = '';
    const mapHost = h('div', { class: 'app__map', id: 'map' });
    const topbar = h('div', { class: 'topbar' });
    const sheet = h('section', { class: 'sheet', 'aria-live': 'polite' });
    const fab = h('button', { class: 'fab fab--locate', type: 'button', title: 'Моё местоположение', 'aria-label': 'Моё местоположение' }, '🎯');
    const tabbar = h('nav', { class: 'tabbar' });
    const app = h('div', { class: 'app' }, mapHost, h('div', { class: 'app__scrim' }), topbar, fab, sheet, tabbar);
    root.append(app);
    this.refs = { root: app, mapHost, topbar, sheet, tabbar, fab };
    this.map = new BusMap(mapHost, {
      city: this.store.get().city,
      onVehicleClick: (v) => this.selectVehicle(v.id, true),
    });
    fab.addEventListener('click', () => this.locateMe());
    this.rebuildProvider();
    void this.loadRoutes();
    this.renderTopbar();
    this.renderTabbar();
    this.renderSheet();
    void this.loadRoutes().then(() => this.loadOverview());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stopPolling();
      else this.startPolling();
    });
  }

  // ---------- провайдер и данные ----------

  private rebuildProvider(): void {
    const s = this.store.get();
    setProxy({ enabled: s.proxyEnabled, template: s.proxyTemplate });
    this.provider = createProvider(s.city, s.mode);
    this.map.setCity(s.city);
  }

  private async loadRoutes(): Promise<void> {
    try {
      this.routes = await this.provider.routes();
    } catch (e) {
      this.routes = [];
      this.toast(`Не удалось загрузить маршруты: ${(e as Error).message}`);
    }
    this.renderSheet();
  }

  getRoutes(): Route[] {
    return this.routes;
  }

  getSelected(): SelectionState {
    return this.selected;
  }

  selectRoute(route: Route): void {
    this.tab = 'map';
    this.collapsed = false;
    this.renderTabbar();
    this.selected = { ...this.selected, route, vehicles: [], selectedVehicleId: null, status: 'loading', stop: null };
    this.store.pushRecent(route.id);
    this.board = null;
    this.renderSheet();
    void this.drawRouteLine(route);
    void this.refresh(true);
    this.startPolling();
  }

  private async drawRouteLine(route: Route): Promise<void> {
    // Живой источник может отдать реальную геометрию по улицам.
    if (this.provider.trace && this.provider.mode === 'live') {
      try {
        const trace = await this.provider.trace(route);
        if (trace.points.length > 1) {
          this.map.setRouteLine(trace.points);
          if (trace.stops.length) this.busesStops = trace.stops;
          return;
        }
      } catch {
        /* источник не отдал трассу — рисуем демо-схему */
      }
    }
    const cityLines = demoLineFor(route.city, route.number, route.kind);
    if (!cityLines) return;
    this.map.setRouteLine(cityLines.points);
  }

  selectVehicle(id: string | null, fromMap = false): void {
    if (id) this.collapsed = false;
    this.selected = { ...this.selected, selectedVehicleId: id };
    this.map.selectVehicle(id);
    const v = this.selected.vehicles.find((x) => x.id === id);
    if (v && this.store.get().followVehicle) this.map.follow(v.lat, v.lon, 15);
    if (fromMap) this.renderSheet();
  }

  async refresh(force = false): Promise<void> {
    const route = this.selected.route;
    if (!route) {
      // без выбранного маршрута на карте покажем все машины города, что умеет источник
      this.renderSheet();
      return;
    }
    try {
      if (force) this.selected = { ...this.selected, status: 'loading' };
      const vehicles = await this.provider.vehicles(route);
      this.selected = {
        ...this.selected,
        vehicles,
        status: vehicles.length ? 'ok' : 'empty',
        lastUpdate: Date.now(),
        error: undefined,
      };
      this.map.setVehicles(vehicles, this.selected.selectedVehicleId);
      if (vehicles.length) {
        const sel = vehicles.find((v) => v.id === this.selected.selectedVehicleId) ?? null;
        if (sel && this.store.get().followVehicle) this.map.follow(sel.lat, sel.lon, 15);
      }
    } catch (e) {
      this.selected = { ...this.selected, status: 'error', error: (e as Error).message };
    }
    this.renderSheet();
  }

  /** «Вся карта»: машины всех демо-маршрутов города (или подсказка для живого источника). */
  private async loadOverview(): Promise<void> {
    if (this.provider.mode !== 'demo') {
      this.overview = [];
      return;
    }
    try {
      const all: Vehicle[] = [];
      for (const route of this.routes.slice(0, 8)) {
        try {
          all.push(...(await this.provider.vehicles(route)));
        } catch {
          /* маршрут мог не отдать данные */
        }
      }
      this.overview = all;
      if (!this.selected.route) {
        this.map.setVehicles(all, this.selected.selectedVehicleId);
        this.renderSheet();
      }
    } catch {
      /* обзор необязателен */
    }
  }

  private startPolling(): void {
    this.stopPolling();
    const ms = this.provider.mode === 'demo' ? 1500 : 12_000;
    this.pollTimer = window.setInterval(() => {
      void this.refresh();
      if (!this.selected.route) void this.loadOverview();
    }, ms);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Установить город из ссылки (?city=krsk) до монтирования. */
  setCityFromUrl(city: CityId): void {
    if (city === this.store.get().city) return;
    this.store.set({ city });
  }

  // ---------- топбар ----------

  private renderTopbar(): void {
    if (!this.refs) return;
    const s = this.store.get();
    const cfg = CITIES[s.city];
    const search = h('input', {
      class: 'searchbar__input',
      type: 'search',
      placeholder: 'Маршрут / остановка',
      value: this.selected.query,
      onInput: (e: Event) => {
        this.selected = { ...this.selected, query: (e.target as HTMLInputElement).value };
        this.renderSheet();
      },
    });
    clear(this.refs.topbar);
    this.refs.topbar.append(
      h(
        'div',
        { class: 'searchbar' },
        h(
          'button',
          {
            class: 'searchbar__city',
            type: 'button',
            title: 'Сменить город',
            onClick: () => this.switchCity(),
          },
          h('span', { class: 'searchbar__city-icon' }, '📍'),
          cfg.title,
          h('span', { style: { color: 'var(--muted-2)', fontSize: '11px' } }, '▾'),
        ),
        h('div', { class: 'searchbar__main' }, h('span', { class: 'searchbar__icon' }, '🔎'), search),
        s.mode === 'demo' ? badge('демо', 'demo') : badge('онлайн', 'live'),
      ),
    );
  }

  private switchCity(): void {
    const s = this.store.get();
    const next: CityId = s.city === 'nsk' ? 'krsk' : 'nsk';
    this.store.set({ city: next });
    this.selected = { route: null, kindFilter: 'all', query: '', vehicles: [], selectedVehicleId: null, status: 'idle', stop: null };
    this.board = null;
    this.map.clearAll();
    this.overview = [];
    this.rebuildProvider();
    this.renderTopbar();
    this.renderSheet();
    void this.loadRoutes().then(() => this.loadOverview());
    this.toast(`Город: ${CITIES[next].title}`);
  }

  // ---------- нижняя панель ----------

  private renderTabbar(): void {
    if (!this.refs) return;
    const tabs: { id: Tab; icon: string; label: string }[] = [
      { id: 'map', icon: '🗺️', label: 'Карта' },
      { id: 'routes', icon: '🚌', label: 'Маршруты' },
      { id: 'stops', icon: '🕓', label: 'Остановки' },
      { id: 'settings', icon: '⚙️', label: 'Настройки' },
    ];
    clear(this.refs.tabbar);
    this.refs.tabbar.append(
      ...tabs.map((t) =>
        h(
          'button',
          {
            class: `tabbar__btn${this.tab === t.id ? ' tabbar__btn--active' : ''}`,
            type: 'button',
            onClick: () => {
              this.tab = t.id;
              if (t.id === 'map') this.collapsed = true;
              this.renderTabbar();
              this.renderSheet();
            },
          },
          h('span', { class: 'tabbar__icon' }, t.icon),
          t.label,
        ),
      ),
    );
  }

  renderSheet(): void {
    if (!this.refs) return;
    clear(this.refs.sheet);
    this.refs.sheet.classList.toggle('sheet--collapsed', this.collapsed && this.tab === 'map');
    this.refs.sheet.append(h('div', { class: 'sheet__grip' }));
    switch (this.tab) {
      case 'map':
        this.refs.sheet.append(...this.renderMapPanel());
        break;
      case 'routes':
        this.refs.sheet.append(...this.renderRoutesPanel());
        break;
      case 'stops':
        this.refs.sheet.append(...this.renderStopsPanel());
        break;
      case 'settings':
        this.refs.sheet.append(...this.renderSettingsPanel());
        break;
    }
  }

  private toggleSheet(): void {
    this.collapsed = !this.collapsed;
    this.renderSheet();
  }

  private collapseButton(): HTMLElement {
    return h(
      'button',
      {
        class: 'icon-btn',
        type: 'button',
        'aria-label': this.collapsed ? 'Развернуть панель' : 'Свернуть панель',
        title: this.collapsed ? 'Развернуть' : 'Свернуть',
        onClick: () => this.toggleSheet(),
      },
      this.collapsed ? '⌃' : '⌄',
    );
  }

  private renderMapPanel(): HTMLElement[] {
    const parts: HTMLElement[] = [];
    const selVehicle = this.selected.vehicles.find((v) => v.id === this.selected.selectedVehicleId);
    if (selVehicle) {
      parts.push(
        h(
          'div',
          { class: 'sheet__head' },
          h('div', { class: 'row__grow' }, h('h2', { class: 'sheet__title' }, `Маршрут ${selVehicle.routeNumber}`), h('div', { class: 'sheet__sub' }, KIND_LABEL[selVehicle.kind])),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Закрыть', onClick: () => this.selectVehicle(null) }, '✕'),
          this.collapseButton(),
        ),
      );
      parts.push(h('div', { class: 'sheet__body' }, vehicleDetails(selVehicle)));
      return parts;
    }
    if (this.board) {
      parts.push(...this.renderBoardPanel());
      return parts;
    }
    if (this.selected.route) {
      const route = this.selected.route;
      const fav = this.store.get().favorites.includes(route.id);
      parts.push(
        h(
          'div',
          { class: 'sheet__head' },
          h(
            'div',
            { class: 'row__grow' },
            h('h2', { class: 'sheet__title' }, `${KIND_LABEL[route.kind]} ${route.number}`),
            h('div', { class: 'sheet__sub' }, [route.from, route.to].filter(Boolean).join(' → ') || 'Маршрут'),
          ),
          h(
            'button',
            { class: `icon-btn`, type: 'button', title: 'В избранное', 'aria-label': 'В избранное', onClick: () => {
              this.store.toggleFavorite(route.id);
              this.renderSheet();
            } },
            fav ? '★' : '☆',
          ),
        ),
      );
      parts.push(h('div', { class: 'sheet__body' }, ...this.renderVehiclesOfRoute()));
      return parts;
    }
    // стартовый экран
    const s = this.store.get();
    const cfg = CITIES[s.city];
    parts.push(
      h(
        'div',
        { class: 'sheet__head', onClick: () => this.toggleSheet() },
        h('div', { class: 'row__grow' }, h('h2', { class: 'sheet__title' }, `Транспорт · ${cfg.title}`), h('div', { class: 'sheet__sub' }, s.mode === 'demo' ? 'демонстрационные данные' : cfg.sourceNote)),
        this.collapseButton(),
      ),
    );
    if (this.collapsed) return parts;
    const body = h('div', { class: 'sheet__body' });
    if (s.mode === 'demo' && s.showDemoNotice) {
      body.append(demoBanner(() => {
        this.store.set({ showDemoNotice: false });
        this.renderSheet();
      }));
      body.append(h('div', { style: { height: '10px' } }));
    }
    const recent = this.recentRoutes();
    if (recent.length) {
      body.append(h('div', { class: 'section-title', style: { paddingTop: '4px' } }, 'Недавние'));
      body.append(
        ...recent.map((r) =>
          h(
            'button',
            { class: 'row', type: 'button', onClick: () => this.selectRoute(r) },
            h('div', { class: 'route-tile__num', style: { minWidth: '46px' } }, r.number),
            h('div', { class: 'row__grow' }, h('div', { class: 'row__title' }, KIND_LABEL[r.kind]), h('div', { class: 'row__sub' }, [r.from, r.to].filter(Boolean).join(' → ') || 'Маршрут')),
            h('span', { style: { color: 'var(--muted-2)' } }, '›'),
          ),
        ),
      );
    }
    body.append(h('div', { class: 'section-title' }, 'Быстрый старт'));
    body.append(
      h(
        'div',
        { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } },
        h('button', { class: 'btn btn--primary', type: 'button', onClick: () => { this.tab = 'routes'; this.renderTabbar(); this.renderSheet(); } }, '🚌 Выбрать маршрут'),
        h('button', { class: 'btn', type: 'button', onClick: () => { this.tab = 'stops'; this.renderTabbar(); this.renderSheet(); } }, '🕓 Табло остановки'),
      ),
    );
    const all = this.allMapVehicles();
    if (all.length) {
      body.append(h('div', { class: 'section-title' }, 'На карте'));
      body.append(
        ...all.slice(0, 6).map((v) =>
          vehicleRow(v, () => this.selectVehicle(v.id, true)),
        ),
      );
    }
    parts.push(body);
    return parts;
  }

  private renderBoardPanel(): HTMLElement[] {
    const board = this.board!;
    return [
      h(
        'div',
        { class: 'sheet__head' },
        h('div', { class: 'row__grow' }, h('h2', { class: 'sheet__title' }, board.stopName), h('div', { class: 'sheet__sub' }, 'Остановочное табло')),
        h(
          'button',
          { class: 'icon-btn', type: 'button', 'aria-label': 'Закрыть', onClick: () => {
            this.board = null;
            this.renderSheet();
          } },
          '✕',
        ),
      ),
      h('div', { class: 'sheet__body' }, stopBoardView(board)),
    ];
  }

  private renderVehiclesOfRoute(): HTMLElement[] {
    const { status, vehicles, error } = this.selected;
    if (status === 'loading' && !vehicles.length) {
      return [h('div', { class: 'skeleton', style: { margin: '8px 4px' } }), h('div', { class: 'skeleton', style: { margin: '8px 4px', width: '70%' } })];
    }
    if (status === 'error') {
      return [
        emptyState('📡', 'Нет связи с источником', error ?? 'Проверьте интернет или включите демо-режим в настройках'),
        h('div', { class: 'sheet__actions' }, h('button', { class: 'btn btn--block', type: 'button', onClick: () => void this.refresh(true) }, 'Повторить')),
      ];
    }
    if (!vehicles.length) {
      return [
        emptyState('🌙', 'Машин на маршруте нет', 'Возможно, сейчас ночь или маршрут не обслуживается. Попробуйте другой маршрут.'),
        h('div', { class: 'sheet__actions' }, h('button', { class: 'btn btn--block', type: 'button', onClick: () => void this.refresh(true) }, 'Обновить')),
      ];
    }
    return [
      h('div', { class: 'sheet__sub', style: { padding: '0 6px 6px' } }, `${vehicles.length} ${plural(vehicles.length, 'машина', 'машины', 'машин')} на линии · обновлено ${timeText(this.selected.lastUpdate)}`),
      ...vehicles.map((v) => vehicleRow(v, () => this.selectVehicle(v.id, true))),
    ];
  }

  private renderRoutesPanel(): HTMLElement[] {
    const s = this.store.get();
    const filter = this.selected.kindFilter;
    const q = this.selected.query.toLowerCase().trim();
    const counts: Partial<Record<TransportKind, number>> = {};
    for (const r of this.routes) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    const favs = this.routes.filter((r) => s.favorites.includes(r.id));
    const recents = this.recentRoutes();
    let list = this.routes.filter((r) => (filter === 'all' ? true : r.kind === filter));
    if (q) {
      list = list.filter((r) => r.number.toLowerCase().includes(q) || (r.from ?? '').toLowerCase().includes(q) || (r.to ?? '').toLowerCase().includes(q));
    }
    const body = h('div', { class: 'sheet__body' });
    body.append(kindChips(filter, counts, (k) => {
      this.selected = { ...this.selected, kindFilter: k };
      this.renderSheet();
    }));
    if (favs.length && !q) {
      body.append(h('div', { class: 'section-title', style: { paddingTop: '6px' } }, 'Избранные'));
      body.append(h('div', { class: 'route-grid' }, ...favs.map((r) => routeTile(r, r.id === this.selected.route?.id, () => this.selectRoute(r)))));
    }
    if (recents.length && !q) {
      body.append(h('div', { class: 'section-title' }, 'Недавние'));
      body.append(h('div', { class: 'route-grid' }, ...recents.map((r) => routeTile(r, r.id === this.selected.route?.id, () => this.selectRoute(r)))));
    }
    body.append(h('div', { class: 'section-title' }, q ? `Найдено: ${list.length}` : 'Все маршруты'));
    if (!list.length) {
      body.append(emptyState('🔍', 'Ничего не нашлось', 'Попробуйте другой номер или название остановки'));
    } else {
      body.append(h('div', { class: 'route-grid' }, ...list.map((r) => routeTile(r, r.id === this.selected.route?.id, () => this.selectRoute(r)))));
    }
    return [
      h(
        'div',
        { class: 'sheet__head' },
        h('div', { class: 'row__grow' }, h('h2', { class: 'sheet__title' }, 'Маршруты'), h('div', { class: 'sheet__sub' }, CITIES[s.city].title + (this.provider.mode === 'demo' ? ' · демо' : ' · онлайн'))),
      ),
      body,
    ];
  }

  private renderStopsPanel(): HTMLElement[] {
    const s = this.store.get();
    const body = h('div', { class: 'sheet__body' });
    const stops = this.busesStops.filter((st) => !this.selected.query || st.name.toLowerCase().includes(this.selected.query.toLowerCase()));
    body.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card__title' }, 'Табло остановки'),
        h('div', { class: 'card__hint' }, s.mode === 'demo' ? 'В демо-режиме доступны остановки демонстрационных маршрутов.' : 'Выберите остановку — покажем прогноз прибытия транспорта.'),
        h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } },
          h('button', { class: 'btn', type: 'button', onClick: () => this.nearbyStops() }, '📍 Рядом со мной'),
          h('button', { class: 'btn', type: 'button', onClick: () => void this.loadStops() }, '🔄 Обновить список'),
        ),
      ),
    );
    if (!stops.length) {
      body.append(emptyState('🚏', 'Остановки не загружены', 'Нажмите «Обновить список» или включите демо-режим'));
    } else {
      body.append(h('div', { class: 'section-title' }, `Остановки · ${stops.length}`));
      body.append(...stops.slice(0, 80).map((st) => stopRow(st, () => void this.openBoard(st))));
    }
    return [
      h('div', { class: 'sheet__head' }, h('div', { class: 'row__grow' }, h('h2', { class: 'sheet__title' }, 'Остановки'), h('div', { class: 'sheet__sub' }, CITIES[s.city].title))),
      body,
    ];
  }

  private renderSettingsPanel(): HTMLElement[] {
    const s = this.store.get();
    const body = h('div', { class: 'sheet__body' });
    // город
    body.append(h('div', { class: 'section-title', style: { paddingTop: '2px' } }, 'Город'));
    body.append(
      h(
        'div',
        { class: 'chip-row' },
        ...(['nsk', 'krsk'] as CityId[]).map((id) =>
          h(
            'button',
            {
              class: `chip${s.city === id ? ' chip--active' : ''}`,
              type: 'button',
              onClick: () => {
                if (s.city === id) return;
                this.store.set({ city: id });
                this.selected = { ...this.selected, route: null, vehicles: [], selectedVehicleId: null, status: 'idle' };
                this.board = null;
                this.map.clearAll();
                this.overview = [];
                this.rebuildProvider();
                this.renderTopbar();
                this.renderSheet();
                void this.loadRoutes().then(() => this.loadOverview());
              },
            },
            CITIES[id].title,
          ),
        ),
      ),
    );
    // данные
    body.append(h('div', { class: 'section-title' }, 'Данные'));
    body.append(
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'switch-row' },
          h('div', { class: 'row__grow' }, h('div', { class: 'row__title' }, s.mode === 'demo' ? 'Демо-режим' : 'Живые данные'), h('div', { class: 'card__hint' }, s.mode === 'demo' ? 'Симуляция движения, без сети' : CITIES[s.city].sourceNote)),
          h('div', {
            class: `switch${s.mode === 'demo' ? ' switch--on' : ''}`,
            role: 'switch',
            'aria-checked': s.mode === 'demo' ? 'true' : 'false',
            tabindex: '0',
            onClick: () => this.setMode(s.mode === 'demo' ? 'live' : 'demo'),
            onKeydown: (e: Event) => {
              if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') this.setMode(s.mode === 'demo' ? 'live' : 'demo');
            },
          }),
        ),
        h('div', { class: 'settings-note' }, s.mode === 'demo' ? 'Выключите, чтобы видеть реальные автобусы из официального источника.' : 'Официальный источник: ' + CITIES[s.city].sourceUrl),
      ),
    );
    if (this.opts.platform === 'web') {
      body.append(
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'row__title' }, 'Свой прокси для веба'),
          h('div', { class: 'card__hint', style: { marginTop: '4px' } }, 'Официальные источники не отдают CORS-заголовки, поэтому в браузере живые данные требуют прокси. В приложении для Android он не нужен.'),
          h('div', { class: 'switch-row' },
            h('div', { class: 'row__grow' }, h('div', { class: 'row__title' }, 'Использовать прокси')),
            h('div', { class: `switch${s.proxyEnabled ? ' switch--on' : ''}`, role: 'switch', tabindex: '0', onClick: () => { this.store.set({ proxyEnabled: !s.proxyEnabled }); this.rebuildProvider(); this.renderSheet(); } }),
          ),
          h('div', { class: 'field' },
            h('label', { class: 'field__label' }, 'Шаблон (вставьте {url})'),
            h('input', {
              class: 'input',
              value: s.proxyTemplate,
              placeholder: 'https://ваш-прокси/?url={url}',
              onBlur: (e: Event) => {
                this.store.set({ proxyTemplate: (e.target as HTMLInputElement).value.trim() });
                this.rebuildProvider();
                this.toast('Прокси сохранён');
              },
            }),
          ),
        ),
      );
    }
    // внешний вид
    body.append(h('div', { class: 'section-title' }, 'Вид'));
    body.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'switch-row' },
          h('div', { class: 'row__grow' }, h('div', { class: 'row__title' }, 'Светлая тема'), h('div', { class: 'card__hint' }, 'Удобно днём на солнце')),
          h('div', { class: `switch${s.theme === 'light' ? ' switch--on' : ''}`, role: 'switch', tabindex: '0', onClick: () => { this.store.set({ theme: s.theme === 'light' ? 'dark' : 'light' }); this.applyTheme(); this.renderSheet(); } }),
        ),
        h('div', { class: 'switch-row' },
          h('div', { class: 'row__grow' }, h('div', { class: 'row__title' }, 'Следить за машиной'), h('div', { class: 'card__hint' }, 'Карта следует за выбранным автобусом')),
          h('div', { class: `switch${s.followVehicle ? ' switch--on' : ''}`, role: 'switch', tabindex: '0', onClick: () => this.store.set({ followVehicle: !s.followVehicle }) }),
        ),
      ),
    );
    // о приложении
    body.append(h('div', { class: 'section-title' }, 'О приложении'));
    body.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'row__title' }, `BusBus${this.opts.version ? ' · ' + this.opts.version : ''}`),
        h('div', { class: 'card__hint', style: { marginTop: '6px' } }, 'Без рекламы и слежки. Данные — официальные порталы городов. Проект не связан с перевозчиками.'),
        h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } },
          h('button', { class: 'btn btn--sm', type: 'button', onClick: () => void this.showSources() }, 'Источники данных'),
          h('button', { class: 'btn btn--sm', type: 'button', onClick: () => { resetDemo(); this.toast('Демо-маршруты перезапущены'); } }, 'Перезапустить демо'),
        ),
      ),
    );
    if (this.opts.extraSettings) body.append(...this.opts.extraSettings(this));
    return [
      h('div', { class: 'sheet__head' }, h('div', { class: 'row__grow' }, h('h2', { class: 'sheet__title' }, 'Настройки'), h('div', { class: 'sheet__sub' }, 'Всё работает без рекламы'))),
      body,
    ];
  }

  // ---------- действия ----------

  async setMode(mode: DataMode): Promise<void> {
    this.store.set({ mode });
    this.overview = [];
    this.selected = { ...this.selected, status: 'idle', vehicles: [], selectedVehicleId: null, route: null };
    this.map.clearAll();
    this.rebuildProvider();
    this.renderTopbar();
    await this.loadRoutes();
    if (this.provider.mode === 'live') {
      this.toast('Живые данные: ' + CITIES[this.store.get().city].sourceNote);
    } else {
      this.toast('Демо-режим включён');
    }
  }

  async loadStops(): Promise<void> {
    try {
      this.busesStops = (await this.provider.stops?.(this.selected.query)) ?? [];
      if (!this.busesStops.length && this.provider.mode === 'live') {
        this.toast('Источник не отдаёт список остановок — воспользуйтесь поиском рядом');
      }
      this.renderSheet();
    } catch (e) {
      this.toast(`Остановки: ${(e as Error).message}`);
    }
  }

  async openBoard(stop: Stop): Promise<void> {
    try {
      this.board = { stopId: stop.id, stopName: stop.name, entries: [], fetchedAt: Date.now() };
      this.renderSheet();
      if (this.provider.stopBoard) {
        this.board = await this.provider.stopBoard(stop);
      }
    } catch (e) {
      this.board = { stopId: stop.id, stopName: stop.name, entries: [], fetchedAt: Date.now() };
      this.toast(`Табло: ${(e as Error).message}`);
    }
    this.renderSheet();
  }

  private nearbyStops(): void {
    if (!navigator.geolocation) {
      this.toast('Геолокация недоступна');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        this.map.showUser(latitude, longitude);
        this.map.follow(latitude, longitude, 15);
        const list = this.busesStops
          .map((st) => ({ st, d: Math.hypot(st.lat - latitude, st.lon - longitude) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, 10)
          .map((x) => x.st);
        if (!list.length) {
          this.toast('Список остановок пуст — обновите его');
          return;
        }
        this.busesStops = list;
        this.renderSheet();
      },
      () => this.toast('Не удалось получить геопозицию'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  private locateMe(): void {
    if (!navigator.geolocation) {
      this.toast('Геолокация недоступна');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.map.showUser(pos.coords.latitude, pos.coords.longitude);
        this.map.follow(pos.coords.latitude, pos.coords.longitude, 15);
      },
      () => this.toast('Не удалось получить геопозицию'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  private async showSources(): Promise<void> {
    const s = this.store.get();
    const cfg = CITIES[s.city];
    await alertDialog(
      'Источники данных',
      `${cfg.title}: ${cfg.sourceNote}\n${cfg.sourceUrl}\n\nНовосибирск: map.nskgortrans.ru (МКУ «ЦУГАЭТ»).\nКрасноярск: mu-kgt.ru (МКУ «Красноярскгортранс»).\n\nДанные предоставляются официальными порталами; приложение только отображает их.`,
    );
  }

  private applyTheme(): void {
    const t = this.store.get().theme;
    const auto = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.theme = t === 'auto' ? auto : t;
  }

  toast(message: string): void {
    if (!this.refs) return;
    if (!this.toastEl) {
      this.toastEl = h('div', { class: 'toast' });
      this.refs.root.append(this.toastEl);
    }
    this.toastEl.textContent = message;
    this.toastEl.classList.add('toast--show');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl?.classList.remove('toast--show'), 2600);
  }

  private allMapVehicles(): Vehicle[] {
    if (this.selected.vehicles.length) return this.selected.vehicles;
    return this.overview;
  }

  private recentRoutes(): Route[] {
    const recents = this.store.get().recent;
    const out: Route[] = [];
    for (const key of recents) {
      const r = this.routes.find((x) => x.id === key) ?? demoRouteFromKey(key, this.store.get().city);
      if (r && !out.some((x) => x.id === r.id)) out.push(r);
    }
    return out.slice(0, 6);
  }
}

function demoRouteFromKey(key: string, city: CityId): Route | undefined {
  const [kind, number] = key.split(':');
  const line = demoLineFor(city, number, kind as TransportKind);
  if (!line) return undefined;
  return { id: key, city, kind: line.kind, number: line.number, sourceId: line.number, from: line.from, to: line.to };
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function timeText(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export { plural, timeText, isIos, safeLocalGet, safeLocalSet, throttle };
