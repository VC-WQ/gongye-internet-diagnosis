import http from '@ohos.net.http';
import { ApiConfig } from '../common/Constants';
import { AuthStore } from './AuthStore';

interface ErrorBody {
  detail?: string;
}

/**
 * 通用 HTTP 客户端：统一 base URL、鉴权头、JSON 解析与错误处理。
 * 对应后端 FastAPI 的 /api/v1 前缀。
 */
export class ApiClient {
  static get<T>(path: string): Promise<T> {
    return ApiClient.request<T>(path, http.RequestMethod.GET);
  }

  static post<T>(path: string, body?: Object): Promise<T> {
    return ApiClient.request<T>(path, http.RequestMethod.POST, body);
  }

  private static async request<T>(
    path: string,
    method: http.RequestMethod,
    body?: Object
  ): Promise<T> {
    const token = AuthStore.getToken();

    let header: Object;
    if (token.length > 0) {
      header = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      };
    } else {
      header = { 'Content-Type': 'application/json' };
    }

    const httpRequest = http.createHttp();
    try {
      const response = await httpRequest.request(ApiConfig.BASE_URL + path, {
        method: method,
        header: header,
        extraData: body ? JSON.stringify(body) : undefined,
        connectTimeout: 10000,
        readTimeout: 20000,
        expectDataType: http.HttpDataType.STRING
      });

      const code = response.responseCode;
      if (code !== 200) {
        const detail = ApiClient.extractDetail(response.result as string, code);
        throw new Error(detail);
      }

      const text = response.result as string;
      return JSON.parse(text) as T;
    } finally {
      httpRequest.destroy();
    }
  }

  private static extractDetail(raw: string, code: number): string {
    try {
      const obj = JSON.parse(raw) as ErrorBody;
      const detail = obj.detail;
      if (detail && detail.length > 0) {
        return detail;
      }
    } catch (e) {
      // 忽略解析失败，使用默认文案
    }
    return '请求失败（HTTP ' + code + '）';
  }
}