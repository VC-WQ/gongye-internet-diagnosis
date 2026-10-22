import { CloudClient } from '../common/CloudClient';
import {
  DeviceItem,
  deviceStatusColor,
  deviceStatusText,
  deviceTypeText,
  errorMessage,
  formatClock,
  formatScore
} from '../common/Models';
import { UiColor } from '../common/UiColor';

@Component
export struct DeviceView {
  @Link loggedIn: boolean;
  @Link deviceId: string;
  @Link deviceName: string;
  @State devices: Array<DeviceItem> = [];
  @State error: string = '';
  @State busy: boolean = false;

  aboutToAppear(): void {
    this.refresh();
  }

  build() {
    Column({ space: 12 }) {
      Row() {
        Text('设备来自云侧目录')
          .fontSize(13)
          .fontColor(UiColor.muted)
          .layoutWeight(1)
        Button('刷新')
          .height(32)
          .fontSize(13)
          .fontColor(UiColor.text)
          .backgroundColor(UiColor.card)
          .enabled(!this.busy)
          .onClick(() => {
            this.refresh();
          })
      }
      .width('100%')

      if (this.error.length > 0) {
        Text(this.error)
          .fontSize(13)
          .fontColor(UiColor.fault)
          .width('100%')
      }

      if (this.busy && this.devices.length === 0) {
        LoadingProgress()
          .width(28)
          .height(28)
          .color(UiColor.primary)
      } else if (!this.busy && this.devices.length === 0 && this.error.length === 0) {
        Text('云侧还没有设备')
          .fontSize(14)
          .fontColor(UiColor.muted)
          .width('100%')
      } else {
        List({ space: 10 }) {
          ForEach(this.devices, (item: DeviceItem) => {
            ListItem() {
              this.deviceCard(item)
            }
          }, (item: DeviceItem) => item.id)
        }
        .width('100%')
        .layoutWeight(1)
        .scrollBar(BarState.Off)
      }
    }
    .width('100%')
    .height('100%')
    .padding({ left: 16, right: 16, top: 8, bottom: 8 })
  }

  @Builder
  deviceCard(item: DeviceItem) {
    Column({ space: 6 }) {
      Row() {
        Text(item.name.length > 0 ? item.name : item.id)
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(UiColor.text)
          .layoutWeight(1)
        Text(deviceStatusText(item.status))
          .fontSize(12)
          .fontColor(deviceStatusColor(item.status))
      }
      .width('100%')

      Text(`${item.id} · ${deviceTypeText(item.deviceType)}`)
        .fontSize(12)
        .fontColor(UiColor.muted)
        .width('100%')

      Text(`目录健康分 ${formatScore(item.healthScore)} · 边缘自检 ${formatScore(item.edgeAnomalyScore)}`)
        .fontSize(12)
        .fontColor(UiColor.muted)
        .width('100%')

      Text(`目录更新 ${formatClock(item.lastUpdated)}`)
        .fontSize(12)
        .fontColor(UiColor.muted)
        .width('100%')

      Text('目录健康分是设备表里的记录，不是这次诊断算出来的。')
        .fontSize(11)
        .fontColor(UiColor.muted)
        .width('100%')
    }
    .width('100%')
    .padding(14)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor(UiColor.card)
    .borderRadius(12)
    .border({
      width: this.deviceId === item.id ? 1 : 0,
      color: UiColor.ok
    })
    .onClick(() => {
      this.deviceId = item.id;
      this.deviceName = item.name.length > 0 ? item.name : item.id;
    })
  }

  private async refresh(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.error = '';
    try {
      this.devices = await CloudClient.devices();
      if (this.deviceId.length === 0 && this.devices.length > 0) {
        this.deviceId = this.devices[0].id;
        this.deviceName = this.devices[0].name.length > 0 ? this.devices[0].name : this.devices[0].id;
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
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
