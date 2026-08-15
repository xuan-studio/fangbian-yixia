import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(projectRoot, "public/data/public-toilets.json");
const boundaryPath = resolve(projectRoot, "public/data/shanghai-boundary.geojson");

const overpassQuery = `[out:json][timeout:180];
rel["ISO3166-2"="CN-SH"]["boundary"="administrative"]->.boundary;
.boundary map_to_area->.searchArea;
nwr["amenity"="toilets"](area.searchArea);
out center tags;`;

const overpassEndpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.nchc.org.tw/api/interpreter",
];

const districtCenters = [
  ["黄浦区", 121.486, 31.224],
  ["徐汇区", 121.437, 31.189],
  ["长宁区", 121.39, 31.212],
  ["静安区", 121.447, 31.228],
  ["普陀区", 121.392, 31.251],
  ["虹口区", 121.505, 31.264],
  ["杨浦区", 121.53, 31.284],
  ["闵行区", 121.382, 31.113],
  ["宝山区", 121.489, 31.405],
  ["嘉定区", 121.266, 31.374],
  ["浦东新区", 121.641, 31.22],
  ["金山区", 121.342, 30.742],
  ["松江区", 121.228, 31.032],
  ["青浦区", 121.124, 31.151],
  ["奉贤区", 121.474, 30.918],
  ["崇明区", 121.554, 31.623],
];

const closestDistrict = (lon, lat) => {
  let match = districtCenters[0];
  let distance = Number.POSITIVE_INFINITY;
  for (const district of districtCenters) {
    const dx = (lon - district[1]) * Math.cos((lat * Math.PI) / 180);
    const dy = lat - district[2];
    const next = dx * dx + dy * dy;
    if (next < distance) {
      distance = next;
      match = district;
    }
  }
  return match[0];
};

const truthy = (value) => value === "yes" || value === "designated";
const nullableTag = (value) => {
  if (truthy(value)) return true;
  if (value === "no") return false;
  return null;
};

const compactAddress = (tags) => {
  const direct = tags["addr:full"] || tags.address;
  if (direct) return direct;
  const parts = [
    tags["addr:district"],
    tags["addr:subdistrict"],
    tags["addr:street"],
    tags["addr:housenumber"],
  ].filter(Boolean);
  return parts.length ? parts.join("") : null;
};

const normalizeElement = (element) => {
  const tags = element.tags || {};
  const longitude = element.lon ?? element.center?.lon;
  const latitude = element.lat ?? element.center?.lat;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  if (longitude < 120.8 || longitude > 122.15 || latitude < 30.65 || latitude > 31.9) return null;

  const district =
    tags["addr:district"] ||
    tags.district ||
    tags["is_in:district"] ||
    closestDistrict(longitude, latitude);
  const position = tags["toilets:position"] || "";
  const open24h = tags.opening_hours
    ? tags.opening_hours.trim() === "24/7"
    : null;
  const hasBabyCare = nullableTag(tags.changing_table || tags.baby);
  const confidence = Math.min(
    0.86,
    0.5 +
      (tags.name ? 0.08 : 0) +
      (tags.opening_hours ? 0.08 : 0) +
      (tags.wheelchair ? 0.06 : 0) +
      (compactAddress(tags) ? 0.06 : 0),
  );

  const recordTags = [
    open24h === true ? "24小时" : null,
    truthy(tags.wheelchair) ? "无障碍" : null,
    truthy(tags.changing_table) ? "母婴设施" : null,
    tags.fee === "no" ? "免费" : null,
    tags.access === "customers" ? "顾客专用" : null,
  ].filter(Boolean);

  return {
    id: `osm-${element.type}-${element.id}`,
    sourceType: "public_open_data",
    sourceName: "OpenStreetMap",
    sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    sourceRef: `${element.type}/${element.id}`,
    dataStatus: "community_report",
    name: tags.name || `${district}公共厕所`,
    district,
    address: compactAddress(tags),
    coordinates: { longitude, latitude },
    openingHours: tags.opening_hours || null,
    open24h,
    facility: {
      squat: position ? position.includes("squat") : null,
      seated: position ? position.includes("seated") : null,
      accessible: nullableTag(tags.wheelchair),
      thirdRestroom: null,
      babyCare: hasBabyCare,
    },
    crowd: null,
    tags: recordTags,
    rating: null,
    reviewCount: null,
    healthScore: null,
    confidence,
    description: tags.description || tags.note || null,
    comments: [],
    updatedAt: null,
  };
};

async function postOverpass(query, timeoutMs = 190_000) {
  let lastError;
  for (const endpoint of overpassEndpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "user-agent": "Fangbian-Yixia-Hackathon/1.0",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`${endpoint}: ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("No Overpass endpoint succeeded.");
}

async function fetchOverpass() {
  return postOverpass(overpassQuery);
}

async function fetchBoundary() {
  const results = await postOverpass(
    `[out:json][timeout:120];rel["ISO3166-2"="CN-SH"]["boundary"="administrative"];out geom;`,
    130_000,
  );
  const relation = results.elements?.find((element) => element.type === "relation");
  const lines = (relation?.members || [])
    .filter((member) => member.role === "outer" && member.geometry?.length > 1)
    .map((member) => member.geometry.map((point) => [point.lon, point.lat]));
  if (!lines.length) throw new Error("Shanghai boundary was not returned.");
  return {
    type: "FeatureCollection",
    attribution: "© OpenStreetMap contributors, ODbL",
    features: [
      {
        type: "Feature",
        properties: { name: "上海市", mode: "offline-local" },
        geometry: { type: "MultiLineString", coordinates: lines },
      },
    ],
  };
}

const fallbackBoundary = {
  type: "FeatureCollection",
  attribution: "本地概念轮廓，仅用于断网可视化",
  features: [
    {
      type: "Feature",
      properties: { name: "上海市概念轮廓", mode: "offline-concept" },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [[[120.86, 30.69], [121.24, 30.7], [121.61, 30.78], [121.92, 31.01], [121.83, 31.32], [121.61, 31.46], [121.25, 31.42], [120.9, 31.19], [120.86, 30.69]]],
          [[[121.18, 31.49], [121.58, 31.48], [121.89, 31.58], [121.79, 31.75], [121.43, 31.78], [121.18, 31.64], [121.18, 31.49]]],
        ],
      },
    },
  ],
};

await mkdir(dirname(outputPath), { recursive: true });
const overpass = await fetchOverpass();
let boundary;
try {
  boundary = await fetchBoundary();
} catch (error) {
  console.warn(`Boundary download failed; using local concept outline: ${error.message}`);
  boundary = fallbackBoundary;
}
const records = overpass.elements
  .map(normalizeElement)
  .filter(Boolean)
  .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      status: "ready",
      source: "OpenStreetMap amenity=toilets in Shanghai",
      license: "ODbL — © OpenStreetMap contributors",
      generatedAt: new Date().toISOString(),
      records,
    },
    null,
    2,
  )}\n`,
);
await writeFile(boundaryPath, `${JSON.stringify(boundary)}\n`);

console.log(`Saved ${records.length} Shanghai public toilets.`);
