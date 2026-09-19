export type City = {
  slug: string;
  name: string;
  nameEn: string;
  latitude: number;
  longitude: number;
  timezone: string;
  poem: [string, string];
};

export type CatalogStar = {
  id: string;
  name: string;
  ra: number;
  dec: number;
  magnitude: number;
};

export type StarPoint = CatalogStar & {
  x: number;
  y: number;
  radius: number;
  altitude: number;
  azimuth: number;
};

export type Device = {
  id: string;
  name: string;
  bedWidthMm: number | null;
  bedHeightMm: number | null;
  safeMarginMm: number;
  minHoleMm: number;
  minSpacingMm: number;
  minFeatureMm: number;
  maxCutStrokeMm: number;
  parameterNote: string;
  source: string;
};

export type StarDesign = {
  city: City;
  date: string;
  observedAtUtc: string;
  localHour: number;
  sizeMm: number;
  stars: StarPoint[];
  cutStrokeMm: number;
  vectorStrokeMm: number;
  registrationHoleMm: number;
  repaired: boolean;
};

export type DfmIssue = {
  code: "DEVICE_UNKNOWN" | "ENVELOPE" | "CUT_STROKE" | "HOLE_SIZE" | "HOLE_SPACING" | "LINE_WIDTH" | "OPEN_PATH" | "NO_HOLES" | "SUBJECT_COVERAGE";
  severity: "error" | "warning";
  message: string;
  starIds?: string[];
};

export type DfmReport = {
  passed: boolean;
  issues: DfmIssue[];
  checks: number;
  summary: string;
};
