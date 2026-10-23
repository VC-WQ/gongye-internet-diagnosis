import { Session } from '../common/Session';
import { UiColor } from '../common/UiColor';
import { DeviceView } from './DeviceView';
import { SampleView } from './SampleView';
import { DiagnosisView } from './DiagnosisView';

@Component
export struct MainView {
  @Link loggedIn: boolean;
  @Link deviceId: string;
  @Link deviceName: string;

  build() {
    Column() {
      Row() {
        Column({ space: 2 }) {
          Text('鸿蒙端')
            .fontSize(11)
            .fontColor(UiColor.ok)
          Text(this.deviceName.length > 0 ? this.deviceName : '设备诊断')
            .fontSize(18)
            .fontWeight(FontWeight.Medium)
            .fontColor(UiColor.text)
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        Button('退出')
          .height(32)
          .fontSize(13)
          .fontColor(UiColor.text)
          .backgroundColor(UiColor.card)
          .onClick(() => {
            this.logout();
          })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 12, bottom: 8 })

      Text(Session.username.length > 0 ? `已登录 ${Session.username}` : '已登录')
        .fontSize(12)
        .fontColor(UiColor.muted)
        .width('100%')
        .padding({ left: 16, right: 16, bottom: 8 })

      Tabs() {
        TabContent() {
          DeviceView({
            loggedIn: $loggedIn,
            deviceId: $deviceId,
            deviceName: $deviceName
          })
        }.tabBar('设备')

        TabContent() {
          SampleView({
            loggedIn: $loggedIn,
            deviceId: $deviceId,
            deviceName: $deviceName
          })
        }.tabBar('采样')

        TabContent() {
          DiagnosisView({
            loggedIn: $loggedIn,
            deviceId: $deviceId,
            deviceName: $deviceName
          })
        }.tabBar('诊断')
      }
      .layoutWeight(1)
      .width('100%')
      .barHeight(48)
      .barMode(BarMode.Fixed)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(UiColor.bg)
  }

  private async logout(): Promise<void> {
    await Session.clearLogin();
    this.deviceId = '';
    this.deviceName = '';
    this.loggedIn = false;
  }
}
