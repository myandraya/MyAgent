export type City = {
  slug: string;
  name: string;
  nameEn: string;
  latitude: number;
  longitude: number;
  timezone: string;
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

export type DfmIssue = {
  code: "DEVICE_UNKNOWN" | "ENVELOPE" | "CUT_STROKE" | "LINE_WIDTH" | "OPEN_PATH" | "NO_HOLES" | "SUBJECT_COVERAGE";
  severity: "error" | "warning";
  message: string;
};

export type DfmReport = {
  passed: boolean;
  issues: DfmIssue[];
  checks: number;
  summary: string;
};
