import { CloudClient } from '../common/CloudClient';
import { Session } from '../common/Session';
import { UiColor } from '../common/UiColor';
import { errorMessage } from '../common/Models';

@Component
export struct LoginView {
  @Link loggedIn: boolean;
  @State baseUrl: string = '';
  @State username: string = '';
  @State password: string = '';
  @State error: string = '';
  @State busy: boolean = false;

  aboutToAppear(): void {
    this.baseUrl = Session.baseUrl;
    this.username = Session.username;
  }

  build() {
    Scroll() {
      Column({ space: 14 }) {
        Text('设备诊断')
          .fontSize(28)
          .fontWeight(FontWeight.Medium)
          .fontColor(UiColor.text)
          .width('100%')
        Text('鸿蒙端。采样和诊断请求发给云侧，分数由云上的模型给出。')
          .fontSize(14)
          .fontColor(UiColor.muted)
          .width('100%')

        Text('云地址')
          .fontSize(13)
          .fontColor(UiColor.muted)
          .width('100%')
        TextInput({ text: this.baseUrl, placeholder: 'http://10.0.2.2:8000' })
          .placeholderColor(UiColor.muted)
          .fontColor(UiColor.text)
          .backgroundColor(UiColor.card)
          .borderRadius(8)
          .height(46)
          .onChange((value: string) => {
            this.baseUrl = value;
          })

        Text('用户名')
          .fontSize(13)
          .fontColor(UiColor.muted)
          .width('100%')
        TextInput({ text: this.username, placeholder: '用户名' })
          .placeholderColor(UiColor.muted)
          .fontColor(UiColor.text)
          .backgroundColor(UiColor.card)
          .borderRadius(8)
          .height(46)
          .onChange((value: string) => {
            this.username = value;
          })

        Text('密码')
          .fontSize(13)
          .fontColor(UiColor.muted)
          .width('100%')
        TextInput({ text: this.password, placeholder: '密码' })
          .type(InputType.Password)
          .placeholderColor(UiColor.muted)
          .fontColor(UiColor.text)
          .backgroundColor(UiColor.card)
          .borderRadius(8)
          .height(46)
          .onChange((value: string) => {
            this.password = value;
          })

        Button(this.busy ? '正在登录' : '登录')
          .width('100%')
          .height(46)
          .fontSize(16)
          .fontColor('#F4FBFF')
          .backgroundColor(UiColor.primary)
          .enabled(!this.busy)
          .onClick(() => {
            this.submit();
          })

        if (this.error.length > 0) {
          Text(this.error)
            .fontSize(13)
            .fontColor(UiColor.fault)
            .width('100%')
        }

        Text('模拟器访问电脑用 http://10.0.2.2:8000。真机填电脑的局域网地址，手机和电脑要在同一网络，并放行 8000 端口。首次启动的云侧账号是 admin / admin123。')
          .fontSize(12)
          .fontColor(UiColor.muted)
          .width('100%')
          .lineHeight(18)
      }
      .width('100%')
      .padding(20)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(UiColor.bg)
    .align(Alignment.Top)
    .scrollBar(BarState.Off)
  }

  private async submit(): Promise<void> {
    if (this.busy) {
      return;
    }
    if (this.baseUrl.trim().length === 0 || this.username.trim().length === 0 || this.password.length === 0) {
      this.error = '请填写云地址、用户名和密码';
      return;
    }
    this.busy = true;
    this.error = '';
    try {
      await CloudClient.login(this.username, this.password, this.baseUrl);
      this.loggedIn = true;
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = false;
    }
  }
}
