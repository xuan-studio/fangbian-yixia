export type SourceType = "public_open_data" | "premium_xhs" | "user_import";

export type NullableBoolean = boolean | null;

export type CrowdPeriod = {
  label: string;
  start: string;
  end: string;
  level: 1 | 2 | 3 | 4 | 5;
};

export type CommentRecord = {
  id: string;
  author: string;
  content: string;
  createdAt: string;
  source: "session" | "imported" | "xhs_note" | "xhs_aggregate" | "mock";
  sourceLabel?: string | null;
  sourceUrl?: string | null;
};

/**
 * Frozen data contract for every toilet source.
 * Missing facts must stay `null`; never infer an unknown facility as false.
 */
export type ToiletRecord = {
  id: string;
  sourceType: SourceType;
  sourceName: string;
  sourceUrl: string | null;
  sourceRef: string | null;
  dataStatus: "verified" | "community_report" | "pending_verification";
  name: string;
  district: string | null;
  address: string | null;
  coordinates: {
    longitude: number;
    latitude: number;
  };
  openingHours: string | null;
  open24h: NullableBoolean;
  facility: {
    squat: NullableBoolean;
    seated: NullableBoolean;
    accessible: NullableBoolean;
    thirdRestroom: NullableBoolean;
    babyCare: NullableBoolean;
  };
  crowd: CrowdPeriod[] | null;
  tags: string[];
  rating: number | null;
  reviewCount: number | null;
  healthScore: number | null;
  confidence: number | null;
  description: string | null;
  comments: CommentRecord[];
  updatedAt: string | null;
};

export type PremiumDataset = {
  status: "pending_source" | "ready";
  sourceNote: string;
  records: ToiletRecord[];
};

export type PublicDataset = {
  status: "ready" | "seed_fallback";
  source: string;
  license: string;
  generatedAt: string;
  records: ToiletRecord[];
};

export type BuildingLocationCandidate = {
  id: string;
  toiletId: string;
  buildingName: string;
  floor: string;
  zone: string;
  directions: string | null;
  source: "xhs_note" | "xhs_aggregate" | "community";
  sourceLabel: string;
  sourceUrl: string | null;
  sourceCommentId: string | null;
  status: "collecting" | "published" | "published_demo" | "disputed";
  communityVerifications: number;
  demoVerifications: number;
  rejections: number;
  requiredVerifications: number;
  createdAt: string;
};

export type BuildingLocationDataset = {
  status: "ready";
  policy: string;
  records: BuildingLocationCandidate[];
};

export type RatingScores = {
  hygiene: number;
  odor: number;
  queue: number;
  comfort: number;
  wayfinding: number;
  facilities: number;
};

export type CommunityRating = {
  id: string;
  toiletId: string;
  scores: RatingScores;
  average: number;
  note: string | null;
  source: "session" | "mock";
  author: string;
  createdAt: string;
};

export type CommunityClaim = {
  id: string;
  toiletId: string | null;
  toiletName: string;
  kind: "fact_update" | "status_report" | "new_toilet";
  summary: string;
  structuredData: Record<string, string | number | boolean | null>;
  proposedToilet: ToiletRecord | null;
  status: "collecting" | "published" | "published_demo" | "disputed";
  communityVerifications: number;
  demoVerifications: number;
  rejections: number;
  requiredVerifications: number;
  createdAt: string;
};

export type AuditEvent = {
  id: string;
  toiletId: string | null;
  type: "import" | "contribution" | "verification" | "publish" | "dispute";
  title: string;
  detail: string;
  actor: string;
  source: "system" | "session" | "demo";
  createdAt: string;
};
