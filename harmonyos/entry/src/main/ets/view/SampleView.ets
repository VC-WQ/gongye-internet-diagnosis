import { CloudClient } from '../common/CloudClient';
import { ChannelReading, WindowSnapshot, ageText, emptyWindow, errorMessage } from '../common/Models';
import { UiColor } from '../common/UiColor';

@Component
export struct SampleView {
  @Link loggedIn: boolean;
  @Link @Watch('onDeviceChanged') deviceId: string;
  @Link deviceName: string;
  @State snapshot: WindowSnapshot = emptyWindow();
  @State error: string = '';
  @State busy: boolean = false;
  private timer: number = -1;
  private generation: number = 0;

  aboutToAppear(): void {
    this.refresh();
    this.timer = setInterval(() => {
      this.refresh();
    }, 5000);
  }

  onDeviceChanged(): void {
    this.refresh();
  }

  aboutToDisappear(): void {
    this.stop();
  }

  build() {
    Column({ space: 12 }) {
      Text(this.deviceId.length > 0 ? `${this.deviceName} · ${this.deviceId}` : '先在设备页选择一台设备')
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
        .fontColor(UiColor.text)
        .width('100%')
      Text('采样从云侧滑动窗口读取，每 5 秒更新一次。')
        .fontSize(12)
        .fontColor(UiColor.muted)
        .width('100%')
      Text(ageText(this.snapshot))
        .fontSize(13)
        .fontColor(this.snapshot.stale ? UiColor.warn : UiColor.ok)
        .width('100%')

      if (this.error.length > 0) {
        Text(this.error)
          .fontSize(13)
          .fontColor(UiColor.fault)
          .width('100%')
      }

      if (this.snapshot.channels.length === 0) {
        Text(this.busy ? '正在读取采样' : '当前窗口没有可显示的通道')
          .fontSize(14)
          .fontColor(UiColor.muted)
          .width('100%')
          .layoutWeight(1)
      } else {
        List({ space: 8 }) {
          ForEach(this.snapshot.channels, (item: ChannelReading) => {
            ListItem() {
              Row() {
                Text(item.name)
                  .fontSize(15)
                  .fontColor(UiColor.text)
                  .layoutWeight(1)
                Text(item.text)
                  .fontSize(15)
                  .fontColor(UiColor.text)
              }
              .width('100%')
              .padding(14)
              .backgroundColor(UiColor.card)
              .borderRadius(12)
            }
          }, (item: ChannelReading) => item.name)
        }
        .width('100%')
        .layoutWeight(1)
        .scrollBar(BarState.Off)
      }
    }
    .width('100%')
    .height('100%')
    .padding({ left: 16, right: 16, top: 8, bottom: 8 })
    .alignItems(HorizontalAlign.Start)
  }

  private stop(): void {
    if (this.timer >= 0) {
      clearInterval(this.timer);
      this.timer = -1;
    }
  }

  private async refresh(): Promise<void> {
    if (this.deviceId.length === 0) {
      this.snapshot = emptyWindow();
      this.error = '';
      return;
    }
    const ticket = ++this.generation;
    const deviceId = this.deviceId;
    this.busy = true;
    try {
      const next = await CloudClient.windowOf(deviceId);
      if (ticket !== this.generation || deviceId !== this.deviceId) {
        return;
      }
      this.snapshot = next;
      this.error = '';
    } catch (error) {
      if (ticket !== this.generation) {
        return;
      }
      this.fail(error);
    } finally {
      if (ticket === this.generation) {
        this.busy = false;
      }
    }
  }

  private fail(error: Object): void {
    const message = errorMessage(error);
    this.error = message;
    if (message.indexOf('登录已失效') >= 0) {
      this.loggedIn = false;
    }
  }
}
