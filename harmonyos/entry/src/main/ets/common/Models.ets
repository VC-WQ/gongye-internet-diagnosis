export interface DeviceItem {
  id: string;
  name: string;
  deviceType: string;
  status: string;
  healthScore: number;
  edgeAnomalyScore: number;
  lastUpdated: number;
  runMode: string;
  datasetName: string;
  healthBasis: string;
}

export interface ChannelReading {
  name: string;
  text: string;
}

export interface WindowSnapshot {
  points: Array<ESObject>;
  count: number;
  ageSeconds: number;
  stale: boolean;
  channels: Array<ChannelReading>;
}

export interface DiagnosisEvent {
  id: number;
  deviceId: string;
  status: string;
  faultLabel: string;
  confidence: number;
  healthScore: number;
  healthBasis: string;
  summary: string;
  recommendation: string;
  modelName: string;
  scoreFormula: string;
  scoreLabel: string;
  metricText: string;
  reused: boolean;
  timestamp: string;
}

export interface CommandSubmit {
  commandId: string;
  topic: string;
  event: DiagnosisEvent;
}

export interface TimelineItem {
  text: string;
}

export interface MaintainAction {
  code: string;
  label: string;
}

interface ChannelMeta {
  key: string;
  name: string;
  unit: string;
}

const CHANNELS: ChannelMeta[] = [
  { key: 'vibration', name: '振动', unit: 'g' },
  { key: 'temperature', name: '温度', unit: '℃' },
  { key: 'current', name: '电流', unit: 'A' },
  { key: 'pressure', name: '压力', unit: 'bar' },
  { key: 'speed', name: '转速', unit: 'rpm' },
  { key: 'acoustic', name: '声压', unit: 'dB' }
];

const STALE_SECONDS: number = 15;

type JsonValue = Object | string | number | boolean | null | undefined;

export const MAINTAIN_ACTIONS: MaintainAction[] = [
  { code: 'lubricate', label: '润滑' },
  { code: 'reduce_load', label: '降载' },
  { code: 'repair', label: '检修' }
];

export function emptyWindow(): WindowSnapshot {
  return {
    points: [],
    count: 0,
    ageSeconds: Number.NaN,
    stale: true,
    channels: []
  };
}

export function emptyEvent(): DiagnosisEvent {
  return {
    id: 0,
    deviceId: '',
    status: '',
    faultLabel: '',
    confidence: Number.NaN,
    healthScore: Number.NaN,
    healthBasis: '',
    summary: '',
    recommendation: '',
    modelName: '',
    scoreFormula: '',
    scoreLabel: '',
    metricText: '',
    reused: false,
    timestamp: ''
  };
}

export function deviceTypeText(value: string): string {
  if (value === 'pump') {
    return '离心泵';
  }
  if (value === 'motor') {
    return '驱动电机';
  }
  if (value === 'compressor') {
    return '空压机';
  }
  return value.length > 0 ? value : '设备';
}

export function deviceStatusText(value: string): string {
  if (value === 'healthy') {
    return '健康';
  }
  if (value === 'degraded') {
    return '退化';
  }
  if (value === 'fault') {
    return '故障';
  }
  if (value === 'offline') {
    return '离线';
  }
  return value.length > 0 ? value : '未知';
}

export function deviceStatusColor(value: string): string {
  if (value === 'healthy') {
    return '#3DDC97';
  }
  if (value === 'degraded') {
    return '#F0B429';
  }
  if (value === 'fault') {
    return '#E15A4A';
  }
  return '#8EA0B0';
}

export function runModeText(value: string): string {
  if (value === 'simulation') {
    return '仿真处置';
  }
  if (value === 'public_replay') {
    return '公开数据回放';
  }
  return value.length > 0 ? value : '公开数据回放';
}

export function eventStatusText(value: string): string {
  if (value === 'normal') {
    return '正常';
  }
  if (value === 'warning') {
    return '预警';
  }
  if (value === 'alarm') {
    return '告警';
  }
  if (value === 'consulting') {
    return '会诊中';
  }
  if (value === 'pending') {
    return '待确认';
  }
  if (value === 'handling') {
    return '处置中';
  }
  if (value === 'observing') {
    return '观察中';
  }
  if (value === 'recovered') {
    return '已恢复';
  }
  if (value === 'relapsed') {
    return '复发';
  }
  return value.length > 0 ? value : '未知状态';
}

export function isActiveStatus(value: string): boolean {
  return value === 'consulting' || value === 'pending' || value === 'handling' || value === 'observing';
}

export function basisText(basis: string): string {
  if (basis === 'skab_probability') {
    return '泵的梯度提升树输出。分数 = 100 × 正常概率，不是另测的健康指标。';
  }
  if (basis === 'xjtu_rul') {
    return '电机剩余寿命模型输出。分数由预测剩余寿命比例换算，不是另测的健康指标。';
  }
  if (basis.length === 0 || basis === 'unobserved') {
    return '这次没有模型分数。';
  }
  return basis;
}

export function formatScore(value: number): string {
  if (!Number.isFinite(value)) {
    return '未评分';
  }
  return value.toFixed(2);
}

export function formatConfidence(value: number): string {
  if (!Number.isFinite(value)) {
    return '';
  }
  if (value >= 0 && value <= 1) {
    return `${(value * 100).toFixed(1)}%`;
  }
  return value.toFixed(2);
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '无时间';
  }
  const ms = seconds > 1e12 ? seconds : seconds * 1000;
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function ageText(snapshot: WindowSnapshot): string {
  if (snapshot.count <= 0) {
    return '还没有采样';
  }
  if (!Number.isFinite(snapshot.ageSeconds)) {
    return `${snapshot.count} 个点，没有可用时间戳`;
  }
  const seconds = Math.max(0, Math.round(snapshot.ageSeconds));
  if (snapshot.stale) {
    return `${snapshot.count} 个点，最近一条已过去 ${seconds} 秒，超过 15 秒不能发起诊断`;
  }
  return `${snapshot.count} 个点，最近一条 ${seconds} 秒前`;
}

export function errorMessage(error: Object): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return '请求失败';
}

export function parseDevice(raw: ESObject): DeviceItem {
  return {
    id: textOf(pick(raw, 'id')),
    name: textOf(pick(raw, 'name')),
    deviceType: textOf(pick(raw, 'device_type')),
    status: textOf(pick(raw, 'status')),
    healthScore: numberOf(pick(raw, 'health_score')),
    edgeAnomalyScore: numberOf(pick(raw, 'edge_anomaly_score')),
    lastUpdated: numberOf(pick(raw, 'last_updated')),
    runMode: textOf(pick(raw, 'run_mode')),
    datasetName: textOf(pick(raw, 'dataset_name')),
    healthBasis: textOf(pick(raw, 'health_basis'))
  };
}

export function parseDevices(list: Array<ESObject>): Array<DeviceItem> {
  const result: Array<DeviceItem> = [];
  for (let i = 0; i < list.length; i++) {
    const item = asRecord(list[i] as Object);
    if (item !== undefined && textOf(pick(item, 'id')).length > 0) {
      result.push(parseDevice(item));
    }
  }
  return result;
}

export function parseWindow(list: Array<ESObject>, nowMs: number): WindowSnapshot {
  const points: Array<ESObject> = [];
  for (let i = 0; i < list.length; i++) {
    const item = asRecord(list[i] as Object);
    if (item !== undefined) {
      points.push(item);
    }
  }
  const snapshot: WindowSnapshot = {
    points: points,
    count: points.length,
    ageSeconds: Number.NaN,
    stale: true,
    channels: []
  };
  if (points.length === 0) {
    return snapshot;
  }
  const last = points[points.length - 1];
  snapshot.channels = readChannels(last);
  const ts = timestampSeconds(pick(last, 'timestamp'));
  if (!Number.isFinite(ts)) {
    return snapshot;
  }
  snapshot.ageSeconds = nowMs / 1000 - ts;
  snapshot.stale = snapshot.ageSeconds > STALE_SECONDS;
  return snapshot;
}

export function normalizeWindow(points: Array<ESObject>): Array<ESObject> {
  const result: Array<ESObject> = [];
  for (let i = 0; i < points.length; i++) {
    const copy = JSON.parse(JSON.stringify(points[i])) as ESObject;
    const ts = timestampSeconds(pick(copy, 'timestamp'));
    if (Number.isFinite(ts)) {
      copy['timestamp'] = ts;
    }
    result.push(copy);
  }
  return result;
}

export function parseEvent(raw: ESObject): DiagnosisEvent {
  const diagnosis = asRecord(pick(raw, 'agent_diagnosis'));
  const directReport = asRecord(pick(raw, 'report'));
  const nestedReport = diagnosis === undefined ? undefined : asRecord(pick(diagnosis, 'report'));
  const report = directReport !== undefined ? directReport : nestedReport;
  const card = diagnosis === undefined ? undefined : asRecord(pick(diagnosis, 'model_card'));
  const event = emptyEvent();
  event.id = intOf(pick(raw, 'id'));
  event.deviceId = textOf(pick(raw, 'device_id'));
  event.status = textOf(pick(raw, 'status_state'));
  event.faultLabel = firstText(
    diagnosis === undefined ? '' : textOf(pick(diagnosis, 'fault_label')),
    textOf(pick(raw, 'fault_type'))
  );
  event.confidence = firstNumber(
    pick(raw, 'confidence'),
    diagnosis === undefined ? Number.NaN : numberOf(pick(diagnosis, 'confidence'))
  );
  event.healthScore = firstNumber(
    pick(raw, 'health_score'),
    diagnosis === undefined ? Number.NaN : numberOf(pick(diagnosis, 'health_score'))
  );
  event.healthBasis = diagnosis === undefined ? '' : textOf(pick(diagnosis, 'health_basis'));
  event.summary = report === undefined ? '' : textOf(pick(report, 'summary'));
  event.recommendation = firstText(
    report === undefined ? '' : textOf(pick(report, 'recommendation')),
    diagnosis === undefined ? '' : textOf(pick(diagnosis, 'recommendation'))
  );
  event.modelName = card === undefined ? '' : textOf(pick(card, 'model_name'));
  event.scoreFormula = card === undefined ? '' : textOf(pick(card, 'score_formula'));
  event.scoreLabel = card === undefined ? '' : textOf(pick(card, 'score_label'));
  event.metricText = card === undefined ? '' : metricText(card);
  const reusedFlag = pick(raw, 'reused');
  event.reused = typeof reusedFlag === 'boolean' ? reusedFlag : false;
  event.timestamp = textOf(pick(raw, 'timestamp'));
  return event;
}

export function parseTimeline(list: Array<ESObject>): Array<TimelineItem> {
  const result: Array<TimelineItem> = [];
  for (let i = 0; i < list.length; i++) {
    const item = asRecord(list[i] as Object);
    if (item === undefined) {
      continue;
    }
    const fromState = eventStatusText(textOf(pick(item, 'from_state')));
    const toState = eventStatusText(textOf(pick(item, 'to_state')));
    const reason = textOf(pick(item, 'reason'));
    const operator = textOf(pick(item, 'operator'));
    let text = `${fromState} → ${toState}`;
    if (reason.length > 0) {
      text = `${text}：${reason}`;
    }
    if (operator.length > 0) {
      text = `${text}（${operator}）`;
    }
    result.push({ text: text });
  }
  return result;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

function readChannels(point: ESObject): Array<ChannelReading> {
  const result: Array<ChannelReading> = [];
  for (let i = 0; i < CHANNELS.length; i++) {
    const meta = CHANNELS[i];
    const value = numberOf(pick(point, meta.key));
    if (!Number.isFinite(value)) {
      continue;
    }
    result.push({
      name: meta.name,
      text: `${value.toFixed(3)} ${meta.unit}`
    });
  }
  return result;
}

function timestampSeconds(value: JsonValue): number {
  let ts = Number.NaN;
  if (typeof value === 'number') {
    ts = value;
  } else if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      ts = parsed;
    }
  }
  if (!Number.isFinite(ts)) {
    return Number.NaN;
  }
  return ts > 1e12 ? ts / 1000 : ts;
}

function metricText(card: ESObject): string {
  const metric = asRecord(pick(card, 'test_metric'));
  if (metric === undefined) {
    return '';
  }
  const precision = numberOf(pick(metric, 'precision'));
  const recall = numberOf(pick(metric, 'recall'));
  const f1 = numberOf(pick(metric, 'f1'));
  if (Number.isFinite(precision) && Number.isFinite(recall) && Number.isFinite(f1)) {
    return `留出试验：精确率 ${precision}，召回率 ${recall}，F1 ${f1}`;
  }
  return '';
}

function firstText(primary: string, fallback: string): string {
  return primary.length > 0 ? primary : fallback;
}

function firstNumber(primary: JsonValue, fallback: number): number {
  const value = numberOf(primary);
  return Number.isFinite(value) ? value : fallback;
}

function intOf(value: JsonValue): number {
  const parsed = numberOf(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.trunc(parsed);
}

function textOf(value: JsonValue): string {
  return typeof value === 'string' ? value : '';
}

function numberOf(value: JsonValue): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Number.NaN;
}

function asRecord(value: JsonValue): ESObject | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as ESObject;
}

function pick(raw: ESObject, key: string): JsonValue {
  return raw[key] as JsonValue;
}
