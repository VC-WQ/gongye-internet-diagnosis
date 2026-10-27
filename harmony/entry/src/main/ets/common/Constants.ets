/**
 * 全局配置：后端服务地址。
 *
 * - HarmonyOS 模拟器：宿主机的后端可用 http://10.0.2.2:8000 访问。
 * - 真机：需改为后端所在电脑的局域网 IP，如 http://192.168.1.100:8000。
 * 后端接口统一挂载在 /api/v1 前缀下。
 */
export class ApiConfig {
  static readonly BASE_URL: string = 'http://10.0.2.2:8000/api/v1';
}