import { http } from '@kit.NetworkKit';
import { Session } from './Session';
import {
  CommandSubmit,
  DiagnosisEvent,
  DeviceItem,
  TimelineItem,
  WindowSnapshot,
  normalizeWindow,
  parseDevice,
  parseDevices,
  parseEvent,
  parseTimeline,
  parseWindow
} from './Models';

const MARK: string = '云侧：';

type JsonValue = Object | string | number | boolean | null | undefined;

class JsonBody {
  kind: string = 'empty';
  record: ESObject = {};
  list: Array<ESObject> = [];
}

export class CloudClient {
  static async login(username: string, password: string, baseUrl: string): Promise<void> {
    Session.baseUrl = baseUrl.trim();
    const body = await CloudClient.post('/auth/login', {
      'username': username.trim(),
      'password': password
    });
    const token = textOf(pick(body.record, 'token'));
    const user = asRecord(pick(body.record, 'user'));
    if (token.length === 0 || user === undefined) {
      throw new Error(`${MARK}登录响应里没有令牌`);
    }
    Session.token = token;
    Session.username = textOf(pick(user, 'username'));
    Session.role = textOf(pick(user, 'role'));
    await Session.save();
  }

  static async devices(): Promise<Array<DeviceItem>> {
    const body = await CloudClient.get('/devices');
    return parseDevices(body.list);
  }

  static async windowOf(deviceId: string): Promise<WindowSnapshot> {
    const body = await CloudClient.get(`/mqtt-pipeline/window/${encodeURIComponent(deviceId)}`);
    return parseWindow(body.list, Date.now());
  }

  static async device(deviceId: string): Promise<DeviceItem> {
    const body = await CloudClient.get(`/devices/${encodeURIComponent(deviceId)}`);
    return parseDevice(body.record);
  }

  static async setMode(deviceId: string, runMode: string): Promise<void> {
    await CloudClient.post(`/devices/${encodeURIComponent(deviceId)}/mode`, {
      'run_mode': runMode
    });
  }

  static async latestEvent(deviceId: string): Promise<DiagnosisEvent | undefined> {
    const body = await CloudClient.get(`/command-loop/events?device_id=${encodeURIComponent(deviceId)}&limit=20&offset=0`);
    if (body.list.length === 0) {
      return undefined;
    }
    const first = asRecord(body.list[0] as Object);
    if (first === undefined) {
      return undefined;
    }
    return parseEvent(first);
  }

  static async createEvent(deviceId: string, points: Array<ESObject>): Promise<DiagnosisEvent> {
    const body = await CloudClient.post('/command-loop/events', {
      'device_id': deviceId,
      'window': normalizeWindow(points),
      'operator': Session.username.length > 0 ? Session.username : 'operator'
    });
    return parseEvent(body.record);
  }

  static async confirm(eventId: number): Promise<DiagnosisEvent> {
    const body = await CloudClient.post(`/command-loop/events/${eventId}/confirm`, {
      'operator': Session.username
    });
    return parseEvent(body.record);
  }

  static async reject(eventId: number, reason: string): Promise<DiagnosisEvent> {
    const body = await CloudClient.post(`/command-loop/events/${eventId}/reject`, {
      'operator': Session.username,
      'reason': reason
    });
    return parseEvent(body.record);
  }

  static async execute(eventId: number, action: string): Promise<CommandSubmit> {
    const body = await CloudClient.post(`/command-loop/events/${eventId}/execute`, {
      'operator': Session.username,
      'command': action
    });
    const eventRaw = asRecord(pick(body.record, 'event'));
    return {
      commandId: textOf(pick(body.record, 'command_id')),
      topic: textOf(pick(body.record, 'mqtt_topic')),
      event: eventRaw === undefined ? parseEvent(body.record) : parseEvent(eventRaw)
    };
  }

  static async timeline(eventId: number): Promise<Array<TimelineItem>> {
    const body = await CloudClient.get(`/command-loop/events/${eventId}/timeline`);
    return parseTimeline(body.list);
  }

  private static get(path: string): Promise<JsonBody> {
    return CloudClient.request(http.RequestMethod.GET, path, '');
  }

  private static post(path: string, payload: Object): Promise<JsonBody> {
    return CloudClient.request(http.RequestMethod.POST, path, JSON.stringify(payload));
  }

  private static async request(method: http.RequestMethod, path: string, payload: string): Promise<JsonBody> {
    const client = http.createHttp();
    try {
      const header: Record<string, string> = { 'Content-Type': 'application/json' };
      if (Session.token.length > 0) {
        header['Authorization'] = `Bearer ${Session.token}`;
      }
      const options: http.HttpRequestOptions = {
        method: method,
        header: header,
        connectTimeout: 15000,
        readTimeout: 60000,
        expectDataType: http.HttpDataType.STRING
      };
      if (payload.length > 0) {
        options.extraData = payload;
      }
      const response = await client.request(Session.endpoint(path), options);
      const text = responseText(response.result);
      if (response.responseCode < 200 || response.responseCode >= 300) {
        if (response.responseCode === 401 && Session.token.length > 0 && path.indexOf('/auth/login') < 0) {
          throw new Error(`${MARK}登录已失效，请重新登录`);
        }
        throw new Error(`${MARK}${detailOf(response.responseCode, text)}`);
      }
      return parseBody(text);
    } catch (error) {
      if (error instanceof Error && error.message.indexOf(MARK) === 0) {
        throw error;
      }
      throw new Error('连不上云侧。请检查地址、后端是否已启动，以及手机和电脑是否在同一网络。');
    } finally {
      client.destroy();
    }
  }
}

function parseBody(text: string): JsonBody {
  const body = new JsonBody();
  if (text.length === 0) {
    return body;
  }
  const parsed: ESObject | Array<ESObject> = JSON.parse(text) as ESObject | Array<ESObject>;
  if (Array.isArray(parsed)) {
    body.kind = 'array';
    body.list = parsed as Array<ESObject>;
    return body;
  }
  const record = asRecord(parsed as ESObject);
  if (record !== undefined) {
    body.kind = 'object';
    body.record = record;
  }
  return body;
}

function detailOf(code: number, text: string): string {
  try {
    const parsed = JSON.parse(text) as ESObject;
    const record = asRecord(parsed);
    if (record !== undefined) {
      const detail = pick(record, 'detail');
      if (typeof detail === 'string' && detail.length > 0) {
        return detail;
      }
    }
  } catch (ignored) {
    void ignored;
  }
  if (text.length > 0 && text.length < 180) {
    return text;
  }
  return `返回 ${code}`;
}

function responseText(result: string | Object | ArrayBuffer): string {
  if (typeof result === 'string') {
    return result;
  }
  return JSON.stringify(result);
}

function textOf(value: JsonValue): string {
  return typeof value === 'string' ? value : '';
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
