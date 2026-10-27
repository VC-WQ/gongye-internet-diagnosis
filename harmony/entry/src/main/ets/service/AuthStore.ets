import { AuthUser } from '../model/Models';

/**
 * 轻量登录态存储：使用 AppStorage 内存级保存 token 与当前用户。
 * 演示用途即可；如需重启后保持登录，可替换为 data_preferences 持久化。
 */
const KEY_TOKEN: string = 'auth_token';
const KEY_USER: string = 'auth_user';

export class AuthStore {
  static saveLogin(token: string, user: AuthUser): void {
    AppStorage.setOrCreate<string>(KEY_TOKEN, token);
    AppStorage.setOrCreate<AuthUser>(KEY_USER, user);
  }

  static getToken(): string {
    const token = AppStorage.get<string>(KEY_TOKEN);
    return token ?? '';
  }

  static getUser(): AuthUser | undefined {
    return AppStorage.get<AuthUser>(KEY_USER);
  }

  static isLoggedIn(): boolean {
    return AuthStore.getToken().length > 0;
  }

  static clear(): void {
    AppStorage.setOrCreate<string>(KEY_TOKEN, '');
    AppStorage.delete(KEY_USER);
  }
}