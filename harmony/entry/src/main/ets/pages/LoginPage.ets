import { router } from '@kit.ArkUI';
import { promptAction } from '@kit.ArkUI';
import { DataService } from '../service/DataService';
import { AuthStore } from '../service/AuthStore';

@Entry
@Component
struct LoginPage {
  @State username: string = '';
  @State password: string = '';
  @State loading: boolean = false;

  build() {
    Column({ space: 16 }) {
      Text('登录')
        .fontSize(28)
        .fontWeight(FontWeight.Bold)
      Text('工业设备智能诊断平台')
        .fontSize(14)
        .fontColor('#888888')

      Blank().height(20)

      TextInput({ placeholder: '用户名', text: this.username })
        .onChange((value: string) => {
          this.username = value;
        })
      TextInput({ placeholder: '密码', text: this.password })
        .type(InputType.Password)
        .onChange((value: string) => {
          this.password = value;
        })

      Button(this.loading ? '登录中…' : '登录')
        .width('100%')
        .enabled(!this.loading)
        .onClick(() => this.doLogin())

      Button('注册新账号')
        .width('100%')
        .backgroundColor('#00000000')
        .fontColor('#0A59F7')
        .onClick(() => this.doRegister())

      Button('返回')
        .width('100%')
        .backgroundColor('#00000000')
        .fontColor('#666666')
        .onClick(() => router.back())
    }
    .width('100%')
    .height('100%')
    .padding(24)
    .justifyContent(FlexAlign.Center)
  }

  doLogin(): void {
    if (this.username.length < 3 || this.password.length < 6) {
      promptAction.showToast({ message: '用户名至少 3 位，密码至少 6 位' });
      return;
    }
    this.loading = true;
    DataService.login(this.username, this.password)
      .then((result) => {
        AuthStore.saveLogin(result.token, result.user);
        promptAction.showToast({ message: '登录成功' });
        router.back();
      })
      .catch((err: Error) => {
        promptAction.showToast({ message: err.message });
      })
      .finally(() => {
        this.loading = false;
      });
  }

  doRegister(): void {
    promptAction.showToast({ message: '请使用 Web 端管理系统完成注册' });
  }
}