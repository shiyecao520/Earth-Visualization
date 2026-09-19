export type RegionLevel = "country" | "province" | "city" | string;

export interface RegionItem {
  code: string;
  name: string;
  level: RegionLevel;
  parentCode?: string | null;
  hasChildren?: boolean;
  childLevel?: RegionLevel | null;
  center?: [number, number] | { longitude: number; latitude: number } | null;
  bounds?: [number, number, number, number] | null;
  datasetCount?: number;
  paperCount?: number;
}

export interface RegionRequest {
  level: RegionLevel;
  parentCode: string | null;
  filters: Record<string, unknown>;
}

export interface RegionCountRequest extends RegionRequest {
  codes: string[];
}

export interface RegionDataProvider {
  listChildren(request: RegionRequest): Promise<RegionItem[] | { items: RegionItem[] } | { regions: RegionItem[] } | { data: RegionItem[] }>;
  getCounts?(request: RegionCountRequest): Promise<Record<string, unknown>>;
}

export interface RegionDrilldownOptions {
  dataProvider: RegionDataProvider;
  container?: HTMLElement;
  initialLevel?: RegionLevel;
  levels?: RegionLevel[];
  filters?: Record<string, unknown>;
  showControls?: boolean;
  controlsTitle?: string;
  backText?: string;
  worldViewHeight?: number;
  regionViewHeight?: number;
  cameraDuration?: number;
  onRegionClick?(region: RegionItem): void;
  onRegionSelect?(region: RegionItem): void;
  onLevelChange?(state: RegionDrilldownState): void;
  onDataChange?(payload: { regions: RegionItem[]; state: RegionDrilldownState }): void;
  onLoading?(request: RegionRequest): void;
  onError?(payload: { error: unknown; level: RegionLevel; parentCode: string | null }): void;
}

export interface RegionDrilldownState {
  level: RegionLevel;
  parentCode: string | null;
  path: Array<RegionItem & { childLevel?: RegionLevel }>;
  filters: Record<string, unknown>;
  regionCount: number;
}

export interface RegionDrilldownController {
  ready: Promise<boolean | null>;
  on(eventName: string, handler: (payload: unknown) => void): () => void;
  off(eventName: string, handler: (payload: unknown) => void): void;
  reload(options?: { useCache?: boolean; skipCamera?: boolean; silent?: boolean }): Promise<boolean>;
  goBack(): Promise<boolean>;
  goHome(): Promise<boolean>;
  goToPath(index: number): Promise<boolean>;
  drillTo(code: string): Promise<boolean>;
  setFilters(filters: Record<string, unknown>, options?: { reload?: boolean }): Promise<boolean>;
  setRegions(regions: RegionItem[], metadata?: Partial<RegionDrilldownState>): boolean;
  setVisible(visible: boolean): void;
  getRegions(): RegionItem[];
  getState(): RegionDrilldownState;
  destroy(): void;
}

export declare function createRegionDrilldown(
  viewer: import("cesium").Viewer,
  options: RegionDrilldownOptions
): RegionDrilldownController;

export default createRegionDrilldown;
