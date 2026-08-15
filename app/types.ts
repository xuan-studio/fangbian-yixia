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
