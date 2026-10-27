/**
 * 后端返回数据模型（与 backend/app 及 frontend/src/services/api.ts 对齐）。
 */

export interface AuthUser {
  id: number;
  username: string;
  role: string;
  is_active: boolean;
}

export interface LoginResult {
  token: string;
  user: AuthUser;
}

export interface Device {
  id: string;
  name: string;
  device_type: string;
  status: string;
  health_score: number;
  edge_anomaly_score: number;
  threshold_vibration: number | null;
  threshold_temp: number | null;
  last_updated: number | null;
}

export interface FaultDiagnosis {
  fault_type?: string;
  confidence?: number;
  reasoning?: string;
}

export interface DiagnosisReport {
  summary?: string;
  physical_evidence?: string;
  signal_evidence?: string;
  knowledge_basis?: string;
  diagnosis?: FaultDiagnosis;
  impact?: string;
  recommendation?: string;
  follow_up_questions?: string[];
}

export interface EventSummary {
  id: number;
  device_id: string;
  event_type: string;
  status_state: string | null;
  severity: string;
  fault_type: string | null;
  confidence: number | null;
  health_score: number | null;
  report: DiagnosisReport | null;
  timestamp: string | null;
}

export interface TimelineItem {
  id: number;
  event_id: number;
  device_id: string;
  from_state: string | null;
  to_state: string;
  reason: string;
  operator: string;
  created_at: string;
}

export interface EventReportData {
  event_id: number;
  report: string;
}

export interface FlashReportData {
  report: string;
  device_id: string | null;
}