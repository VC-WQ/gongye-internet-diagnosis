import { LoginView } from '../view/LoginView';
import { MainView } from '../view/MainView';
import { Session } from '../common/Session';
import { UiColor } from '../common/UiColor';
import { errorMessage } from '../common/Models';

@Entry
@Component
struct Index {
  @State ready: boolean = false;
  @State loggedIn: boolean = false;
  @State deviceId: string = '';
  @State deviceName: string = '';
  @State bootError: string = '';

  async aboutToAppear(): Promise<void> {
    try {
      await Session.load();
      this.loggedIn = Session.token.length > 0;
    } catch (error) {
      this.bootError = errorMessage(error);
      this.loggedIn = false;
    } finally {
      this.ready = true;
    }
  }

  build() {
    if (!this.ready) {
      Column() {
        LoadingProgress()
          .width(32)
          .height(32)
          .color(UiColor.primary)
      }
      .width('100%')
      .height('100%')
      .backgroundColor(UiColor.bg)
      .justifyContent(FlexAlign.Center)
    } else if (!this.loggedIn) {
      Column() {
        if (this.bootError.length > 0) {
          Text(this.bootError)
            .fontSize(13)
            .fontColor(UiColor.fault)
            .width('100%')
            .padding({ left: 20, right: 20, top: 12 })
        }
        LoginView({ loggedIn: $loggedIn })
          .layoutWeight(1)
      }
      .width('100%')
      .height('100%')
      .backgroundColor(UiColor.bg)
    } else {
      MainView({
        loggedIn: $loggedIn,
        deviceId: $deviceId,
        deviceName: $deviceName
      })
    }
  }
}
