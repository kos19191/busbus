import L from 'leaflet';
import 'leaflet.heat';
import type { Route, TransportKind, Vehicle, CityId } from '../transport/types';
import { KIND_COLOR, CITIES } from '../transport/types';
import { indexPolyline, pointAt, projectOnPolyline, type PolylineIndex } from '../transport/geo';

/**
 * Обёртка над Leaflet: карта, маркеры машин, линия маршрута, остановки, теплокарта.
 * Всё, что знает о геометрии и анимации — здесь, чтобы одинаково работать
 * и в браузере, и в WebView Android.
 */

export interface MapOptions {
  city: CityId;
  tileUrl?: string;
  onVehicleClick?: (v: Vehicle) => void;
}

export interface VehicleMarker {
  vehicle: Vehicle;
  marker: L.Marker;
  /** Предыдущая позиция для сглаживания */
  prev?: { lat: number; lon: number; at: number };
  target?: { lat: number; lon: number; at: number };
}

export class BusMap {
  readonly map: L.Map;
  private city: CityId;
  private tiles: L.TileLayer;
  private markerLayer = L.layerGroup();
  private routeLayer = L.layerGroup();
  private stopLayer = L.layerGroup();
  private heat: L.HeatLayer | null = null;
  private markers = new Map<string, VehicleMarker>();
  private routeLine: L.Polyline | null = null;
  private ghostLine: L.Polyline | null = null;
  private routeIdx: PolylineIndex | null = null;
  private linePoints: [number, number][] = [];
  private raf = 0;
  private onVehicleClick?: (v: Vehicle) => void;
  private userMarker: L.Marker | null = null;

  constructor(host: HTMLElement, opts: MapOptions) {
    const cfg = CITIES[opts.city];
    this.city = opts.city;
    this.onVehicleClick = opts.onVehicleClick;
    this.map = L.map(host, {
      center: cfg.center,
      zoom: cfg.zoom,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      fadeAnimation: true,
      zoomAnimation: true,
    });
    this.tiles = L.tileLayer(opts.tileUrl ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
      crossOrigin: true,
    }).addTo(this.map);
    this.tiles.addTo(this.map);
    this.markerLayer.addTo(this.map);
    this.routeLayer.addTo(this.map);
    this.stopLayer.addTo(this.map);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    this.startAnimation();
  }

  setCity(city: CityId): void {
    if (this.city === city) return;
    this.city = city;
    const cfg = CITIES[city];
    this.map.setView(cfg.center, cfg.zoom);
    this.clearAll();
  }

  setTileUrl(url: string): void {
    this.tiles.setUrl(url);
  }

  getCity(): CityId {
    return this.city;
  }

  /** Линия маршрута: рисуем «подложку» + подсветку */
  setRouteLine(points: [number, number][], color = '#34d399'): void {
    this.linePoints = points;
    this.routeLine?.remove();
    this.ghostLine?.remove();
    this.routeLine = null;
    this.ghostLine = null;
    if (!points.length) {
      this.routeIdx = null;
      return;
    }
    this.routeIdx = indexPolyline(points);
    this.ghostLine = L.polyline(points, {
      color: '#0f172a',
      weight: 11,
      opacity: 0.35,
      lineJoin: 'round',
      lineCap: 'round',
      interactive: false,
    }).addTo(this.routeLayer);
    this.routeLine = L.polyline(points, {
      color,
      weight: 6,
      opacity: 0.95,
      lineJoin: 'round',
      lineCap: 'round',
      interactive: false,
    }).addTo(this.routeLayer);
    this.fitLine(points);
  }

  /**
   * Вписать линию в видимую часть карты: на мобильном снизу лежит шторка,
   * сверху — панель поиска, поэтому кадрируем с полями и сдвигом.
   */
  private fitLine(points: [number, number][]): void {
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map(([lat, lon]) => L.latLng(lat, lon)));
    const size = this.map.getSize();
    const top = 96;
    const sheet = this.map.getContainer().closest('.app')?.querySelector('.sheet') as HTMLElement | null;
    const bottom = sheet ? Math.min(sheet.getBoundingClientRect().height, size.y * 0.62) : 24;
    const pad = { paddingTopLeft: L.point(24, top), paddingBottomRight: L.point(24, Math.max(24, bottom)) };
    this.map.fitBounds(bounds, { ...pad, animate: true, maxZoom: 15 });
  }

  getRouteIndex(): PolylineIndex | null {
    return this.routeIdx;
  }

  getLinePoints(): [number, number][] {
    return this.linePoints;
  }

  /** Позиция машины на линии (для КРСК, где нет GPS) */
  pointOnLineAhead(vehicle: Vehicle, metersAhead = 0): [number, number] | null {
    if (!this.routeIdx) return null;
    const idx = this.routeIdx;
    const proj = projectOnPolyline(idx, vehicle.lat, vehicle.lon);
    return pointAt(idx, proj.along + metersAhead);
  }

  setStops(stops: { id: string; name: string; lat: number; lon: number }[]): void {
    this.stopLayer.clearLayers();
    for (const s of stops) {
      const icon = L.divIcon({ className: '', html: '<div class="stop-marker"></div>', iconSize: [12, 12], iconAnchor: [6, 6] });
      L.marker([s.lat, s.lon], { icon, keyboard: false, interactive: false }).addTo(this.stopLayer);
    }
  }

  clearStops(): void {
    this.stopLayer.clearLayers();
  }

  /** Обновить машины: плавное движение между обновлениями */
  setVehicles(vehicles: Vehicle[], selectedId?: string | null): void {
    const seen = new Set<string>();
    for (const v of vehicles) {
      if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) continue;
      seen.add(v.id);
      let vm = this.markers.get(v.id);
      if (!vm) {
        const marker = L.marker([v.lat, v.lon], {
          icon: this.buildIcon(v, selectedId === v.id),
          keyboard: false,
          zIndexOffset: v.kind === 'tram' ? 100 : 0,
        });
        marker.on('click', () => {
          this.onVehicleClick?.(vm ? vm.vehicle : v);
        });
        marker.addTo(this.markerLayer);
        vm = { vehicle: v, marker, target: { lat: v.lat, lon: v.lon, at: Date.now() } };
        this.markers.set(v.id, vm);
      } else {
        vm.prev = vm.target ?? { lat: v.lat, lon: v.lon, at: Date.now() };
        // если машина «телепортировалась» (перестановка на линии) — без анимации
        const jump = Math.abs(v.lat - vm.vehicle.lat) + Math.abs(v.lon - vm.vehicle.lon);
        vm.target = { lat: v.lat, lon: v.lon, at: Date.now() };
        if (jump > 0.05) vm.prev = vm.target;
        vm.vehicle = v;
        vm.marker.setIcon(this.buildIcon(v, selectedId === v.id));
      }
    }
    for (const [id, vm] of this.markers) {
      if (!seen.has(id)) {
        vm.marker.remove();
        this.markers.delete(id);
      }
    }
    if (this.heat) this.updateHeat(vehicles);
  }

  private buildIcon(v: Vehicle, selected: boolean): L.DivIcon {
    const color = KIND_COLOR[v.kind] ?? '#ff7a1a';
    const arrow = v.bearing !== undefined ? `<span class="vehicle-marker__arrow" data-arrow style="transform:rotate(${v.bearing}deg)">➤</span>` : '';
    const dim = v.status && /обед|отстой|перерыв/i.test(v.status) ? ' vehicle-marker--dim' : '';
    return L.divIcon({
      className: '',
      html: `<div class="vehicle-marker${dim}${selected ? ' vehicle-marker--selected' : ''}" style="--marker-bg:${color}" data-id="${v.id}">${arrow}<span>${escapeHtml(v.routeNumber)}</span></div>`,
      iconSize: [46, 24],
      iconAnchor: [23, 12],
    });
  }

  selectVehicle(id: string | null): void {
    for (const [vid, vm] of this.markers) {
      vm.marker.setIcon(this.buildIcon(vm.vehicle, vid === id));
    }
  }

  enableHeat(on: boolean): void {
    if (this.heat) {
      this.map.removeLayer(this.heat);
      this.heat = null;
    }
    if (on) {
      this.heat = (L as unknown as { heatLayer: (pts: [number, number][], o?: unknown) => L.HeatLayer }).heatLayer([], {
        radius: 26,
        blur: 22,
        maxZoom: 16,
        minOpacity: 0.25,
        gradient: { 0.2: '#34d399', 0.5: '#fbbf24', 0.8: '#f87171' },
      });
      this.heat.addTo(this.map);
      this.updateHeat([...this.markers.values()].map((m) => m.vehicle));
    }
  }

  private updateHeat(vehicles: Vehicle[]): void {
    if (!this.heat) return;
    // «Плотность» стоящих машин: чем медленнее, тем горячее
    this.heat.setLatLngs(vehicles.map((v) => [v.lat, v.lon, Math.max(0.15, 1 - (v.speedKmh ?? 20) / 60)]));
  }

  follow(lat: number, lon: number, zoom = 14): void {
    this.map.setView([lat, lon], Math.max(this.map.getZoom(), zoom), { animate: true });
  }

  showUser(lat: number, lon: number): void {
    if (!this.userMarker) {
      const icon = L.divIcon({
        className: '',
        html: '<div style="width:16px;height:16px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 0 0 6px rgba(59,130,246,.25)"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      this.userMarker = L.marker([lat, lon], { icon, interactive: false }).addTo(this.map);
    } else {
      this.userMarker.setLatLng([lat, lon]);
    }
  }

  clearAll(): void {
    this.routeLayer.clearLayers();
    this.stopLayer.clearLayers();
    this.markerLayer.clearLayers();
    this.markers.clear();
    this.routeLine = null;
    this.ghostLine = null;
    this.routeIdx = null;
    this.linePoints = [];
  }

  private startAnimation(): void {
    const step = () => {
      const now = Date.now();
      for (const vm of this.markers.values()) {
        if (!vm.prev || !vm.target) continue;
        if (now >= vm.target.at + 1100) continue;
        const span = Math.max(1, vm.target.at - vm.prev.at);
        const t = Math.min(1, (now - vm.prev.at) / span);
        const lat = vm.prev.lat + (vm.target.lat - vm.prev.lat) * t;
        const lon = vm.prev.lon + (vm.target.lon - vm.prev.lon) * t;
        vm.marker.setLatLng([lat, lon]);
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.map.remove();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
