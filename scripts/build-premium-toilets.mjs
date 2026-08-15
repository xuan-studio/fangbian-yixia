import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

const [candidateData, venueData, publicData] = await Promise.all([
  readFile(new URL("public/data/xhs-candidates.json", root), "utf8").then(JSON.parse),
  readFile(new URL("public/data/venue-pois.json", root), "utf8").then(JSON.parse),
  readFile(new URL("public/data/public-toilets.json", root), "utf8").then(JSON.parse),
]);

const SEARCH_SOURCE_URL = "https://www.xiaohongshu.com/search_result?keyword=%E4%B8%8A%E6%B5%B7%E5%8E%95%E6%89%80%E6%A6%9C%E5%8D%95";

const rankingSpecs = [
  { venue: "港汇恒隆广场", group: "黄金红榜", rank: 1 },
  { venue: "兴业太古汇", group: "黄金红榜", rank: 2 },
  { venue: "静安嘉里中心", group: "黄金红榜", rank: 3 },
  { venue: "五角场合生汇", group: "黄金红榜", rank: 4 },
  { venue: "久光百货", group: "黄金红榜", rank: 5 },
  { venue: "比斯特上海购物村", group: "设计特色榜", rank: 6 },
  { venue: "汇金百货", group: "设计特色榜", rank: 7 },
  { venue: "中信泰富广场", group: "设计特色榜", rank: 8 },
  {
    venue: "上海环球港",
    group: "蹲厕专题",
    rank: 9,
    noteId: "695526e2000000001e005e5d",
    squat: true,
    evidenceSummary: "搜索结果出现“上海环球港｜唯一蹲坑厕所”专题，具体楼层仍待读取原帖核实。",
  },
  {
    venue: "上海荟聚",
    group: "蹲厕专题",
    rank: 10,
    noteId: "697f06fe000000000a02f1a2",
    squat: true,
    evidenceSummary: "搜索结果出现“上海荟聚蹲坑攻略”专题，具体楼层仍待读取原帖核实。",
  },
  {
    venue: "芮欧百货",
    group: "南京西路专题",
    rank: 11,
    noteId: "68f1ca67000000000401205d",
    evidenceSummary: "搜索结果出现“南京西路入门级厕所，1788，久光，芮欧”专题。",
  },
  {
    venue: "上海万象城",
    group: "单点好评",
    rank: 12,
    noteId: "69d61f82000000001a02d76e",
    evidenceSummary: "搜索结果出现“上海万象城的卫生间好评～”单点笔记。",
  },
];

function haversineMeters(a, b) {
  const radius = 6371000;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function slug(rank) {
  return String(rank).padStart(2, "0");
}

const matches = rankingSpecs.map((spec) => {
  const venue = venueData.records.find((item) => item.name === spec.venue);
  if (!venue) throw new Error(`缺少场所 POI：${spec.venue}`);

  const candidate = candidateData.venueCandidates.find((item) => item.name === spec.venue);
  const sourcePost = spec.noteId
    ? candidateData.sourcePosts.find((item) => item.noteId === spec.noteId)
    : null;
  const nearest = publicData.records
    .map((record) => ({
      id: record.id,
      name: record.name,
      sourceRef: record.sourceRef,
      distanceMeters: Math.round(haversineMeters(venue.coordinates, record.coordinates)),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)[0];

  const evidenceSummary = spec.evidenceSummary ?? candidate?.evidenceSummary ?? "小红书榜单候选，具体厕所信息待核实。";
  const sourceUrl = sourcePost?.sourceUrl ?? SEARCH_SOURCE_URL;
  const sourceRef = sourcePost ? `xiaohongshu:${sourcePost.noteId}` : "xiaohongshu:ai-summary-53-notes";
  const tags = ["小红书榜单", spec.group, "商场厕所", "具体楼层待核实"];
  if (spec.squat === true) tags.push("蹲厕线索");

  return {
    premiumRecord: {
      id: `premium-xhs-${slug(spec.rank)}-${venue.id}`,
      sourceType: "premium_xhs",
      sourceName: "小红书榜单线索 + OpenStreetMap 场所匹配",
      sourceUrl,
      sourceRef,
      dataStatus: "pending_verification",
      name: `${venue.name} · 榜单厕所`,
      district: venue.district,
      address: venue.address,
      coordinates: venue.coordinates,
      openingHours: null,
      open24h: null,
      facility: {
        squat: spec.squat ?? null,
        seated: null,
        accessible: null,
        thirdRestroom: null,
        babyCare: null
      },
      crowd: null,
      tags,
      rating: null,
      reviewCount: null,
      healthScore: null,
      confidence: venue.matchConfidence,
      description: `${evidenceSummary} 当前坐标为商场场所点，不代表厕所精确楼层。`,
      comments: [],
      updatedAt: "2026-08-15"
    },
    match: {
      rank: spec.rank,
      group: spec.group,
      venueId: venue.id,
      venueName: venue.name,
      venuePrecision: venue.precision,
      venueMatchConfidence: venue.matchConfidence,
      venueSourceRef: venue.sourceRef,
      nearestPublicToilet: nearest,
      mergeDecision: "keep_separate",
      reason: "最近公开厕所仅用于应急参照；没有证据证明它就是商场榜单厕所。"
    }
  };
});

const premiumDataset = {
  status: "ready",
  sourceNote: "12 个小红书榜单/专题场所已匹配到上海 POI。坐标为商场中心或场内 POI，厕所楼层与设施继续标记待核实。",
  records: matches.map((item) => item.premiumRecord),
};

const matchDataset = {
  status: "ready",
  generatedAt: "2026-08-15",
  policy: "榜单厕所与最近公开厕所保持独立，不自动合并。",
  records: matches.map((item) => item.match),
};

await Promise.all([
  writeFile(new URL("public/data/premium-toilets.json", root), `${JSON.stringify(premiumDataset, null, 2)}\n`),
  writeFile(new URL("public/data/premium-matches.json", root), `${JSON.stringify(matchDataset, null, 2)}\n`),
]);

console.log(`生成 ${premiumDataset.records.length} 个榜单厕所，关联 ${matchDataset.records.length} 个最近公开厕所参照。`);
