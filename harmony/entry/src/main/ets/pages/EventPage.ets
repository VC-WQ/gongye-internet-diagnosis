import { router } from '@kit.ArkUI';
import { DataService } from '../service/DataService';
import { AuthStore } from '../service/AuthStore';
import { EventSummary } from '../model/Models';

interface EventPageParams {
  device_id?: string;
}

@Entry
@Component
struct EventPage {
  @State events: EventSummary[] = [];
  @State loading: boolean = false;
  @State errorMsg: string = '';
  @State deviceId: string = '';

  aboutToAppear(): void {
    const params = router.getParams() as EventPageParams;
    if (params && params.device_id) {
      this.deviceId = params.device_id;
    }
    this.loadEvents();
  }

  build() {
    Column() {
      Row() {
        Text('诊断事件')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .layoutWeight(1)
        Button('刷新')
          .height(32)
          .fontSize(13)
          .onClick(() => this.loadEvents())
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 8, bottom: 8 })

      if (this.deviceId.length > 0) {
        Text('设备：' + this.deviceId)
          .fontSize(12)
          .fontColor('#0A59F7')
          .width('100%')
          .padding({ left: 16, right: 16, bottom: 4 })
      }

      if (this.errorMsg.length > 0) {
        Text(this.errorMsg)
          .fontSize(13)
          .fontColor('#FF3B30')
          .width('100%')
          .padding(12)
      }

      if (this.loading) {
        Column() {
          LoadingProgress().width(48).height(48)
          Text('加载事件中…').fontSize(13).fontColor('#888888').margin({ top: 8 })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else if (this.events.length === 0) {
        Column() {
          Text('暂无诊断事件').fontSize(14).fontColor('#999999')
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else {
        List({ space: 10 }) {
          ForEach(this.events, (item: EventSummary) => {
            ListItem() {
              this.eventCard(item)
            }
          }, (item: EventSummary) => item.id.toString())
        }
        .width('100%')
        .layoutWeight(1)
        .padding({ left: 16, right: 16 })
        .scrollBar(BarState.Off)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F5F6FA')
  }

  @Builder
  eventCard(item: EventSummary) {
    Column({ space: 6 }) {
      Row() {
        Text('# ' + item.id)
          .fontSize(15)
          .fontWeight(FontWeight.Bold)
          .layoutWeight(1)
        Text(this.stateLabel(item.status_state))
          .fontSize(12)
          .fontColor('#FFFFFF')
          .padding({ left: 10, right: 10, top: 4, bottom: 4 })
          .backgroundColor(this.stateColor(item.status_state))
          .borderRadius(12)
      }
      .width('100%')

      Text('设备 ' + item.device_id + ' · 严重度 ' + item.severity)
        .fontSize(12)
        .fontColor('#666666')

      Text('故障类型：' + (item.fault_type && item.fault_type !== 'normal' ? item.fault_type : '正常/未确定'))
        .fontSize(12)
        .fontColor('#333333')

      if (item.timestamp) {
        Text(this.formatTime(item.timestamp))
          .fontSize(11)
          .fontColor('#999999')
      }
    }
    .padding(14)
    .backgroundColor('#FFFFFF')
    .borderRadius(12)
    .onClick(() => {
      router.pushUrl({ url: 'pages/EventDetailPage', params: { event_id: item.id } });
    })
  }

  loadEvents(): void {
    if (!AuthStore.isLoggedIn()) {
      this.errorMsg = '请先登录后再查看事件';
      return;
    }
    this.loading = true;
    this.errorMsg = '';
    DataService.listEvents(this.deviceId)
      .then((list) => {
        this.events = list;
      })
      .catch((err: Error) => {
        this.errorMsg = '加载失败：' + err.message;
      })
      .finally(() => {
        this.loading = false;
      });
  }

  stateLabel(state: string | null): string {
    if (!state) return '未知';
    if (state === 'normal') return '正常';
    if (state === 'warning') return '预警';
    if (state === 'alarm') return '告警';
    if (state === 'consulting') return '会诊中';
    if (state === 'pending') return '待确认';
    if (state === 'handling') return '处置中';
    if (state === 'observing') return '观察中';
    if (state === 'recovered') return '已恢复';
    if (state === 'relapsed') return '复发';
    return state;
  }

  stateColor(state: string | null): string {
    if (state === 'alarm' || state === 'relapsed') return '#FF3B30';
    if (state === 'warning' || state === 'pending' || state === 'handling') return '#FF9500';
    if (state === 'recovered' || state === 'normal') return '#34C759';
    return '#0A84FF';
  }

  formatTime(iso: string): string {
    if (!iso) return '';
    const t = iso.replace('T', ' ').substring(0, 19);
    return t;
  }
}