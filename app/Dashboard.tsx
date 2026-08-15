"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ColumnLayer, GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { PickingInfo } from "@deck.gl/core";
import * as maplibregl from "maplibre-gl";
import {
  type IControl,
  type Map as MapLibreMap,
  type StyleSpecification,
} from "maplibre-gl";
import {
  Accessibility,
  Activity,
  Baby,
  Building2,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  Clock3,
  Crosshair,
  Database,
  Gauge,
  HeartPulse,
  Layers3,
  LocateFixed,
  MapPin,
  MessageSquare,
  Navigation,
  Radar,
  Route,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Toilet,
  Upload,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import type {
  CommentRecord,
  PremiumDataset,
  PublicDataset,
  ToiletRecord,
} from "./types";
import "maplibre-gl/dist/maplibre-gl.css";

type BoundaryData = {
  type: "FeatureCollection";
  features: Array<Record<string, unknown>>;
};

type MapMode = "online" | "offline";

type FilterState = {
  query: string;
  district: string;
  opening: "all" | "24h" | "known";
  source: "all" | "public" | "premium";
  squat: boolean;
  seated: boolean;
  accessible: boolean;
  thirdRestroom: boolean;
};

type ImportedRecord = Record<string, unknown>;

const SHANGHAI_CENTER: [number, number] = [121.4737, 31.2304];
const ONLINE_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const LOCAL_STYLE: StyleSpecification = {
  version: 8,
  name: "方便一下离线底图",
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#071019" },
    },
  ],
};

const DISTRICT_ORDER = [
  "黄浦区",
  "徐汇区",
  "长宁区",
  "静安区",
  "普陀区",
  "虹口区",
  "杨浦区",
  "闵行区",
  "宝山区",
  "嘉定区",
  "浦东新区",
  "金山区",
  "松江区",
  "青浦区",
  "奉贤区",
  "崇明区",
];

const EMPTY_FILTERS: FilterState = {
  query: "",
  district: "全部区域",
  opening: "all",
  source: "all",
  squat: false,
  seated: false,
  accessible: false,
  thirdRestroom: false,
};

const DEMO_STEPS = [
  ["00:00", "一句话", "上海厕所很多，但真正着急时，数据是不完整的。"],
  ["00:25", "看全城", "展示 941 个公开厕所点与离线 3D 上海轮廓。"],
  ["00:55", "找对厕所", "切换 24 小时、蹲厕、无障碍等筛选，未知字段不冒充已确认。"],
  ["01:25", "憋不住了", "启动四级降级：严选命中 → 放宽设施 → 最近公开点 → 人工求助。"],
  ["02:05", "数据飞轮", "小浣熊把帖子正文或截图结构化，合法 JSON 导入后金色 3D 柱自动出现。"],
  ["02:35", "商业闭环", "商场体验 SaaS、明确标注的推广位、经同意的匿名研究合作。"],
] as const;

function isObject(value: unknown): value is ImportedRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeImportedRecord(input: unknown, index: number): ToiletRecord | null {
  if (!isObject(input)) return null;
  const coordinateObject = isObject(input.coordinates) ? input.coordinates : {};
  const longitude = nullableNumber(coordinateObject.longitude ?? input.longitude ?? input.lng);
  const latitude = nullableNumber(coordinateObject.latitude ?? input.latitude ?? input.lat);
  const name = nullableString(input.name ?? input.title);
  if (!name || longitude === null || latitude === null) return null;

  const facility = isObject(input.facility) ? input.facility : {};
  const comments = Array.isArray(input.comments)
    ? input.comments.flatMap((comment, commentIndex): CommentRecord[] => {
        if (!isObject(comment) || !nullableString(comment.content)) return [];
        return [
          {
            id: nullableString(comment.id) ?? `import-comment-${index}-${commentIndex}`,
            author: nullableString(comment.author) ?? "小红书用户",
            content: nullableString(comment.content) ?? "",
            createdAt: nullableString(comment.createdAt) ?? "待核实",
            source: "imported",
          },
        ];
      })
    : [];

  return {
    id: nullableString(input.id) ?? `premium-import-${Date.now()}-${index}`,
    sourceType: "premium_xhs",
    sourceName: nullableString(input.sourceName) ?? "用户提供的小红书内容",
    sourceUrl: nullableString(input.sourceUrl),
    sourceRef: nullableString(input.sourceRef),
    dataStatus: "pending_verification",
    name,
    district: nullableString(input.district),
    address: nullableString(input.address),
    coordinates: { longitude, latitude },
    openingHours: nullableString(input.openingHours),
    open24h: nullableBoolean(input.open24h),
    facility: {
      squat: nullableBoolean(facility.squat),
      seated: nullableBoolean(facility.seated),
      accessible: nullableBoolean(facility.accessible),
      thirdRestroom: nullableBoolean(facility.thirdRestroom),
      babyCare: nullableBoolean(facility.babyCare),
    },
    crowd: null,
    tags: Array.isArray(input.tags)
      ? input.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    rating: nullableNumber(input.rating),
    reviewCount: nullableNumber(input.reviewCount),
    healthScore: nullableNumber(input.healthScore),
    confidence: nullableNumber(input.confidence),
    description: nullableString(input.description),
    comments,
    updatedAt: nullableString(input.updatedAt),
  };
}

function haversineKm(a: [number, number], b: [number, number]) {
  const radius = 6371;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function distanceLabel(kilometers: number) {
  if (kilometers < 1) return `${Math.max(40, Math.round(kilometers * 1000))} m`;
  return `${kilometers.toFixed(1)} km`;
}

function truthLabel(value: boolean | null) {
  if (value === true) return "有";
  if (value === false) return "无";
  return "待核实";
}

function scoreLabel(record: ToiletRecord) {
  if (record.rating !== null) return record.rating.toFixed(1);
  if (record.confidence !== null) return `${Math.round(record.confidence * 100)}%`;
  return "待核实";
}

function makeLayers(
  records: ToiletRecord[],
  boundary: BoundaryData | null,
  selectedId: string | null,
) {
  const selected = records.find((record) => record.id === selectedId);
  const layers = [
    boundary
      ? new GeoJsonLayer({
          id: "shanghai-boundary",
          data: boundary as never,
          filled: true,
          stroked: true,
          extruded: true,
          getElevation: 45,
          getFillColor: [10, 35, 43, 175],
          getLineColor: [75, 232, 219, 210],
          getLineWidth: 2,
          lineWidthMinPixels: 1.4,
          pickable: false,
        })
      : null,
    new ColumnLayer<ToiletRecord>({
      id: "toilet-columns",
      data: records,
      diskResolution: 6,
      radius: 175,
      extruded: true,
      elevationScale: 1,
      getPosition: (record) => [record.coordinates.longitude, record.coordinates.latitude],
      getElevation: (record) =>
        record.id === selectedId
          ? 1150
          : 180 + (record.confidence ?? 0.45) * 640 + (record.rating ?? 0) * 80,
      getFillColor: (record) =>
        record.sourceType === "premium_xhs"
          ? [255, 194, 71, 235]
          : record.open24h === true
            ? [190, 255, 61, 220]
            : [66, 221, 238, 205],
      getLineColor: [240, 255, 253, 120],
      lineWidthMinPixels: 1,
      stroked: true,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 120],
      material: {
        ambient: 0.45,
        diffuse: 0.75,
        shininess: 70,
        specularColor: [140, 255, 245],
      },
    }),
    selected
      ? new ScatterplotLayer<ToiletRecord>({
          id: "selected-halo",
          data: [selected],
          getPosition: (record) => [record.coordinates.longitude, record.coordinates.latitude],
          getRadius: 620,
          radiusUnits: "meters",
          getFillColor: [255, 255, 255, 12],
          getLineColor: [255, 255, 255, 235],
          lineWidthMinPixels: 2,
          stroked: true,
          filled: true,
          pickable: false,
        })
      : null,
  ];
  return layers.filter(Boolean) as Array<GeoJsonLayer | ColumnLayer<ToiletRecord> | ScatterplotLayer<ToiletRecord>>;
}

function ToiletMap({
  records,
  boundary,
  selectedId,
  mode,
  onSelect,
  onOnlineFailure,
}: {
  records: ToiletRecord[];
  boundary: BoundaryData | null;
  selectedId: string | null;
  mode: MapMode;
  onSelect: (record: ToiletRecord) => void;
  onOnlineFailure: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mode === "online" ? ONLINE_STYLE : LOCAL_STYLE,
      center: SHANGHAI_CENTER,
      zoom: 9.1,
      minZoom: 7.6,
      maxZoom: 17,
      pitch: 51,
      bearing: -18,
      attributionControl: false,
    });
    const overlay = new MapboxOverlay({
      // Separate-canvas mode is compatible with MapLibre 6 and remains fully
      // functional when the online basemap drops to the local empty style.
      interleaved: false,
      layers: [],
      onClick: (info: PickingInfo<ToiletRecord>) => {
        if (info.object) onSelect(info.object);
      },
      getTooltip: (info: PickingInfo<ToiletRecord>) =>
        info.object
          ? {
              text: `${info.object.name}\n${info.object.district ?? "区域待核实"} · ${
                info.object.open24h === true ? "24 小时" : "开放时间待核实"
              }`,
              style: {
                backgroundColor: "#0b1722",
                color: "#f4f8f6",
                border: "1px solid #2c4854",
                borderRadius: "2px",
                fontSize: "12px",
              },
            }
          : null,
    });
    mapRef.current = map;
    overlayRef.current = overlay;

    map.on("load", () => {
      map.addControl(overlay as unknown as IControl);
      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
    });

    let failed = false;
    const failOnline = () => {
      if (mode === "online" && !failed) {
        failed = true;
        onOnlineFailure();
      }
    };
    map.on("error", failOnline);
    const styleTimer = window.setTimeout(() => {
      if (mode === "online" && !map.isStyleLoaded()) failOnline();
    }, 7000);

    return () => {
      window.clearTimeout(styleTimer);
      overlayRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, [mode, onOnlineFailure, onSelect]);

  useEffect(() => {
    overlayRef.current?.setProps({
      layers: makeLayers(records, boundary, selectedId),
      onClick: (info: PickingInfo<ToiletRecord>) => {
        if (info.object) onSelect(info.object);
      },
    });
  }, [records, boundary, selectedId, mode, onSelect]);

  return <div className="map-canvas" ref={containerRef} aria-label="上海公共厕所 3D 地图" />;
}

function FacilityCell({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: boolean | null;
}) {
  return (
    <div className={`facility-cell ${value === true ? "is-yes" : value === false ? "is-no" : "is-unknown"}`}>
      <span className="facility-icon">{icon}</span>
      <span>{label}</span>
      <strong>{truthLabel(value)}</strong>
    </div>
  );
}

function HealthModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: () => void;
}) {
  const [bristol, setBristol] = useState("4");
  const [duration, setDuration] = useState("顺畅，3 分钟内");
  const [blood, setBlood] = useState(false);
  const [pain, setPain] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const observe = () => {
    if (blood || pain) {
      setResult("红旗信号已点亮：别让 AI 猜。若便血、黑便或持续腹痛，请尽快联系医生；症状剧烈时及时急诊。 ");
      return;
    }
    const type = Number(bristol);
    if (type <= 2) setResult("今天像一条拥堵的延安高架：可以先留意饮水、膳食纤维和活动量。连续多日不适，请咨询专业医生。");
    else if (type >= 6) setResult("今天像上海梅雨天：偏稀。先补水并观察频率；若持续、伴发热或明显乏力，请及时就医。");
    else setResult("本次是“城市通行顺畅”型：形态接近常见范围。继续记录趋势，比一次判断更有意义。");
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card health-modal" role="dialog" aria-modal="true" aria-labelledby="health-title">
        <button className="icon-button modal-close" onClick={onClose} aria-label="关闭" title="关闭">
          <X size={18} />
        </button>
        <div className="eyebrow"><HeartPulse size={14} /> 娱乐型健康观察</div>
        <h2 id="health-title">以屎为镜，可以知……今天。</h2>
        <p className="modal-lead">记录排泄形态和感受，生成一张纯乐子观察卡。它不是医疗诊断，也不会替代医生。</p>

        <div className="health-form-grid">
          <label>
            <span>布里斯托类型</span>
            <select value={bristol} onChange={(event) => setBristol(event.target.value)}>
              <option value="1">1 · 颗粒硬块</option>
              <option value="2">2 · 香肠状但结块</option>
              <option value="3">3 · 表面有裂纹</option>
              <option value="4">4 · 光滑柔软</option>
              <option value="5">5 · 柔软小块</option>
              <option value="6">6 · 糊状松散</option>
              <option value="7">7 · 水样</option>
            </select>
          </label>
          <label>
            <span>耗时感受</span>
            <select value={duration} onChange={(event) => setDuration(event.target.value)}>
              <option>顺畅，3 分钟内</option>
              <option>一般，3–10 分钟</option>
              <option>艰难，10 分钟以上</option>
            </select>
          </label>
        </div>
        <div className="safety-checks">
          <label><input type="checkbox" checked={blood} onChange={(event) => setBlood(event.target.checked)} /> 发现便血或黑便</label>
          <label><input type="checkbox" checked={pain} onChange={(event) => setPain(event.target.checked)} /> 持续或剧烈腹痛</label>
        </div>
        <label className="note-field">
          <span>文字描述（可选）</span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：今天喝水少、出差、吃得很辣……" rows={3} />
        </label>
        <div className="health-actions">
          <button className="secondary-button" onClick={observe}><Sparkles size={16} /> 生成观察卡</button>
          <button className="primary-button" onClick={() => { observe(); onSave(); }}><Check size={16} /> 保存本次记录</button>
        </div>
        {result && (
          <div className={`health-result ${blood || pain ? "is-warning" : ""}`}>
            <Activity size={20} />
            <div><strong>AI 乐子观察</strong><p>{result}</p><small>记录：类型 {bristol} · {duration}{note ? ` · ${note}` : ""}</small></div>
          </div>
        )}
        <div className="medical-disclaimer"><ShieldCheck size={16} /> 数据只保存在当前浏览会话；出现红旗症状请停止娱乐分析并寻求专业医疗帮助。</div>
      </section>
    </div>
  );
}

function DemoModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card demo-modal" role="dialog" aria-modal="true" aria-labelledby="demo-title">
        <button className="icon-button modal-close" onClick={onClose} aria-label="关闭" title="关闭"><X size={18} /></button>
        <div className="eyebrow"><Zap size={14} /> 3 分钟黄金演示路径</div>
        <h2 id="demo-title">从“好玩”切到“真能救急”</h2>
        <div className="demo-timeline">
          {DEMO_STEPS.map(([time, title, description], index) => (
            <div className="demo-step" key={time}>
              <span className="demo-index">{index + 1}</span>
              <time>{time}</time>
              <div><strong>{title}</strong><p>{description}</p></div>
            </div>
          ))}
        </div>
        <div className="demo-close-row"><button className="primary-button" onClick={onClose}><Check size={16} /> 我记住了</button></div>
      </section>
    </div>
  );
}

export function Dashboard() {
  const [publicRecords, setPublicRecords] = useState<ToiletRecord[]>([]);
  const [premiumRecords, setPremiumRecords] = useState<ToiletRecord[]>([]);
  const [premiumStatus, setPremiumStatus] = useState<PremiumDataset["status"]>("pending_source");
  const [publicMeta, setPublicMeta] = useState<Pick<PublicDataset, "source" | "license" | "generatedAt"> | null>(null);
  const [boundary, setBoundary] = useState<BoundaryData | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>("online");
  const [mapNotice, setMapNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [healthHistory, setHealthHistory] = useState(0);
  const [userLocation, setUserLocation] = useState<[number, number]>(SHANGHAI_CENTER);
  const [locationLabel, setLocationLabel] = useState("人民广场演示点");
  const [sessionComments, setSessionComments] = useState<Record<string, CommentRecord[]>>({});
  const [commentDraft, setCommentDraft] = useState("");
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/data/public-toilets.json").then((response) => {
        if (!response.ok) throw new Error("公开厕所数据读取失败");
        return response.json() as Promise<PublicDataset>;
      }),
      fetch("/data/premium-toilets.json").then((response) => {
        if (!response.ok) throw new Error("优质榜单状态读取失败");
        return response.json() as Promise<PremiumDataset>;
      }),
      fetch("/data/shanghai-boundary.geojson").then((response) => {
        if (!response.ok) throw new Error("离线地图读取失败");
        return response.json() as Promise<BoundaryData>;
      }),
    ])
      .then(([publicData, premiumData, boundaryData]) => {
        if (!active) return;
        setPublicRecords(publicData.records);
        setPremiumRecords(premiumData.records);
        setPremiumStatus(premiumData.status);
        setPublicMeta(publicData);
        setBoundary(boundaryData);
        setSelectedId(publicData.records[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "数据读取失败");
        setMapMode("offline");
      })
      .finally(() => active && setLoading(false));

    const goOffline = () => {
      setMapMode("offline");
      setMapNotice("网络中断，地图已无缝降级");
    };
    if (!navigator.onLine) window.setTimeout(goOffline, 0);
    window.addEventListener("offline", goOffline);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    return () => {
      active = false;
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const allRecords = useMemo(
    () => [...publicRecords, ...premiumRecords],
    [publicRecords, premiumRecords],
  );

  const districts = useMemo(() => {
    const found = new Set(allRecords.flatMap((record) => (record.district ? [record.district] : [])));
    return DISTRICT_ORDER.filter((district) => found.has(district));
  }, [allRecords]);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = filters.query.trim().toLowerCase();
    return allRecords.filter((record) => {
      if (filters.district !== "全部区域" && record.district !== filters.district) return false;
      if (filters.opening === "24h" && record.open24h !== true) return false;
      if (filters.opening === "known" && !record.openingHours) return false;
      if (filters.source === "public" && record.sourceType !== "public_open_data") return false;
      if (filters.source === "premium" && record.sourceType !== "premium_xhs") return false;
      if (filters.squat && record.facility.squat !== true) return false;
      if (filters.seated && record.facility.seated !== true) return false;
      if (filters.accessible && record.facility.accessible !== true) return false;
      if (filters.thirdRestroom && record.facility.thirdRestroom !== true) return false;
      if (normalizedQuery) {
        const searchable = `${record.name} ${record.address ?? ""} ${record.district ?? ""} ${record.tags.join(" ")}`.toLowerCase();
        if (!searchable.includes(normalizedQuery)) return false;
      }
      return true;
    });
  }, [allRecords, filters]);

  const visibleSelectedId = emergencyOpen || filteredRecords.some((record) => record.id === selectedId)
    ? selectedId
    : filteredRecords[0]?.id ?? null;

  const selected = useMemo(
    () => allRecords.find((record) => record.id === visibleSelectedId) ?? null,
    [allRecords, visibleSelectedId],
  );

  const emergencyLevels = useMemo(() => {
    const nearest = (records: ToiletRecord[]) =>
      [...records]
        .map((record) => ({ record, distance: haversineKm(userLocation, [record.coordinates.longitude, record.coordinates.latitude]) }))
        .sort((a, b) => a.distance - b.distance)[0] ?? null;
    return [
      { level: 1, title: "严选命中", note: "保留全部当前筛选", result: nearest(filteredRecords), tone: "safe" },
      { level: 2, title: "放宽设施", note: "只保留 24 小时优先", result: nearest(allRecords.filter((record) => record.open24h === true)), tone: "lime" },
      { level: 3, title: "最近公开点", note: "忽略未知设施，按距离", result: nearest(publicRecords), tone: "amber" },
      { level: 4, title: "人工求助", note: "询问地铁、酒店、医院或商场服务台；说明紧急情况", result: null, tone: "red" },
    ] as const;
  }, [allRecords, filteredRecords, publicRecords, userLocation]);

  const handleMapFailure = useCallback(() => {
    setMapMode("offline");
    setMapNotice("在线底图加载失败，已自动切换离线上海概念图");
  }, []);

  const handleSelect = useCallback((record: ToiletRecord) => {
    setSelectedId(record.id);
  }, []);

  const toggleEmergency = () => {
    if (!emergencyOpen) setSelectedId(visibleSelectedId);
    setEmergencyOpen((current) => !current);
  };

  const updateFilter = <Key extends keyof FilterState>(key: Key, value: FilterState[Key]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const locateUser = () => {
    if (!navigator.geolocation) {
      setMapNotice("浏览器不支持定位，继续使用人民广场演示点");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation([position.coords.longitude, position.coords.latitude]);
        setLocationLabel("我的实时位置");
        setMapNotice("定位成功，紧急推荐已重新计算");
      },
      () => setMapNotice("未获得定位权限，继续使用人民广场演示点"),
      { enableHighAccuracy: true, timeout: 6000 },
    );
  };

  const handleImport = async (file: File) => {
    try {
      const raw: unknown = JSON.parse(await file.text());
      const candidates = Array.isArray(raw)
        ? raw
        : isObject(raw) && Array.isArray(raw.records)
          ? raw.records
          : [];
      const records = candidates.flatMap((candidate, index) => {
        const normalized = normalizeImportedRecord(candidate, index);
        return normalized ? [normalized] : [];
      });
      if (!records.length) throw new Error("没有可导入记录；每条至少需要 name、longitude、latitude");
      setPremiumRecords(records);
      setPremiumStatus("ready");
      setImportNotice(`已导入 ${records.length} 条优质厕所记录，均标记为“待核实”`);
      setSelectedId(records[0].id);
    } catch (error) {
      setImportNotice(error instanceof Error ? error.message : "JSON 导入失败");
    }
  };

  const addComment = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !commentDraft.trim()) return;
    const comment: CommentRecord = {
      id: `session-${Date.now()}`,
      author: "本次演示",
      content: commentDraft.trim(),
      createdAt: "刚刚",
      source: "session",
    };
    setSessionComments((current) => ({
      ...current,
      [selected.id]: [...(current[selected.id] ?? []), comment],
    }));
    setCommentDraft("");
  };

  const comments = selected
    ? [...selected.comments, ...(sessionComments[selected.id] ?? [])]
    : [];

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setFilters(EMPTY_FILTERS)} aria-label="重置并返回全城地图">
          <span className="brand-mark"><Toilet size={23} /></span>
          <span><strong>方便一下</strong><small>SHANGHAI RELIEF MAP</small></span>
        </button>
        <div className="topbar-pulse"><span className="live-dot" /> {loading ? "正在接入城市数据" : `${publicRecords.length} 个公开点已就绪`}</div>
        <nav className="top-actions" aria-label="主要操作">
          <button className={`status-button ${mapMode === "offline" ? "is-offline" : ""}`} onClick={() => setMapMode((current) => current === "online" ? "offline" : "online")}>
            {mapMode === "online" ? <Wifi size={15} /> : <WifiOff size={15} />}
            {mapMode === "online" ? "在线底图" : "离线概念图"}
          </button>
          <button className="header-button" onClick={() => fileRef.current?.click()}><Upload size={16} /> 导入榜单 JSON</button>
          <button className="header-button is-accent" onClick={() => setDemoOpen(true)}><Sparkles size={16} /> 3 分钟演示</button>
          <input ref={fileRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImport(file); event.currentTarget.value = ""; }} />
        </nav>
      </header>

      <main className="dashboard-grid">
        <aside className="left-rail">
          <section className="control-section">
            <div className="section-heading"><span><SlidersHorizontal size={15} /> 任务参数</span><button className="text-action" onClick={() => setFilters(EMPTY_FILTERS)}>重置</button></div>
            <label className="search-field"><Search size={16} /><input value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} placeholder="搜索厕所、地址或 Tag" /></label>
            <div className="two-fields">
              <label><span>区域</span><select value={filters.district} onChange={(event) => updateFilter("district", event.target.value)}><option>全部区域</option>{districts.map((district) => <option key={district}>{district}</option>)}</select></label>
              <label><span>开放状态</span><select value={filters.opening} onChange={(event) => updateFilter("opening", event.target.value as FilterState["opening"])}><option value="all">不限</option><option value="24h">确认 24 小时</option><option value="known">时间已记录</option></select></label>
            </div>
            <div className="source-tabs" role="group" aria-label="数据来源">
              {([['all', '全部'], ['public', '公开'], ['premium', '优质']] as const).map(([value, label]) => <button className={filters.source === value ? "is-active" : ""} key={value} onClick={() => updateFilter("source", value)}>{label}</button>)}
            </div>
            <div className="toggle-grid">
              <button className={filters.squat ? "is-active" : ""} onClick={() => updateFilter("squat", !filters.squat)}><span className="toggle-icon">蹲</span><span>有蹲厕</span>{filters.squat && <Check size={13} />}</button>
              <button className={filters.seated ? "is-active" : ""} onClick={() => updateFilter("seated", !filters.seated)}><span className="toggle-icon">坐</span><span>有坐厕</span>{filters.seated && <Check size={13} />}</button>
              <button className={filters.accessible ? "is-active" : ""} onClick={() => updateFilter("accessible", !filters.accessible)}><Accessibility size={16} /><span>无障碍</span>{filters.accessible && <Check size={13} />}</button>
              <button className={filters.thirdRestroom ? "is-active" : ""} onClick={() => updateFilter("thirdRestroom", !filters.thirdRestroom)}><Baby size={16} /><span>第三卫生间</span>{filters.thirdRestroom && <Check size={13} />}</button>
            </div>
          </section>

          <section className="data-panel">
            <div className="section-heading"><span><Database size={15} /> 数据雷达</span><span className="mini-badge">LIVE</span></div>
            <div className="data-stat-row"><span><i className="legend-column public" />公开厕所</span><strong>{publicRecords.length}</strong></div>
            <div className="data-stat-row"><span><i className="legend-column premium" />优质榜单</span><strong>{premiumRecords.length}</strong></div>
            <div className="data-stat-row"><span><i className="legend-column open" />确认 24h</span><strong>{publicRecords.filter((record) => record.open24h === true).length}</strong></div>
            <p className="source-note">{publicMeta?.license ?? "正在读取来源许可"}</p>
          </section>

          <section className="premium-panel">
            <div className="section-heading"><span><Star size={15} /> 小红书优质榜</span><span className={`mini-badge ${premiumStatus === "ready" ? "is-ready" : ""}`}>{premiumStatus === "ready" ? "READY" : "PENDING"}</span></div>
            {premiumRecords.length ? (
              <div className="premium-list">{premiumRecords.slice(0, 3).map((record, index) => <button key={record.id} onClick={() => setSelectedId(record.id)}><span>{index + 1}</span><div><strong>{record.name}</strong><small>{record.district ?? "区域待核实"}</small></div><ChevronRight size={15} /></button>)}</div>
            ) : (
              <div className="honest-empty"><Radar size={25} /><strong>榜单数据采集中</strong><p>没有帖子正文就不生成厕所，也不伪造评价。后续导入 JSON，金色 3D 柱会自动出现。</p><button onClick={() => fileRef.current?.click()}><Upload size={14} /> 导入真实数据</button></div>
            )}
            {importNotice && <p className="inline-notice">{importNotice}</p>}
          </section>
        </aside>

        <section className="map-stage">
          <div className="map-stage-top">
            <div><span className="map-kicker"><Layers3 size={14} /> SHANGHAI / 3D INTELLIGENCE</span><h1>全城厕所态势</h1></div>
            <div className="map-count"><strong>{filteredRecords.length}</strong><span>当前命中</span></div>
          </div>
          <div className="map-frame">
            {loading && <div className="map-loading"><Radar size={24} /><span>正在展开上海厕所情报网…</span></div>}
            {loadError && <div className="map-error"><CircleAlert size={20} /><div><strong>数据暂未载入</strong><p>{loadError}</p></div></div>}
            <ToiletMap records={filteredRecords} boundary={boundary} selectedId={visibleSelectedId} mode={mapMode} onSelect={handleSelect} onOnlineFailure={handleMapFailure} />
            <div className="map-scanlines" aria-hidden="true" />
            <div className="map-location"><MapPin size={14} /><span>{locationLabel}</span><button onClick={locateUser} aria-label="获取我的位置" title="获取我的位置"><LocateFixed size={15} /></button></div>
            <button className="panic-button" onClick={toggleEmergency}><Zap size={19} fill="currentColor" /><span><strong>憋不住了</strong><small>启动四级降级找厕</small></span><ChevronRight size={18} /></button>
            {mapNotice && <div className="map-notice"><CircleCheck size={15} /> {mapNotice}<button aria-label="关闭提示" title="关闭" onClick={() => setMapNotice(null)}><X size={14} /></button></div>}
            {emergencyOpen && (
              <div className="emergency-panel">
                <div className="emergency-head"><div><span className="eyebrow"><Route size={14} /> EMERGENCY FALLBACK</span><h2>能拉就别憋，拉不了就降级</h2></div><button className="icon-button" onClick={() => setEmergencyOpen(false)} aria-label="关闭" title="关闭"><X size={17} /></button></div>
                <div className="fallback-track">
                  {emergencyLevels.map((level) => (
                    <button key={level.level} className={`fallback-step tone-${level.tone}`} onClick={() => level.result && setSelectedId(level.result.record.id)}>
                      <span className="level-number">L{level.level}</span>
                      <div><strong>{level.title}</strong><small>{level.note}</small>{level.result ? <p><MapPin size={13} /> {level.result.record.name}<b>{distanceLabel(level.result.distance)}</b></p> : <p><MessageSquare size={13} /> 无地图也能执行<b>立即沟通</b></p>}</div>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                </div>
                <div className="route-disclaimer"><CircleAlert size={14} /> 距离为直线估算，不提供精确导航；开放时间未知时，请优先电话或现场确认。</div>
              </div>
            )}
            <div className="map-legend"><span><i className="dot-lime" />24 小时</span><span><i className="dot-cyan" />公开数据</span><span><i className="dot-gold" />优质榜单</span></div>
            <div className="map-attribution">© OpenStreetMap contributors · 离线轮廓为概念可视化</div>
          </div>
        </section>

        <aside className="detail-rail">
          {selected ? (
            <>
              <div className="detail-head">
                <div className="eyebrow"><Navigation size={14} /> SELECTED FACILITY</div>
                <h2>{selected.name}</h2>
                <p><MapPin size={14} /> {selected.address ?? `${selected.district ?? "区域"} · 具体地址待核实`}</p>
                <div className="detail-badges"><span className={selected.open24h === true ? "is-open" : ""}><Clock3 size={13} /> {selected.open24h === true ? "24 小时" : selected.openingHours ?? "时间待核实"}</span><span><ShieldCheck size={13} /> 可信度 {selected.confidence === null ? "待核实" : `${Math.round(selected.confidence * 100)}%`}</span></div>
              </div>

              <div className="detail-score-strip">
                <div><span>{selected.rating !== null ? "用户评分" : "来源可信度"}</span><strong>{scoreLabel(selected)}</strong></div>
                <div><span>点评</span><strong>{(selected.reviewCount ?? comments.length) || "—"}</strong></div>
                <div><span>健康度</span><strong>{selected.healthScore ?? "—"}</strong></div>
              </div>

              <section className="detail-section">
                <div className="section-heading"><span><Gauge size={15} /> 设施情报</span><small>未知 ≠ 没有</small></div>
                <div className="facility-grid">
                  <FacilityCell icon={<span>蹲</span>} label="蹲厕" value={selected.facility.squat} />
                  <FacilityCell icon={<span>坐</span>} label="坐厕" value={selected.facility.seated} />
                  <FacilityCell icon={<Accessibility size={16} />} label="无障碍" value={selected.facility.accessible} />
                  <FacilityCell icon={<Baby size={16} />} label="第三卫生间" value={selected.facility.thirdRestroom} />
                </div>
                <div className="tag-row">{selected.tags.length ? selected.tags.map((tag) => <span key={tag}>#{tag}</span>) : <span>#Tag 待补充</span>}</div>
              </section>

              <section className="detail-section crowd-section">
                <div className="section-heading"><span><Activity size={15} /> 拥挤时段</span><small>非实时</small></div>
                {selected.crowd?.length ? <div className="crowd-chart">{selected.crowd.map((period) => <div key={`${period.start}-${period.end}`}><span>{period.label}</span><i style={{ width: `${period.level * 20}%` }} /><small>{period.start}–{period.end}</small></div>)}</div> : <div className="unknown-line"><Radar size={17} /><span>暂无可信拥挤数据，现场反馈后再显示</span></div>}
              </section>

              <section className="detail-section source-section">
                <div className="section-heading"><span><Database size={15} /> 来源卡</span><small>{selected.dataStatus === "verified" ? "已核验" : "待交叉核验"}</small></div>
                <div className="source-card"><div><strong>{selected.sourceName}</strong><p>{selected.sourceRef ?? "来源编号待核实"}</p></div>{selected.sourceUrl ? <a href={selected.sourceUrl} target="_blank" rel="noreferrer" aria-label="打开数据来源" title="打开数据来源"><ChevronRight size={16} /></a> : <span className="disabled-link"><ChevronRight size={16} /></span>}</div>
              </section>

              <section className="detail-section comments-section">
                <div className="section-heading"><span><MessageSquare size={15} /> 现场点评</span><small>本次会话</small></div>
                {comments.length ? <div className="comment-list">{comments.slice(-2).map((comment) => <div key={comment.id}><strong>{comment.author}</strong><p>{comment.content}</p><small>{comment.createdAt}</small></div>)}</div> : <p className="empty-copy">还没有可信点评。第一条也要诚实。</p>}
                <form className="comment-form" onSubmit={addComment}><input value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="补充气味、清洁或排队情况" /><button aria-label="提交点评" title="提交点评"><ChevronRight size={16} /></button></form>
              </section>

              <div className="detail-actions"><button className="primary-button" onClick={() => setEmergencyOpen(true)}><Navigation size={16} /> 设为紧急目标</button><button className="secondary-button" onClick={() => setHealthOpen(true)}><HeartPulse size={16} /> 排泄记录</button></div>
            </>
          ) : (
            <div className="detail-empty"><Crosshair size={28} /><h2>选择一个 3D 数据柱</h2><p>查看设施、来源、评论和开放信息。</p></div>
          )}
        </aside>
      </main>

      <section className="insight-strip">
        <div className="insight-title"><div className="eyebrow"><Building2 size={14} /> FROM UTILITY TO DESTINATION</div><h2>厕所不是成本中心，是城市体验入口。</h2><p>“豪华厕所让商场从购物 Target 变成打卡 Target”是本项目的商业假设；案例与经营数据需要在正式路演前补充可引用来源。</p></div>
        <div className="insight-metrics"><div><strong>{publicRecords.length}</strong><span>公开厕所点</span></div><div><strong>{districts.length}</strong><span>覆盖行政区</span></div><div><strong>4 级</strong><span>紧急降级</span></div><div><strong>{healthHistory}</strong><span>本次健康记录</span></div></div>
        <div className="business-grid">
          <article><span className="business-icon"><Building2 size={19} /></span><small>B2B / SaaS</small><h3>商场厕所体验雷达</h3><p>清洁巡检、设施缺口、拥挤反馈和竞品对标，按门店或商圈订阅。</p></article>
          <article><span className="business-icon"><Star size={19} /></span><small>MARKETING</small><h3>明确标注的推广位</h3><p>商家可竞价获得“推广”展示，但不得影响紧急模式的距离与可用性排序。</p></article>
          <article><span className="business-icon"><ClipboardList size={19} /></span><small>RESEARCH</small><h3>自愿、匿名的研究合作</h3><p>只有明确同意后才汇总结构化趋势；不出售个体排泄数据，不做医疗诊断。</p></article>
          <article className="case-card"><span className="business-icon"><Sparkles size={19} /></span><small>CASE HYPOTHESIS</small><h3>厕所目的地化</h3><p>以南京德基广场等讨论热度为启发，验证“卫生间打卡”能否带来停留与传播。</p></article>
        </div>
      </section>

      <footer className="footer"><span><Toilet size={15} /> 方便一下 · Hackathon Golden Reference</span><span>公开数据 ODbL · 优质榜单待提供 · 医疗模块仅供娱乐</span></footer>

      {healthOpen && <HealthModal onClose={() => setHealthOpen(false)} onSave={() => setHealthHistory((count) => count + 1)} />}
      {demoOpen && <DemoModal onClose={() => setDemoOpen(false)} />}
    </div>
  );
}
