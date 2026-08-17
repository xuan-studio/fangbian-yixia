"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GeoJsonLayer, IconLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { PickingInfo } from "@deck.gl/core";
import * as maplibregl from "maplibre-gl";
import Supercluster from "supercluster";
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
  History,
  House,
  Layers3,
  ListChecks,
  LocateFixed,
  MapPin,
  MessageSquare,
  Moon,
  Navigation,
  Radar,
  Route,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Toilet,
  Upload,
  Users,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import type {
  AuditEvent,
  BuildingLocationCandidate,
  BuildingLocationDataset,
  CommentRecord,
  CommunityClaim,
  CommunityRating,
  PremiumDataset,
  PublicDataset,
  RatingScores,
  ToiletRecord,
} from "./types";
import "maplibre-gl/dist/maplibre-gl.css";

type BoundaryData = {
  type: "FeatureCollection";
  features: Array<Record<string, unknown>>;
};

type MapMode = "online" | "offline";
type VisualTheme = "light" | "dark";

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
type CommunityHubTab = "contribute" | "verify" | "history";
type ContributionKind = "rating" | "fact_update" | "status_report" | "new_toilet";

const SHANGHAI_CENTER: [number, number] = [121.4737, 31.2304];
const SHANGHAI_BBOX: [number, number, number, number] = [120.8, 30.65, 122.15, 31.9];
const MARKER_SURFACE_ALTITUDE = 52;

type ClusterPointProperties = { record: ToiletRecord };
type ClusterSummary = { open24hCount: number };
type ToiletClusterDatum = {
  kind: "cluster";
  clusterId: number;
  count: number;
  countLabel: string;
  open24hCount: number;
  coordinates: [number, number];
};
type MapPickDatum = ToiletRecord | ToiletClusterDatum;

function isClusterDatum(value: MapPickDatum): value is ToiletClusterDatum {
  return "kind" in value && value.kind === "cluster";
}
const MAP_VISUAL_THEME: VisualTheme = "light";
function makeOnlineStyle(theme: VisualTheme): StyleSpecification {
  const tileTheme = theme === "light" ? "light_all" : "dark_all";
  return {
    version: 8,
    name: `方便一下在线${theme === "light" ? "亮色" : "深色"}底图`,
    sources: {
      "carto-base": {
        type: "raster",
        tiles: ["a", "b", "c"].map(
          (subdomain) => `https://${subdomain}.basemaps.cartocdn.com/${tileTheme}/{z}/{x}/{y}@2x.png`,
        ),
        tileSize: 256,
        minzoom: 0,
        maxzoom: 20,
        attribution: "© OpenStreetMap contributors © CARTO",
      },
    },
    layers: [
      {
        id: "online-background",
        type: "background",
        paint: { "background-color": theme === "light" ? "#ebe8de" : "#071019" },
      },
      {
        id: "carto-base",
        type: "raster",
        source: "carto-base",
        minzoom: 0,
        maxzoom: 20,
        paint: theme === "light"
          ? { "raster-opacity": 0.96, "raster-saturation": -0.12, "raster-contrast": 0.04 }
          : { "raster-opacity": 0.82, "raster-saturation": -0.28, "raster-contrast": 0.12 },
      },
    ],
  };
}

function makeLocalStyle(theme: VisualTheme): StyleSpecification {
  return {
    version: 8,
    name: "方便一下离线底图",
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": theme === "light" ? "#e9efe9" : "#071019" },
      },
    ],
  };
}

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

const RATING_DIMENSIONS: Array<[keyof RatingScores, string]> = [
  ["hygiene", "卫生"],
  ["odor", "气味"],
  ["queue", "排队"],
  ["comfort", "舒适"],
  ["wayfinding", "指引"],
  ["facilities", "设施"],
];

const DEMO_STEPS = [
  ["00:00", "一句话", "上海厕所很多，但真正着急时，数据是不完整的。"],
  ["00:25", "看全城", "展示 941 个公开厕所点与离线 3D 上海轮廓。"],
  ["00:55", "找对厕所", "切换 24 小时、蹲厕、无障碍等筛选，未知字段不冒充已确认。"],
  ["01:25", "憋不住了", "启动四级降级：严选命中 → 放宽设施 → 最近公开点 → 人工求助。"],
  ["02:05", "数据飞轮", "评论提交楼层和方向，3 人确认后上线；小浣熊继续结构化帖子证据。"],
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
            sourceLabel: nullableString(comment.sourceLabel) ?? "用户导入",
            sourceUrl: nullableString(comment.sourceUrl),
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

function commentSourceLabel(comment: CommentRecord) {
  if (comment.sourceLabel) return comment.sourceLabel;
  if (comment.source === "xhs_note") return "笔记可见信息";
  if (comment.source === "xhs_aggregate") return "榜单聚合";
  if (comment.source === "mock") return "Mock 演示";
  if (comment.source === "session") return "现场补充";
  return "用户导入";
}

function withConsensusStatus(candidate: BuildingLocationCandidate): BuildingLocationCandidate {
  const confirmations = candidate.communityVerifications + candidate.demoVerifications;
  if (candidate.rejections >= 2 && candidate.rejections >= confirmations) {
    return { ...candidate, status: "disputed" };
  }
  if (confirmations >= candidate.requiredVerifications) {
    return {
      ...candidate,
      status: candidate.demoVerifications > 0 ? "published_demo" : "published",
    };
  }
  return { ...candidate, status: "collecting" };
}

function withClaimStatus(claim: CommunityClaim): CommunityClaim {
  const confirmations = claim.communityVerifications + claim.demoVerifications;
  if (claim.rejections >= 2 && claim.rejections >= confirmations) {
    return { ...claim, status: "disputed" };
  }
  if (confirmations >= claim.requiredVerifications) {
    return {
      ...claim,
      status: claim.demoVerifications > 0 ? "published_demo" : "published",
    };
  }
  return { ...claim, status: "collecting" };
}

function structureContributionText(text: string) {
  const structured: Record<string, string | number | boolean | null> = {};
  const floorMatch = text.match(/(?:B\d+|L?\d+\s*(?:F|楼|层))/i);
  if (floorMatch) structured.floor = floorMatch[0].replace(/\s+/g, "").toUpperCase();
  if (/东南侧/.test(text)) structured.zone = "东南侧";
  else if (/东北侧/.test(text)) structured.zone = "东北侧";
  else if (/西南侧/.test(text)) structured.zone = "西南侧";
  else if (/西北侧/.test(text)) structured.zone = "西北侧";
  if (/蹲厕|蹲坑/.test(text)) structured.squat = true;
  if (/无障碍/.test(text)) structured.accessible = !/没有无障碍|无无障碍/.test(text);
  if (/第三卫生间/.test(text)) structured.thirdRestroom = !/没有第三卫生间/.test(text);
  if (/关闭|停用|维修/.test(text)) structured.operationalStatus = "可能暂停开放";
  if (/24\s*小时|全天开放/.test(text)) structured.open24h = true;
  return structured;
}

function averageRating(scores: RatingScores) {
  return RATING_DIMENSIONS.reduce((sum, [key]) => sum + scores[key], 0) / RATING_DIMENSIONS.length;
}

function freshnessLabel(updatedAt: string | null) {
  if (!updatedAt) return "待核实";
  if (updatedAt === "刚刚" || updatedAt === "2026-08-15") return updatedAt === "刚刚" ? "刚刚" : "今天";
  return updatedAt;
}

function markerSizeForZoom(zoom: number) {
  const progress = Math.max(0, Math.min(1, (zoom - 7.6) / (17 - 7.6)));
  return 16 + Math.pow(progress, 0.72) * 10;
}

function clusterIconDataUri(cluster: ToiletClusterDatum, theme: VisualTheme) {
  const fill = theme === "light" ? "#007e8e" : "#16b8c7";
  const stroke = cluster.open24hCount > 0
    ? theme === "light" ? "#ff6848" : "#c8ff3d"
    : "#ffffff";
  const fontSize = cluster.count >= 100 ? 19 : cluster.count >= 10 ? 22 : 25;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72"><circle cx="36" cy="36" r="31" fill="${fill}" stroke="${stroke}" stroke-width="5"/><text x="36" y="37" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="${fontSize}" font-weight="700">${cluster.countLabel}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function makeLayers(
  records: ToiletRecord[],
  clusters: ToiletClusterDatum[],
  boundary: BoundaryData | null,
  selectedId: string | null,
  mode: MapMode,
  theme: VisualTheme,
  zoom: number,
) {
  const markerSize = markerSizeForZoom(zoom);
  const layers = [
    boundary
      ? new GeoJsonLayer({
          id: "shanghai-boundary",
          data: boundary as never,
          filled: true,
          stroked: true,
          extruded: true,
          getElevation: 45,
          getFillColor: theme === "light"
            ? mode === "online" ? [243, 237, 220, 22] : [222, 235, 227, 175]
            : mode === "online" ? [10, 35, 43, 52] : [10, 35, 43, 175],
          getLineColor: theme === "light" ? [0, 122, 137, 150] : [75, 232, 219, 210],
          getLineWidth: 2,
          lineWidthMinPixels: 1.4,
          pickable: false,
        })
      : null,
    new IconLayer<ToiletClusterDatum>({
      id: "toilet-clusters",
      data: clusters,
      getPosition: (cluster) => [...cluster.coordinates, MARKER_SURFACE_ALTITUDE],
      getIcon: (cluster) => ({
        url: clusterIconDataUri(cluster, theme),
        width: 72,
        height: 72,
        anchorX: 36,
        anchorY: 72,
      }),
      getSize: (cluster) => 39 + Math.min(15, Math.log2(cluster.count) * 2.2),
      sizeUnits: "pixels",
      sizeMinPixels: 40,
      sizeMaxPixels: 56,
      billboard: true,
      alphaCutoff: 0.05,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 55],
    }),
    new IconLayer<ToiletRecord>({
      id: "toilet-location-pins",
      data: records,
      getPosition: (record) => [record.coordinates.longitude, record.coordinates.latitude, MARKER_SURFACE_ALTITUDE],
      getIcon: () => ({
        url: "/assets/toilet-pin.png",
        width: 64,
        height: 80,
        anchorY: 80,
        mask: true,
      }),
      getSize: (record) => markerSize + (record.id === selectedId ? 6 : 0),
      sizeUnits: "pixels",
      sizeMinPixels: 15,
      sizeMaxPixels: 32,
      getColor: (record) => {
        if (record.sourceType === "premium_xhs") return [245, 168, 36, 238];
        if (record.sourceType === "user_import") return [154, 127, 240, 232];
        if (record.open24h === true) return theme === "light" ? [255, 99, 71, 238] : [190, 255, 61, 220];
        return theme === "light" ? [0, 146, 162, 220] : [66, 221, 238, 205];
      },
      billboard: true,
      alphaCutoff: 0.05,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 90],
    }),
  ];
  return layers.filter(Boolean) as Array<GeoJsonLayer | IconLayer<ToiletClusterDatum> | IconLayer<ToiletRecord>>;
}

function ToiletMap({
  records,
  boundary,
  selectedId,
  mode,
  theme,
  onSelect,
  onOnlineFailure,
}: {
  records: ToiletRecord[];
  boundary: BoundaryData | null;
  selectedId: string | null;
  mode: MapMode;
  theme: VisualTheme;
  onSelect: (record: ToiletRecord) => void;
  onOnlineFailure: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [mapZoom, setMapZoom] = useState(9.1);

  const { clusterIndex, priorityRecords } = useMemo(() => {
    const priority = records.filter((record) => record.id === selectedId || record.sourceType !== "public_open_data");
    const clusterable = records.filter((record) => record.id !== selectedId && record.sourceType === "public_open_data");
    const index = new Supercluster<ClusterPointProperties, ClusterSummary>({
      radius: 56,
      maxZoom: 12,
      minPoints: 3,
      map: (properties) => ({ open24hCount: properties.record.open24h === true ? 1 : 0 }),
      reduce: (summary, properties) => {
        summary.open24hCount += properties.open24hCount;
      },
    });
    index.load(clusterable.map((record) => ({
      type: "Feature" as const,
      properties: { record },
      geometry: {
        type: "Point" as const,
        coordinates: [record.coordinates.longitude, record.coordinates.latitude],
      },
    })));
    return { clusterIndex: index, priorityRecords: priority };
  }, [records, selectedId]);

  const { clusters, pinRecords } = useMemo(() => {
    const visiblePins = [...priorityRecords];
    const visibleClusters: ToiletClusterDatum[] = [];
    for (const feature of clusterIndex.getClusters(SHANGHAI_BBOX, Math.floor(mapZoom))) {
      if ("cluster" in feature.properties && feature.properties.cluster === true) {
        visibleClusters.push({
          kind: "cluster",
          clusterId: feature.properties.cluster_id,
          count: feature.properties.point_count,
          countLabel: String(feature.properties.point_count_abbreviated),
          open24hCount: feature.properties.open24hCount,
          coordinates: feature.geometry.coordinates as [number, number],
        });
      } else if ("record" in feature.properties) {
        visiblePins.push(feature.properties.record);
      }
    }
    return { clusters: visibleClusters, pinRecords: visiblePins };
  }, [clusterIndex, priorityRecords, mapZoom]);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mode === "online" ? makeOnlineStyle(theme) : makeLocalStyle(theme),
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
    });
    mapRef.current = map;
    overlayRef.current = overlay;

    let zoomFrame: number | null = null;
    const syncZoom = () => {
      if (zoomFrame !== null) window.cancelAnimationFrame(zoomFrame);
      zoomFrame = window.requestAnimationFrame(() => {
        zoomFrame = null;
        setMapZoom(map.getZoom());
      });
    };
    map.on("zoom", syncZoom);

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
    const styleTimer = window.setTimeout(() => {
      if (mode === "online" && (!map.isStyleLoaded() || !map.areTilesLoaded())) failOnline();
    }, 9000);

    return () => {
      window.clearTimeout(styleTimer);
      map.off("zoom", syncZoom);
      if (zoomFrame !== null) window.cancelAnimationFrame(zoomFrame);
      overlayRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, [mode, theme, onOnlineFailure, onSelect]);

  useEffect(() => {
    overlayRef.current?.setProps({
      layers: makeLayers(pinRecords, clusters, boundary, selectedId, mode, theme, mapZoom),
      onClick: (info: PickingInfo<MapPickDatum>) => {
        if (!info.object) return;
        if (isClusterDatum(info.object)) {
          mapRef.current?.easeTo({
            center: info.object.coordinates,
            zoom: Math.min(clusterIndex.getClusterExpansionZoom(info.object.clusterId), 17),
            duration: 650,
          });
        } else {
          onSelect(info.object);
        }
      },
      getTooltip: (info: PickingInfo<MapPickDatum>) => {
        if (!info.object) return null;
        const text = isClusterDatum(info.object)
          ? `${info.object.count} 个厕所\n${info.object.open24hCount ? `其中 ${info.object.open24hCount} 个确认 24 小时\n` : ""}点击展开`
          : `${info.object.name}\n${info.object.district ?? "区域待核实"} · ${info.object.open24h === true ? "24 小时" : "开放时间待核实"}`;
        return {
          text,
          style: {
            backgroundColor: "#0b1722",
            color: "#f4f8f6",
            border: "1px solid #2c4854",
            borderRadius: "2px",
            fontSize: "12px",
          },
        };
      },
    });
  }, [pinRecords, clusters, clusterIndex, boundary, selectedId, mode, theme, mapZoom, onSelect]);

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

type CommunityClaimDraft = {
  kind: CommunityClaim["kind"];
  toiletId: string | null;
  toiletName: string;
  summary: string;
  structuredData: CommunityClaim["structuredData"];
  newToilet?: {
    district: string | null;
    address: string | null;
    longitude: number;
    latitude: number;
    floor: string | null;
    zone: string | null;
  };
};

type CommunityHubModalProps = {
  selected: ToiletRecord | null;
  initialTab: CommunityHubTab;
  locationCandidates: BuildingLocationCandidate[];
  claims: CommunityClaim[];
  ratings: CommunityRating[];
  auditLog: AuditEvent[];
  candidateVotes: Record<string, "confirm" | "reject">;
  claimVotes: Record<string, "confirm" | "reject">;
  onClose: () => void;
  onSubmitRating: (scores: RatingScores, note: string) => void;
  onSubmitClaim: (draft: CommunityClaimDraft) => void;
  onVoteLocation: (candidateId: string, vote: "confirm" | "reject") => void;
  onSimulateLocation: (candidateId: string) => void;
  onVoteClaim: (claimId: string, vote: "confirm" | "reject") => void;
  onSimulateClaim: (claimId: string) => void;
};

function CommunityHubModal({
  selected,
  initialTab,
  locationCandidates,
  claims,
  ratings,
  auditLog,
  candidateVotes,
  claimVotes,
  onClose,
  onSubmitRating,
  onSubmitClaim,
  onVoteLocation,
  onSimulateLocation,
  onVoteClaim,
  onSimulateClaim,
}: CommunityHubModalProps) {
  const [activeTab, setActiveTab] = useState<CommunityHubTab>(initialTab);
  const [kind, setKind] = useState<ContributionKind>("rating");
  const [scores, setScores] = useState<RatingScores>({ hygiene: 4, odor: 4, queue: 3, comfort: 4, wayfinding: 3, facilities: 4 });
  const [note, setNote] = useState("");
  const [claimText, setClaimText] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newName, setNewName] = useState("");
  const [newDistrict, setNewDistrict] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newLongitude, setNewLongitude] = useState("121.4737");
  const [newLatitude, setNewLatitude] = useState("31.2304");
  const [newFloor, setNewFloor] = useState("");
  const [newZone, setNewZone] = useState("");
  const [submittedNotice, setSubmittedNotice] = useState<string | null>(null);
  const structuredPreview = useMemo(() => structureContributionText(claimText), [claimText]);
  const selectedRatings = ratings.filter((rating) => rating.toiletId === selected?.id);

  const submitContribution = (event: React.FormEvent) => {
    event.preventDefault();
    if (kind === "rating") {
      if (!selected) return;
      onSubmitRating(scores, note.trim());
      setSubmittedNotice("评分已保存到本次会话，并写入版本记录。 ");
      return;
    }
    if (kind === "new_toilet") {
      const longitude = Number(newLongitude);
      const latitude = Number(newLatitude);
      if (!newName.trim() || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
      onSubmitClaim({
        kind: "new_toilet",
        toiletId: null,
        toiletName: newName.trim(),
        summary: newDescription.trim() || `${newName.trim()}新厕所入库申请`,
        structuredData: {
          name: newName.trim(),
          district: newDistrict.trim() || null,
          address: newAddress.trim() || null,
          longitude,
          latitude,
          floor: newFloor.trim() || null,
          zone: newZone.trim() || null,
        },
        newToilet: {
          district: newDistrict.trim() || null,
          address: newAddress.trim() || null,
          longitude,
          latitude,
          floor: newFloor.trim() || null,
          zone: newZone.trim() || null,
        },
      });
      setSubmittedNotice("新厕所已进入验证中心，达到 3 人共识前不会进入紧急推荐。 ");
      return;
    }
    if (!selected || !claimText.trim()) return;
    onSubmitClaim({
      kind,
      toiletId: selected.id,
      toiletName: selected.name,
      summary: claimText.trim(),
      structuredData: structuredPreview,
    });
    setSubmittedNotice("信息已结构化并进入验证中心。 ");
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card community-hub-modal" role="dialog" aria-modal="true" aria-labelledby="community-hub-title">
        <button className="icon-button modal-close" onClick={onClose} aria-label="关闭" title="关闭"><X size={18} /></button>
        <div className="eyebrow"><Users size={14} /> COMMUNITY DATA LOOP</div>
        <h2 id="community-hub-title">厕所共建中心</h2>
        <p className="modal-lead">评论不是终点：AI 把自然语言变成候选数据，多位用户确认后再进入正式地图。</p>
        <div className="community-hub-tabs" role="tablist">
          <button className={activeTab === "contribute" ? "is-active" : ""} onClick={() => setActiveTab("contribute")}><Send size={14} /> 我要共建</button>
          <button className={activeTab === "verify" ? "is-active" : ""} onClick={() => setActiveTab("verify")}><ListChecks size={14} /> 验证中心 <span>{locationCandidates.filter((item) => item.status === "collecting").length + claims.filter((item) => item.status === "collecting").length}</span></button>
          <button className={activeTab === "history" ? "is-active" : ""} onClick={() => setActiveTab("history")}><History size={14} /> 版本历史</button>
        </div>

        {activeTab === "contribute" ? <form className="community-contribution-form" onSubmit={submitContribution}>
          <div className="contribution-kind-tabs">
            {([
              ["rating", "厕所打分"],
              ["fact_update", "补充信息"],
              ["status_report", "状态报告"],
              ["new_toilet", "新增厕所"],
            ] as const).map(([value, label]) => <button type="button" key={value} className={kind === value ? "is-active" : ""} onClick={() => { setKind(value); setSubmittedNotice(null); }}>{label}</button>)}
          </div>

          {kind !== "new_toilet" ? <div className="selected-contribution-target"><MapPin size={14} /><span>{selected?.name ?? "请先在地图选择一个厕所"}</span></div> : null}

          {kind === "rating" ? <div className="rating-editor">
            <div className="rating-summary"><strong>{averageRating(scores).toFixed(1)}</strong><span>本次六维评分</span><small>{selectedRatings.length} 条会话评分已存在</small></div>
            <div className="rating-dimension-list">{RATING_DIMENSIONS.map(([key, label]) => <label key={key}><span>{label}</span><input type="range" min="1" max="5" step="1" value={scores[key]} onChange={(event) => setScores((current) => ({ ...current, [key]: Number(event.target.value) }))} /><strong>{scores[key]}</strong></label>)}</div>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="补充一句体验说明，可选填" />
          </div> : null}

          {kind === "fact_update" || kind === "status_report" ? <div className="claim-editor">
            <label><span>{kind === "fact_update" ? "用自然语言补充事实" : "报告关闭、维修或状态变化"}</span><textarea required value={claimText} onChange={(event) => setClaimText(event.target.value)} placeholder={kind === "fact_update" ? "例如：5楼东南侧，扶梯下来右转，有蹲厕和无障碍间" : "例如：B1 厕所正在维修，今天暂时关闭"} /></label>
            <div className="ai-structure-preview"><div><Sparkles size={14} /><strong>AI 结构化预览</strong></div>{Object.keys(structuredPreview).length ? <div className="structured-chip-row">{Object.entries(structuredPreview).map(([key, value]) => <span key={key}>{key}: {String(value)}</span>)}</div> : <p>输入楼层、方向、设施或开放状态后自动提取。</p>}</div>
          </div> : null}

          {kind === "new_toilet" ? <div className="new-toilet-editor">
            <div className="community-form-grid"><label><span>厕所/建筑名称</span><input required value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="例如：人民广场地铁站公共厕所" /></label><label><span>行政区</span><input value={newDistrict} onChange={(event) => setNewDistrict(event.target.value)} placeholder="例如：黄浦区" /></label></div>
            <label><span>地址或入口</span><input value={newAddress} onChange={(event) => setNewAddress(event.target.value)} placeholder="建筑、入口或附近地标" /></label>
            <div className="community-form-grid"><label><span>经度</span><input required inputMode="decimal" value={newLongitude} onChange={(event) => setNewLongitude(event.target.value)} /></label><label><span>纬度</span><input required inputMode="decimal" value={newLatitude} onChange={(event) => setNewLatitude(event.target.value)} /></label></div>
            <div className="community-form-grid"><label><span>楼层</span><input value={newFloor} onChange={(event) => setNewFloor(event.target.value)} placeholder="如 B1 / 5F" /></label><label><span>楼内方位</span><input value={newZone} onChange={(event) => setNewZone(event.target.value)} placeholder="如东南侧 / 近电梯" /></label></div>
            <label><span>发现说明</span><textarea value={newDescription} onChange={(event) => setNewDescription(event.target.value)} placeholder="说明怎么找到、是否开放以及现场设施" /></label>
            <p className="coordinate-warning"><CircleAlert size={13} /> 当前预填人民广场演示坐标；真实投稿必须使用现场位置。</p>
          </div> : null}

          {submittedNotice ? <div className="community-submit-notice"><CircleCheck size={14} /> {submittedNotice}</div> : null}
          <button className="primary-button community-submit-button" type="submit" disabled={kind !== "new_toilet" && !selected}><Send size={15} /> {kind === "rating" ? "提交评分" : "提交到验证中心"}</button>
        </form> : null}

        {activeTab === "verify" ? <div className="verification-center">
          <div className="verification-summary"><div><strong>{locationCandidates.length + claims.length}</strong><span>全部任务</span></div><div><strong>{locationCandidates.filter((item) => item.status === "collecting").length + claims.filter((item) => item.status === "collecting").length}</strong><span>等待共识</span></div><div><strong>3</strong><span>上线门槛</span></div></div>
          {!locationCandidates.length && !claims.length ? <p className="empty-copy">暂无验证任务。先提交一条厕所信息。</p> : null}
          <div className="verification-task-list">
            {locationCandidates.map((candidate) => {
              const total = candidate.communityVerifications + candidate.demoVerifications;
              const done = candidate.status === "published" || candidate.status === "published_demo";
              return <article key={candidate.id} className={`verification-task status-${candidate.status}`}><div className="verification-task-head"><span>楼内位置</span><small>{candidate.status === "published_demo" ? "演示上线" : done ? "已上线" : candidate.status === "disputed" ? "有争议" : "待验证"}</small></div><h3>{candidate.buildingName} · {candidate.floor} · {candidate.zone}</h3><p>{candidate.directions ?? "路线说明待补充"}</p><div className="task-progress"><i style={{ width: `${Math.min(100, total / candidate.requiredVerifications * 100)}%` }} /></div><div className="task-count"><span>{total}/{candidate.requiredVerifications} 确认</span><span>真实 {candidate.communityVerifications} · 演示 {candidate.demoVerifications} · 反对 {candidate.rejections}</span></div><div className="task-actions"><button disabled={Boolean(candidateVotes[candidate.id]) || done} onClick={() => onVoteLocation(candidate.id, "confirm")}><Check size={13} />确认</button><button disabled={Boolean(candidateVotes[candidate.id]) || done} onClick={() => onVoteLocation(candidate.id, "reject")}><X size={13} />反对</button>{!done ? <button className="is-demo" onClick={() => onSimulateLocation(candidate.id)}>模拟下一位</button> : null}</div></article>;
            })}
            {claims.map((claim) => {
              const total = claim.communityVerifications + claim.demoVerifications;
              const done = claim.status === "published" || claim.status === "published_demo";
              return <article key={claim.id} className={`verification-task status-${claim.status}`}><div className="verification-task-head"><span>{claim.kind === "new_toilet" ? "新厕所入库" : claim.kind === "status_report" ? "状态报告" : "信息补充"}</span><small>{claim.status === "published_demo" ? "演示上线" : done ? "已上线" : claim.status === "disputed" ? "有争议" : "待验证"}</small></div><h3>{claim.toiletName}</h3><p>{claim.summary}</p>{Object.keys(claim.structuredData).length ? <div className="structured-chip-row">{Object.entries(claim.structuredData).slice(0, 6).map(([key, value]) => <span key={key}>{key}: {String(value)}</span>)}</div> : null}<div className="task-progress"><i style={{ width: `${Math.min(100, total / claim.requiredVerifications * 100)}%` }} /></div><div className="task-count"><span>{total}/{claim.requiredVerifications} 确认</span><span>真实 {claim.communityVerifications} · 演示 {claim.demoVerifications} · 反对 {claim.rejections}</span></div><div className="task-actions"><button disabled={Boolean(claimVotes[claim.id]) || done} onClick={() => onVoteClaim(claim.id, "confirm")}><Check size={13} />确认</button><button disabled={Boolean(claimVotes[claim.id]) || done} onClick={() => onVoteClaim(claim.id, "reject")}><X size={13} />反对</button>{!done ? <button className="is-demo" onClick={() => onSimulateClaim(claim.id)}>模拟下一位</button> : null}</div></article>;
            })}
          </div>
        </div> : null}

        {activeTab === "history" ? <div className="audit-timeline">
          {auditLog.map((event) => <article key={event.id} className={`audit-event source-${event.source}`}><span className="audit-dot" /><div><div className="audit-event-head"><strong>{event.title}</strong><small>{event.createdAt}</small></div><p>{event.detail}</p><span>{event.actor} · {event.source === "demo" ? "演示事件" : event.source === "session" ? "本次会话" : "系统记录"}</span></div></article>)}
        </div> : null}
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
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>("online");
  const [visualTheme, setVisualTheme] = useState<VisualTheme>("dark");
  const [mapNotice, setMapNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [communityHubOpen, setCommunityHubOpen] = useState(false);
  const [communityHubTab, setCommunityHubTab] = useState<CommunityHubTab>("contribute");
  const [healthHistory, setHealthHistory] = useState(0);
  const [userLocation, setUserLocation] = useState<[number, number]>(SHANGHAI_CENTER);
  const [locationLabel, setLocationLabel] = useState("人民广场演示点");
  const [sessionComments, setSessionComments] = useState<Record<string, CommentRecord[]>>({});
  const [commentDraft, setCommentDraft] = useState("");
  const [locationCandidates, setLocationCandidates] = useState<BuildingLocationCandidate[]>([]);
  const [candidateVotes, setCandidateVotes] = useState<Record<string, "confirm" | "reject">>({});
  const [communityRatings, setCommunityRatings] = useState<CommunityRating[]>([]);
  const [communityClaims, setCommunityClaims] = useState<CommunityClaim[]>([]);
  const [claimVotes, setClaimVotes] = useState<Record<string, "confirm" | "reject">>({});
  const [auditLog, setAuditLog] = useState<AuditEvent[]>([
    { id: "audit-seed-indoor", toiletId: "premium-xhs-07-venue-huijin-xujiahui", type: "contribution", title: "楼内位置进入候选池", detail: "汇金百货 5F 东南侧由榜单聚合线索提取，等待社区现场确认。", actor: "结构化引擎", source: "system", createdAt: "今天 16:30" },
    { id: "audit-seed-import", toiletId: null, type: "import", title: "12 个榜单场所完成匹配", detail: "榜单场所与公开厕所保持独立，具体楼层继续待核实。", actor: "数据管道", source: "system", createdAt: "今天 15:55" },
  ]);
  const [locationFormOpen, setLocationFormOpen] = useState(false);
  const [locationFloor, setLocationFloor] = useState("");
  const [locationZone, setLocationZone] = useState("");
  const [locationDirections, setLocationDirections] = useState("");
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
      fetch("/data/building-location-candidates.json").then((response) => {
        if (!response.ok) throw new Error("楼内位置候选读取失败");
        return response.json() as Promise<BuildingLocationDataset>;
      }),
    ])
      .then(([publicData, premiumData, boundaryData, locationData]) => {
        if (!active) return;
        setPublicRecords(publicData.records);
        setPremiumRecords(premiumData.records);
        setPremiumStatus(premiumData.status);
        setPublicMeta(publicData);
        setBoundary(boundaryData);
        setLocationCandidates(locationData.records.map(withConsensusStatus));
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
      if (filters.source === "premium" && record.sourceType === "public_open_data") return false;
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

  const activeFilterCount = [
    filters.query.trim().length > 0,
    filters.district !== "全部区域",
    filters.opening !== "all",
    filters.source !== "all",
    filters.squat,
    filters.seated,
    filters.accessible,
    filters.thirdRestroom,
  ].filter(Boolean).length;

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
    const emergencyEligible = (record: ToiletRecord) => !record.tags.includes("演示上线") && !record.tags.includes("新厕所候选");
    return [
      { level: 1, title: "严选命中", note: "保留全部当前筛选", result: nearest(filteredRecords.filter(emergencyEligible)), tone: "safe" },
      { level: 2, title: "放宽设施", note: "只保留 24 小时优先", result: nearest(allRecords.filter((record) => record.open24h === true && emergencyEligible(record))), tone: "lime" },
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
      sourceLabel: "现场补充",
      sourceUrl: null,
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
  const evidenceCommentCount = comments.filter((comment) => comment.source === "xhs_note" || comment.source === "xhs_aggregate").length;
  const mockCommentCount = comments.filter((comment) => comment.source === "mock").length;
  const selectedLocationCandidates = selected
    ? locationCandidates.filter((candidate) => candidate.toiletId === selected.id)
    : [];
  const publishedIndoorLocation = selectedLocationCandidates.find(
    (candidate) => candidate.status === "published" || candidate.status === "published_demo",
  ) ?? null;
  const selectedCommunityRatings = selected
    ? communityRatings.filter((rating) => rating.toiletId === selected.id && rating.source !== "mock")
    : [];
  const selectedCommunityScore = selectedCommunityRatings.length
    ? selectedCommunityRatings.reduce((sum, rating) => sum + rating.average, 0) / selectedCommunityRatings.length
    : null;
  const selectedDimensionScores = RATING_DIMENSIONS.map(([key, label]) => ({
    key,
    label,
    value: selectedCommunityRatings.length
      ? selectedCommunityRatings.reduce((sum, rating) => sum + rating.scores[key], 0) / selectedCommunityRatings.length
      : null,
  }));

  const recordAudit = (event: AuditEvent) => {
    setAuditLog((current) => [event, ...current]);
  };

  const openCommunityHub = (tab: CommunityHubTab) => {
    setCommunityHubTab(tab);
    setCommunityHubOpen(true);
  };

  const submitIndoorLocation = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !locationFloor.trim() || !locationZone.trim()) return;
    const candidateId = `indoor-session-${Date.now()}`;
    const floor = locationFloor.trim();
    const zone = locationZone.trim();
    const directions = locationDirections.trim() || null;
    const comment: CommentRecord = {
      id: `session-location-${Date.now()}`,
      author: "本次演示",
      content: `楼内位置投稿：${floor} · ${zone}${directions ? ` · ${directions}` : ""}`,
      createdAt: "刚刚",
      source: "session",
      sourceLabel: "位置投稿 · 待验证",
      sourceUrl: null,
    };
    const candidate: BuildingLocationCandidate = {
      id: candidateId,
      toiletId: selected.id,
      buildingName: selected.name.replace(" · 榜单厕所", ""),
      floor,
      zone,
      directions,
      source: "community",
      sourceLabel: "评论区结构化投稿",
      sourceUrl: null,
      sourceCommentId: comment.id,
      status: "collecting",
      communityVerifications: 0,
      demoVerifications: 0,
      rejections: 0,
      requiredVerifications: 3,
      createdAt: "刚刚",
    };
    setSessionComments((current) => ({
      ...current,
      [selected.id]: [...(current[selected.id] ?? []), comment],
    }));
    setLocationCandidates((current) => [...current, candidate]);
    setLocationFloor("");
    setLocationZone("");
    setLocationDirections("");
    setLocationFormOpen(false);
    recordAudit({ id: `audit-${candidateId}`, toiletId: selected.id, type: "contribution", title: "提交楼内位置候选", detail: `${floor} · ${zone}${directions ? ` · ${directions}` : ""}`, actor: "本次演示", source: "session", createdAt: "刚刚" });
  };

  const voteOnLocation = (candidateId: string, vote: "confirm" | "reject") => {
    if (candidateVotes[candidateId]) return;
    const candidate = locationCandidates.find((item) => item.id === candidateId);
    if (!candidate) return;
    const next = withConsensusStatus({
      ...candidate,
      communityVerifications: candidate.communityVerifications + (vote === "confirm" ? 1 : 0),
      rejections: candidate.rejections + (vote === "reject" ? 1 : 0),
    });
    setCandidateVotes((current) => ({ ...current, [candidateId]: vote }));
    setLocationCandidates((current) => current.map((item) => item.id === candidateId ? next : item));
    recordAudit({ id: `audit-location-vote-${candidateId}-${auditLog.length}`, toiletId: candidate.toiletId, type: next.status === "published" || next.status === "published_demo" ? "publish" : "verification", title: vote === "confirm" ? "确认楼内位置" : "反对楼内位置", detail: `${candidate.buildingName} · ${candidate.floor} · ${candidate.zone}${next.status === "published_demo" ? "已达到演示上线门槛" : ""}`, actor: "现场用户", source: next.status === "published_demo" ? "demo" : "session", createdAt: "刚刚" });
  };

  const simulateNextVerifier = (candidateId: string) => {
    const candidate = locationCandidates.find((item) => item.id === candidateId);
    if (!candidate) return;
    const total = candidate.communityVerifications + candidate.demoVerifications;
    if (total >= candidate.requiredVerifications) return;
    const next = withConsensusStatus({ ...candidate, demoVerifications: candidate.demoVerifications + 1 });
    setLocationCandidates((current) => current.map((item) => item.id === candidateId ? next : item));
    recordAudit({ id: `audit-location-demo-${candidateId}-${auditLog.length}`, toiletId: candidate.toiletId, type: next.status === "published_demo" ? "publish" : "verification", title: next.status === "published_demo" ? "楼内位置演示上线" : "增加一位演示验证者", detail: `${candidate.buildingName} · ${candidate.floor} · ${candidate.zone}`, actor: "演示验证者", source: "demo", createdAt: "刚刚" });
  };

  const submitCommunityRating = (scores: RatingScores, note: string) => {
    if (!selected) return;
    const rating: CommunityRating = { id: `rating-${selected.id}-${communityRatings.length + 1}`, toiletId: selected.id, scores, average: averageRating(scores), note: note || null, source: "session", author: "本次演示", createdAt: "刚刚" };
    setCommunityRatings((current) => [...current, rating]);
    if (note) {
      setSessionComments((current) => ({ ...current, [selected.id]: [...(current[selected.id] ?? []), { id: `rating-comment-${rating.id}`, author: "本次演示", content: note, createdAt: "刚刚", source: "session", sourceLabel: `六维评分 ${rating.average.toFixed(1)}`, sourceUrl: null }] }));
    }
    recordAudit({ id: `audit-${rating.id}`, toiletId: selected.id, type: "contribution", title: `提交六维评分 ${rating.average.toFixed(1)}`, detail: RATING_DIMENSIONS.map(([key, label]) => `${label}${scores[key]}`).join(" · "), actor: "本次演示", source: "session", createdAt: "刚刚" });
  };

  const submitCommunityClaim = (draft: CommunityClaimDraft) => {
    const claimId = `claim-${communityClaims.length + 1}`;
    const proposedToilet = draft.kind === "new_toilet" && draft.newToilet ? {
      id: `community-toilet-${communityClaims.length + 1}`,
      sourceType: "user_import" as const,
      sourceName: "社区共建投稿",
      sourceUrl: null,
      sourceRef: claimId,
      dataStatus: "community_report" as const,
      name: draft.toiletName,
      district: draft.newToilet.district,
      address: draft.newToilet.address,
      coordinates: { longitude: draft.newToilet.longitude, latitude: draft.newToilet.latitude },
      openingHours: null,
      open24h: null,
      facility: { squat: null, seated: null, accessible: null, thirdRestroom: null, babyCare: null },
      crowd: null,
      tags: ["社区共建", "新厕所候选", ...(draft.newToilet.floor ? [draft.newToilet.floor] : []), ...(draft.newToilet.zone ? [draft.newToilet.zone] : [])],
      rating: null,
      reviewCount: null,
      healthScore: null,
      confidence: null,
      description: draft.summary,
      comments: [{ id: `claim-comment-${claimId}`, author: "本次演示", content: draft.summary, createdAt: "刚刚", source: "session" as const, sourceLabel: "新厕所投稿", sourceUrl: null }],
      updatedAt: "刚刚",
    } satisfies ToiletRecord : null;
    const claim: CommunityClaim = { id: claimId, toiletId: draft.toiletId, toiletName: draft.toiletName, kind: draft.kind, summary: draft.summary, structuredData: draft.structuredData, proposedToilet, status: "collecting", communityVerifications: 0, demoVerifications: 0, rejections: 0, requiredVerifications: 3, createdAt: "刚刚" };
    setCommunityClaims((current) => [...current, claim]);
    recordAudit({ id: `audit-${claimId}`, toiletId: draft.toiletId, type: "contribution", title: draft.kind === "new_toilet" ? "提交新厕所入库" : draft.kind === "status_report" ? "提交状态报告" : "提交信息补充", detail: draft.summary, actor: "本次演示", source: "session", createdAt: "刚刚" });
  };

  const publishClaimToMap = (claim: CommunityClaim) => {
    if (!claim.proposedToilet) return;
    setPremiumRecords((current) => current.some((record) => record.id === claim.proposedToilet?.id) ? current : [...current, { ...claim.proposedToilet, sourceName: claim.status === "published_demo" ? "社区共建 · 演示上线" : "社区共建 · 已验证", tags: [...claim.proposedToilet.tags.filter((tag) => tag !== "新厕所候选"), claim.status === "published_demo" ? "演示上线" : "社区已验证"] }]);
  };

  const voteOnClaim = (claimId: string, vote: "confirm" | "reject") => {
    if (claimVotes[claimId]) return;
    const claim = communityClaims.find((item) => item.id === claimId);
    if (!claim) return;
    const next = withClaimStatus({ ...claim, communityVerifications: claim.communityVerifications + (vote === "confirm" ? 1 : 0), rejections: claim.rejections + (vote === "reject" ? 1 : 0) });
    setClaimVotes((current) => ({ ...current, [claimId]: vote }));
    setCommunityClaims((current) => current.map((item) => item.id === claimId ? next : item));
    if (next.status === "published" || next.status === "published_demo") publishClaimToMap(next);
    recordAudit({ id: `audit-claim-vote-${claimId}-${auditLog.length}`, toiletId: claim.toiletId, type: next.status.startsWith("published") ? "publish" : "verification", title: vote === "confirm" ? "确认共建候选" : "反对共建候选", detail: claim.summary, actor: "现场用户", source: next.status === "published_demo" ? "demo" : "session", createdAt: "刚刚" });
  };

  const simulateNextClaimVerifier = (claimId: string) => {
    const claim = communityClaims.find((item) => item.id === claimId);
    if (!claim) return;
    const total = claim.communityVerifications + claim.demoVerifications;
    if (total >= claim.requiredVerifications) return;
    const next = withClaimStatus({ ...claim, demoVerifications: claim.demoVerifications + 1 });
    setCommunityClaims((current) => current.map((item) => item.id === claimId ? next : item));
    if (next.status === "published_demo") publishClaimToMap(next);
    recordAudit({ id: `audit-claim-demo-${claimId}-${auditLog.length}`, toiletId: claim.toiletId, type: next.status === "published_demo" ? "publish" : "verification", title: next.status === "published_demo" ? "候选完成演示上线" : "增加一位演示验证者", detail: claim.summary, actor: "演示验证者", source: "demo", createdAt: "刚刚" });
  };

  return (
    <div className={`app-shell theme-${visualTheme}`}>
      <header className="topbar">
        <button className="brand" onClick={() => setFilters(EMPTY_FILTERS)} aria-label="重置并返回全城地图">
          <span className="brand-mark"><Toilet size={23} /></span>
          <span><strong>方便一下</strong><small>SHANGHAI RELIEF MAP</small></span>
        </button>
        <div className="topbar-pulse"><span className="live-dot" /> {loading ? "正在接入城市数据" : `${publicRecords.length} 个公开点已就绪`}</div>
        <a className="main-site-link" href="https://w3xuan.xyz" aria-label="返回 w3xuan.xyz 主站">
          <House size={15} /> 返回主站
        </a>
        <nav className="top-actions" aria-label="主要操作">
          <button className="status-button theme-button" onClick={() => setVisualTheme((current) => current === "light" ? "dark" : "light")} aria-label={`切换为${visualTheme === "light" ? "暗色" : "亮色"}模式`}>
            {visualTheme === "light" ? <Sun size={15} /> : <Moon size={15} />} {visualTheme === "light" ? "亮色" : "暗色"}
          </button>
          <button className={`status-button map-mode-button ${mapMode === "offline" ? "is-offline" : ""}`} onClick={() => setMapMode((current) => current === "online" ? "offline" : "online")}>
            {mapMode === "online" ? <Wifi size={15} /> : <WifiOff size={15} />}
            {mapMode === "online" ? "在线底图" : "离线概念图"}
          </button>
          <button className="header-button community-button" onClick={() => openCommunityHub("contribute")}><Users size={16} /> 我要共建</button>
          <button className="header-button" onClick={() => openCommunityHub("verify")}><ListChecks size={16} /> 验证中心 <span className="header-count">{locationCandidates.filter((item) => item.status === "collecting").length + communityClaims.filter((item) => item.status === "collecting").length}</span></button>
          <button className="header-button import-button" onClick={() => fileRef.current?.click()}><Upload size={16} /> 导入榜单 JSON</button>
          <button className="header-button is-accent" onClick={() => setDemoOpen(true)}><Sparkles size={16} /> 3 分钟演示</button>
          <input ref={fileRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImport(file); event.currentTarget.value = ""; }} />
        </nav>
      </header>

      <main className="dashboard-grid">
        <aside className="left-rail">
          <section className="control-section">
            <div className="section-heading filter-section-heading">
              <span><SlidersHorizontal size={15} /> 任务参数</span>
              <div className="filter-heading-actions">
                {activeFilterCount > 0 && <button className="text-action" onClick={() => setFilters(EMPTY_FILTERS)}>重置</button>}
                <button className="filter-toggle" aria-expanded={filterPanelOpen} aria-controls="task-parameter-controls" onClick={() => setFilterPanelOpen((current) => !current)}>
                  {filterPanelOpen ? "收起" : "展开"}<ChevronRight size={14} />
                </button>
              </div>
            </div>
            {!filterPanelOpen && <button className="filter-collapsed-summary" aria-label="展开任务参数" onClick={() => setFilterPanelOpen(true)}>
              <span><strong>{filteredRecords.length}</strong><small>当前命中</small></span>
              <span><b>{activeFilterCount > 0 ? `${activeFilterCount} 项筛选已启用` : "尚未设置筛选"}</b><small>点击展开搜索与设施条件</small></span>
              <ChevronRight size={16} />
            </button>}
            <div id="task-parameter-controls" className="filter-controls" hidden={!filterPanelOpen}>
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
            </div>
          </section>

          <section className="data-panel">
            <div className="section-heading"><span><Database size={15} /> 数据雷达</span><span className="mini-badge">LIVE</span></div>
            <div className="data-stat-row"><span><i className="legend-column public" />公开厕所</span><strong>{publicRecords.length}</strong></div>
            <div className="data-stat-row"><span><i className="legend-column premium" />优质榜单</span><strong>{premiumRecords.length}</strong></div>
            <div className="data-stat-row"><span><i className="legend-column open" />确认 24h</span><strong>{publicRecords.filter((record) => record.open24h === true).length}</strong></div>
            <div className="data-stat-row"><span><i className="legend-column community" />待验证任务</span><strong>{locationCandidates.filter((item) => item.status === "collecting").length + communityClaims.filter((item) => item.status === "collecting").length}</strong></div>
            <p className="source-note">{publicMeta?.license ?? "正在读取来源许可"}</p>
          </section>

          <section className="premium-panel">
            <div className="section-heading"><span><Star size={15} /> 榜单与社区上线</span><span className={`mini-badge ${premiumStatus === "ready" ? "is-ready" : ""}`}>{premiumStatus === "ready" ? "READY" : "PENDING"}</span></div>
            {premiumRecords.length ? (
              <>
                <div className="premium-match-note"><CircleCheck size={16} /><span><strong>{premiumRecords.length} 个榜单/社区点已上线</strong><small>金色为榜单，紫色为社区演示上线</small></span></div>
                <div className="premium-list">{premiumRecords.map((record, index) => <button key={record.id} onClick={() => setSelectedId(record.id)}><span>{index + 1}</span><div><strong>{record.name}</strong><small>{record.district ?? "区域待核实"} · {record.tags[1] ?? "榜单线索"}</small></div><ChevronRight size={15} /></button>)}</div>
              </>
            ) : (
              <div className="honest-empty"><Radar size={25} /><strong>榜单数据采集中</strong><p>没有帖子正文就不生成厕所，也不伪造评价。后续导入 JSON，金色 3D 柱会自动出现。</p><button onClick={() => fileRef.current?.click()}><Upload size={14} /> 导入真实数据</button></div>
            )}
            {importNotice && <p className="inline-notice">{importNotice}</p>}
          </section>
        </aside>

        <section className="map-stage">
          <div className="map-stage-top">
            <div><span className="map-kicker"><Layers3 size={14} /> SHANGHAI / 3D INTELLIGENCE</span><h1>全城厕所态势</h1></div>
            <div className="map-stage-actions">
              <div className="map-count"><strong>{filteredRecords.length}</strong><span>当前命中</span></div>
              <button className="panic-button" onClick={toggleEmergency}><Zap size={19} fill="currentColor" /><span><strong>憋不住了</strong><small>启动四级降级找厕</small></span><ChevronRight size={18} /></button>
            </div>
          </div>
          <div className="map-frame">
            {loading && <div className="map-loading"><Radar size={24} /><span>正在展开上海厕所情报网…</span></div>}
            {loadError && <div className="map-error"><CircleAlert size={20} /><div><strong>数据暂未载入</strong><p>{loadError}</p></div></div>}
            <ToiletMap records={filteredRecords} boundary={boundary} selectedId={visibleSelectedId} mode={mapMode} theme={MAP_VISUAL_THEME} onSelect={handleSelect} onOnlineFailure={handleMapFailure} />
            <div className="map-scanlines" aria-hidden="true" />
            <div className="map-location"><MapPin size={14} /><span>{locationLabel}</span><button onClick={locateUser} aria-label="获取我的位置" title="获取我的位置"><LocateFixed size={15} /></button></div>
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
            <div className="map-legend"><span><i className="dot-cluster" />聚合数量</span><span><i className="dot-lime" />24 小时</span><span><i className="dot-cyan" />公开数据</span><span><i className="dot-gold" />优质榜单</span><span><i className="dot-community" />社区上线</span></div>
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
                <div className="detail-badges"><span className={selected.open24h === true ? "is-open" : ""}><Clock3 size={13} /> {selected.open24h === true ? "24 小时" : selected.openingHours ?? "时间待核实"}</span><span><ShieldCheck size={13} /> 可信度 {selected.confidence === null ? "待核实" : `${Math.round(selected.confidence * 100)}%`}</span>{selected.nameStatus === "generated" || selected.nameStatus === "source_generic" ? <span><CircleAlert size={13} /> 名称待补充</span> : null}</div>
                {publishedIndoorLocation ? <div className={`published-indoor-location status-${publishedIndoorLocation.status}`}><Layers3 size={15} /><div><span>{publishedIndoorLocation.status === "published_demo" ? "演示上线位置" : "社区已上线位置"}</span><strong>{publishedIndoorLocation.floor} · {publishedIndoorLocation.zone}</strong></div></div> : null}
              </div>

              <div className="detail-score-strip">
                <div><span>体验评分</span><strong>{selectedCommunityScore === null ? "—" : selectedCommunityScore.toFixed(1)}</strong></div>
                <div><span>数据可信度</span><strong>{scoreLabel(selected)}</strong></div>
                <div><span>信息新鲜度</span><strong>{freshnessLabel(selected.updatedAt)}</strong></div>
              </div>

              <section className="detail-section community-rating-section">
                <div className="section-heading"><span><Star size={15} /> 社区六维评分</span><small>{selectedCommunityRatings.length} 条真实会话评分</small></div>
                {selectedCommunityScore !== null ? <div className="rating-result"><div className="rating-result-score"><strong>{selectedCommunityScore.toFixed(1)}</strong><span>/ 5.0</span></div><div className="rating-result-bars">{selectedDimensionScores.map((dimension) => <div key={dimension.key}><span>{dimension.label}</span><i><b style={{ width: `${(dimension.value ?? 0) * 20}%` }} /></i><strong>{dimension.value?.toFixed(1)}</strong></div>)}</div></div> : <div className="rating-empty"><p>体验评分与数据可信度分开计算。提交者不能用一条评论直接改变正式总分。</p><button type="button" onClick={() => openCommunityHub("contribute")}><Star size={13} /> 给这个厕所打分</button></div>}
              </section>

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
                <button type="button" className="version-history-button" onClick={() => openCommunityHub("history")}><History size={13} /> 查看数据版本历史</button>
              </section>

              <section className="detail-section indoor-consensus-section">
                <div className="section-heading"><span><Layers3 size={15} /> 楼内定位共识</span><small>3 人确认后上线</small></div>
                {selectedLocationCandidates.length ? <div className="indoor-candidate-list">{selectedLocationCandidates.map((candidate) => {
                  const totalVerifications = candidate.communityVerifications + candidate.demoVerifications;
                  const isPublished = candidate.status === "published" || candidate.status === "published_demo";
                  const userVote = candidateVotes[candidate.id];
                  return <article key={candidate.id} className={`indoor-candidate status-${candidate.status}`}>
                    <div className="indoor-candidate-head"><div><strong>{candidate.floor} · {candidate.zone}</strong><small>{candidate.sourceLabel}</small></div><span>{candidate.status === "published" ? "已上线" : candidate.status === "published_demo" ? "演示上线" : candidate.status === "disputed" ? "有争议" : "待验证"}</span></div>
                    {candidate.directions ? <p>{candidate.directions}</p> : null}
                    <div className="consensus-meter" aria-label={`确认进度 ${totalVerifications}/${candidate.requiredVerifications}`}>{Array.from({ length: candidate.requiredVerifications }, (_, index) => <i key={index} className={index < totalVerifications ? "is-filled" : ""} />)}</div>
                    <div className="consensus-count"><span>{totalVerifications}/{candidate.requiredVerifications} 确认</span><span>真实 {candidate.communityVerifications} · 演示 {candidate.demoVerifications} · 反对 {candidate.rejections}</span></div>
                    <div className="consensus-actions">
                      <button type="button" disabled={Boolean(userVote) || isPublished} onClick={() => voteOnLocation(candidate.id, "confirm")}><Check size={13} /> {userVote === "confirm" ? "已确认" : "我确认到过"}</button>
                      <button type="button" disabled={Boolean(userVote) || isPublished} onClick={() => voteOnLocation(candidate.id, "reject")}><X size={13} /> {userVote === "reject" ? "已反馈" : "位置不对"}</button>
                    </div>
                    {!isPublished ? <button type="button" className="demo-verifier-button" onClick={() => simulateNextVerifier(candidate.id)}>模拟下一位用户确认</button> : null}
                    {candidate.sourceUrl ? <a className="candidate-source-link" href={candidate.sourceUrl} target="_blank" rel="noreferrer">查看候选来源</a> : null}
                  </article>;
                })}</div> : <p className="empty-copy">还没有楼内位置候选，请从评论区提交楼层和方向。</p>}
              </section>

              <section className="detail-section comments-section">
                <div className="section-heading"><span><MessageSquare size={15} /> 用户声音</span><small>{evidenceCommentCount} 条平台证据 · {mockCommentCount} 条 Mock</small></div>
                <div className="location-submit-row"><span>知道具体在哪一层？</span><button type="button" onClick={() => setLocationFormOpen((current) => !current)}><MapPin size={13} /> 提交楼内位置</button></div>
                {locationFormOpen ? <form className="indoor-location-form" onSubmit={submitIndoorLocation}>
                  <div><input value={locationFloor} onChange={(event) => setLocationFloor(event.target.value)} placeholder="楼层，如 B1 / 5F" required /><input value={locationZone} onChange={(event) => setLocationZone(event.target.value)} placeholder="方位，如东南侧 / 近 2 号电梯" required /></div>
                  <input value={locationDirections} onChange={(event) => setLocationDirections(event.target.value)} placeholder="怎么走？可选填" />
                  <p>投稿会先进入候选区，不会直接改写正式位置。</p>
                  <div><button type="button" onClick={() => setLocationFormOpen(false)}>取消</button><button type="submit">提交候选</button></div>
                </form> : null}
                {comments.length ? <div className="comment-list">{comments.slice(-4).map((comment) => <div key={comment.id} className={`comment-item source-${comment.source}`}><div className="comment-author"><strong>{comment.author}</strong><span>{commentSourceLabel(comment)}</span></div><p>{comment.content}</p><div className="comment-meta"><small>{comment.createdAt}</small>{comment.sourceUrl ? <a href={comment.sourceUrl} target="_blank" rel="noreferrer">查看来源</a> : null}</div></div>)}</div> : <p className="empty-copy">还没有可信点评。第一条也要诚实。</p>}
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

      <footer className="footer">
        <span className="footer-brand"><Toilet size={15} /> 方便一下 · Open-source Hackathon Project</span>
        <span className="footer-meta">公开数据 ODbL · 榜单场所已匹配，厕所楼层待核实 · 医疗模块仅供娱乐</span>
        <a className="footer-pitch-link" href="/slides/" target="_blank" rel="noreferrer"><Sparkles size={14} /> 查看项目路演</a>
      </footer>

      {healthOpen && <HealthModal onClose={() => setHealthOpen(false)} onSave={() => setHealthHistory((count) => count + 1)} />}
      {demoOpen && <DemoModal onClose={() => setDemoOpen(false)} />}
      {communityHubOpen && <CommunityHubModal selected={selected} initialTab={communityHubTab} locationCandidates={locationCandidates} claims={communityClaims} ratings={communityRatings} auditLog={auditLog} candidateVotes={candidateVotes} claimVotes={claimVotes} onClose={() => setCommunityHubOpen(false)} onSubmitRating={submitCommunityRating} onSubmitClaim={submitCommunityClaim} onVoteLocation={voteOnLocation} onSimulateLocation={simulateNextVerifier} onVoteClaim={voteOnClaim} onSimulateClaim={simulateNextClaimVerifier} />}
    </div>
  );
}
