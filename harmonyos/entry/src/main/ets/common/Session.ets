import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';

const PREF_NAME: string = 'diagnosis_cloud';
const DEFAULT_BASE: string = 'http://10.0.2.2:8000';

export class Session {
  static context: common.UIAbilityContext | undefined = undefined;
  static token: string = '';
  static username: string = '';
  static role: string = '';
  static baseUrl: string = DEFAULT_BASE;

  static async load(): Promise<void> {
    const store = await Session.open();
    Session.token = textValue(await store.get('token', ''));
    Session.username = textValue(await store.get('username', ''));
    Session.role = textValue(await store.get('role', ''));
    const saved = textValue(await store.get('baseUrl', DEFAULT_BASE));
    Session.baseUrl = saved.length > 0 ? saved : DEFAULT_BASE;
  }

  static async save(): Promise<void> {
    const store = await Session.open();
    await store.put('token', Session.token);
    await store.put('username', Session.username);
    await store.put('role', Session.role);
    await store.put('baseUrl', Session.baseUrl);
    await store.flush();
  }

  static async clearLogin(): Promise<void> {
    Session.token = '';
    Session.username = '';
    Session.role = '';
    await Session.save();
  }

  static endpoint(path: string): string {
    let base = Session.baseUrl.trim();
    while (base.endsWith('/')) {
      base = base.substring(0, base.length - 1);
    }
    if (base.indexOf('http://') !== 0 && base.indexOf('https://') !== 0) {
      throw new Error('云侧：云地址需要以 http:// 或 https:// 开头');
    }
    return `${base}/api/v1${path}`;
  }

  private static async open(): Promise<preferences.Preferences> {
    if (Session.context === undefined) {
      throw new Error('云侧：应用尚未就绪');
    }
    return preferences.getPreferences(Session.context, PREF_NAME);
  }
}

function textValue(value: string | number | boolean | Object | null | undefined): string {
  return typeof value === 'string' ? value : '';
}
