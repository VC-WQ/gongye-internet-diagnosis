import { ApiClient } from './ApiClient';
import {
  Device,
  EventSummary,
  TimelineItem,
  LoginResult,
  EventReportData
} from '../model/Models';

/**
 * 业务数据服务：封装后端各 REST 接口，供页面调用。
 * 端点路径与 frontend/src/services/api.ts 保持一致。
 */
export class DataService {
  static login(username: string, password: string): Promise<LoginResult> {
    return ApiClient.post('/auth/login', { username: username, password: password });
  }

  static getDevices(): Promise<Device[]> {
    return ApiClient.get('/devices');
  }

  static getDevice(id: string): Promise<Device> {
    return ApiClient.get('/devices/' + id);
  }

  static listEvents(deviceId?: string): Promise<EventSummary[]> {
    let path = '/command-loop/events?limit=100';
    if (deviceId && deviceId.length > 0) {
      path += '&device_id=' + encodeURIComponent(deviceId);
    }
    return ApiClient.get(path);
  }

  static getEvent(id: number): Promise<EventSummary> {
    return ApiClient.get('/command-loop/events/' + id);
  }

  static confirmEvent(id: number, operator: string): Promise<EventSummary> {
    return ApiClient.post('/command-loop/events/' + id + '/confirm', { operator: operator });
  }

  static rejectEvent(id: number, operator: string, reason: string): Promise<EventSummary> {
    return ApiClient.post('/command-loop/events/' + id + '/reject', {
      operator: operator,
      reason: reason
    });
  }

  static getTimeline(id: number): Promise<TimelineItem[]> {
    return ApiClient.get('/command-loop/events/' + id + '/timeline');
  }

  static getEventReport(id: number): Promise<EventReportData> {
    return ApiClient.post('/reports/event/' + id);
  }
}