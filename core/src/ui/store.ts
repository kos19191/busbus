import type { CityId, DataMode, Route, Stop, TransportKind, Vehicle } from '../transport/types';
import { safeLocalGet, safeLocalSet } from './dom';

export interface Settings {
  city: CityId;
  mode: DataMode;
  theme: 'dark' | 'light' | 'auto';
  units: 'metric';
  proxyEnabled: boolean;
  proxyTemplate: string;
  showHeat: boolean;
  showStops: boolean;
  followVehicle: boolean;
  favorites: string[];
  recent: string[];
  showDemoNotice: boolean;
}

const KEY = 'busbus.settings.v1';

const DEFAULTS: Settings = {
  city: 'nsk',
  mode: 'demo',
  theme: 'auto',
  units: 'metric',
  proxyEnabled: false,
  proxyTemplate: 'https://api.allorigins.win/raw?url={url}',
  showHeat: false,
  showStops: false,
  followVehicle: true,
  favorites: [],
  recent: [],
  showDemoNotice: true,
};

type Listener = (s: Settings) => void;

export class Store {
  private state: Settings;
  private listeners = new Set<Listener>();

  constructor() {
    this.state = { ...DEFAULTS, ...this.read() };
    // миграция демо-настроек
    if (!this.state.proxyTemplate) this.state.proxyTemplate = DEFAULTS.proxyTemplate;
  }

  private read(): Partial<Settings> {
    try {
      const raw = safeLocalGet(KEY);
      return raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    } catch {
      return {};
    }
  }

  get(): Settings {
    return this.state;
  }

  set(patch: Partial<Settings>): void {
    this.state = { ...this.state, ...patch };
    safeLocalSet(KEY, JSON.stringify(this.state));
    this.listeners.forEach((l) => l(this.state));
  }

  toggleFavorite(routeKey: string): void {
    const favs = new Set(this.state.favorites);
    if (favs.has(routeKey)) favs.delete(routeKey);
    else favs.add(routeKey);
    this.set({ favorites: [...favs] });
  }

  pushRecent(routeKey: string): void {
    const list = [routeKey, ...this.state.recent.filter((r) => r !== routeKey)].slice(0, 8);
    this.set({ recent: list });
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export interface SelectionState {
  route: Route | null;
  kindFilter: TransportKind | 'all';
  query: string;
  vehicles: Vehicle[];
  selectedVehicleId: string | null;
  status: 'idle' | 'loading' | 'ok' | 'error' | 'empty';
  error?: string;
  lastUpdate?: number;
  stop: Stop | null;
}

export const emptySelection: SelectionState = {
  route: null,
  kindFilter: 'all',
  query: '',
  vehicles: [],
  selectedVehicleId: null,
  status: 'idle',
  stop: null,
};
