import { router } from '@kit.ArkUI';
import { promptAction } from '@kit.ArkUI';
import { DataService } from '../service/DataService';
import { AuthStore } from '../service/AuthStore';
import { Device } from '../model/Models';

@Entry
@Component
struct Index {
  @State devices: Device[] = [];
  @State loading: boolean = false;
  @State errorMsg: string = '';

  aboutToAppear(): void {
    this.loadDevices();
  }

  onPageShow(): void {
    this.loadDevices();
  }

  build() {
    Column() {
      // 顶部标题栏
      Row() {
        Column({ space: 2 }) {
          Text('工业设备智能诊断')
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
          Text('端-云-智 · HarmonyOS 应用端')
            .fontSize(12)
            .fontColor('#888888')
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        Button(this.loginLabel())
          .height(32)
          .fontSize(13)
          .onClick(() => {
            if (AuthStore.isLoggedIn()) {
              AuthStore.clear();
              promptAction.showToast({ message: '已退出登录' });
              this.loadDevices();
            } else {
              router.pushUrl({ url: 'pages/LoginPage' });
            }
          })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 8, bottom: 8 })

      // 错误提示 / 内容区
      if (this.errorMsg.length > 0) {
        Text(this.errorMsg)
          .fontSize(13)
          .fontColor('#FF3B30')
          .width('100%')
          .padding(12)
      }

      if (this.loading) {
        Column() {
          LoadingProgress()
            .width(48)
            .height(48)
          Text('加载设备中…').fontSize(13).fontColor('#888888').margin({ top: 8 })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else {
        List({ space: 10 }) {
          ForEach(this.devices, (item: Device) => {
            ListItem() {
              this.deviceCard(item)
            }
          }, (item: Device) => item.id)
        }
        .width('100%')
        .layoutWeight(1)
        .padding({ left: 16, right: 16 })
        .scrollBar(BarState.Off)
      }

      // 底部导航
      Row() {
        this.navItem('设备看板', true, () => {
          this.loadDevices();
        })
        this.navItem('诊断事件', false, () => {
          router.pushUrl({ url: 'pages/EventPage', params: { device_id: '' } });
        })
        this.navItem('诊断报告', false, () => {
          router.pushUrl({ url: 'pages/ReportPage' });
        })
      }
      .width('100%')
      .height(56)
      .border({ width: { top: 1 }, color: '#EEEEEE' })
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F5F6FA')
  }

  @Builder
  deviceCard(item: Device) {
    Column({ space: 8 }) {
      Row() {
        Column({ space: 2 }) {
          Text(item.name)
            .fontSize(17)
            .fontWeight(FontWeight.Medium)
          Text(item.device_type + ' · ' + item.id)
            .fontSize(12)
            .fontColor('#888888')
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        Text(item.status)
          .fontSize(12)
          .fontColor('#FFFFFF')
          .padding({ left: 10, right: 10, top: 4, bottom: 4 })
          .backgroundColor(this.statusColor(item.status))
          .borderRadius(12)
      }
      .width('100%')

      Row() {
        Text('健康分')
          .fontSize(12)
          .fontColor('#666666')
          .layoutWeight(1)
        Text(item.health_score.toFixed(0))
          .fontSize(14)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.healthColor(item.health_score))
      }
      .width('100%')

      Progress({ value: item.health_score, total: 100, type: ProgressType.Linear })
        .width('100%')
        .color(this.healthColor(item.health_score))

      Row() {
        Text('边缘异常分 ' + (item.edge_anomaly_score * 100).toFixed(0) + '%')
          .fontSize(11)
          .fontColor('#999999')
      }
      .width('100%')
    }
    .padding(14)
    .backgroundColor('#FFFFFF')
    .borderRadius(12)
    .onClick(() => {
      router.pushUrl({ url: 'pages/EventPage', params: { device_id: item.id } });
    })
  }

  @Builder
  navItem(label: string, active: boolean, action: () => void) {
    Column({ space: 2 }) {
      Text(label)
        .fontSize(13)
        .fontColor(active ? '#0A59F7' : '#666666')
    }
    .layoutWeight(1)
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .onClick(action)
  }

  loadDevices(): void {
    this.loading = true;
    this.errorMsg = '';
    DataService.getDevices()
      .then((list) => {
        this.devices = list;
      })
      .catch((err: Error) => {
        this.errorMsg = '加载失败：' + err.message;
      })
      .finally(() => {
        this.loading = false;
      });
  }

  loginLabel(): string {
    const user = AuthStore.getUser();
    if (user) {
      return user.username;
    }
    return '登录';
  }

  statusColor(status: string): string {
    if (status === 'healthy') return '#34C759';
    if (status === 'degraded') return '#FF9500';
    if (status === 'fault') return '#FF3B30';
    return '#999999';
  }

  healthColor(score: number): string {
    if (score >= 85) return '#34C759';
    if (score >= 60) return '#FF9500';
    return '#FF3B30';
  }
}