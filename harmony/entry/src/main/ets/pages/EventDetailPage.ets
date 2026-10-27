import { router } from '@kit.ArkUI';
import { promptAction } from '@kit.ArkUI';
import { DataService } from '../service/DataService';
import { AuthStore } from '../service/AuthStore';
import { EventSummary, TimelineItem } from '../model/Models';

interface EventDetailParams {
  event_id?: number;
}

@Entry
@Component
struct EventDetailPage {
  @State eventId: number = 0;
  @State event: EventSummary | null = null;
  @State timeline: TimelineItem[] = [];
  @State loading: boolean = false;
  @State errorMsg: string = '';

  aboutToAppear(): void {
    const params = router.getParams() as EventDetailParams;
    if (params && params.event_id) {
      this.eventId = Number(params.event_id);
    }
    this.reload();
  }

  build() {
    Column() {
      Row() {
        Text('事件详情')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .layoutWeight(1)
        Button('返回')
          .height(32)
          .fontSize(13)
          .onClick(() => router.back())
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 8, bottom: 8 })

      if (this.errorMsg.length > 0) {
        Text(this.errorMsg)
          .fontSize(13)
          .fontColor('#FF3B30')
          .width('100%')
          .padding(12)
      }

      if (this.loading && !this.event) {
        Column() {
          LoadingProgress().width(48).height(48)
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else {
        Scroll() {
          Column({ space: 12 }) {
            if (this.event) {
              this.detailCard(this.event)
            }
            this.actionsCard()
            this.timelineCard()
          }
          .width('100%')
          .padding(16)
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off)
        .align(Alignment.Top)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F5F6FA')
  }

  @Builder
  detailCard(ev: EventSummary) {
    Column({ space: 6 }) {
      Row() {
        Text('事件 #' + ev.id)
          .fontSize(17)
          .fontWeight(FontWeight.Bold)
          .layoutWeight(1)
        Text(this.stateLabel(ev.status_state))
          .fontSize(12)
          .fontColor('#FFFFFF')
          .padding({ left: 10, right: 10, top: 4, bottom: 4 })
          .backgroundColor(this.stateColor(ev.status_state))
          .borderRadius(12)
      }
      .width('100%')

      Text('设备 ' + ev.device_id + ' · 严重度 ' + ev.severity)
        .fontSize(13)
        .fontColor('#666666')

      Text('故障结论：' + this.faultLabel(ev))
        .fontSize(13)
      if (ev.confidence !== null) {
        Text('置信度：' + (ev.confidence * 100).toFixed(1) + '%')
          .fontSize(13)
      }
      if (ev.health_score !== null) {
        Text('健康分：' + ev.health_score.toFixed(0))
          .fontSize(13)
      }

      Divider().margin({ top: 4, bottom: 4 })

      if (ev.report && ev.report.summary) {
        Text('诊断摘要')
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .width('100%')
        Text(ev.report.summary)
          .fontSize(12)
          .fontColor('#444444')
          .width('100%')
      }
      if (ev.report && ev.report.recommendation) {
        Text('维护建议')
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .width('100%')
          .margin({ top: 6 })
        Text(ev.report.recommendation)
          .fontSize(12)
          .fontColor('#444444')
          .width('100%')
      }
    }
    .padding(14)
    .backgroundColor('#FFFFFF')
    .borderRadius(12)
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  actionsCard() {
    Column({ space: 10 }) {
      if (this.event && this.event.status_state === 'pending') {
        Text('人工确认')
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .width('100%')
        Row({ space: 12 }) {
          Button('确认执行')
            .layoutWeight(1)
            .backgroundColor('#34C759')
            .onClick(() => this.doConfirm())
          Button('拒绝（误报）')
            .layoutWeight(1)
            .backgroundColor('#FF3B30')
            .onClick(() => this.doReject())
        }
        .width('100%')
      } else {
        Text(this.event ? '当前状态无需人工确认' : '')
          .fontSize(12)
          .fontColor('#999999')
      }

      Button('查看完整诊断报告')
        .width('100%')
        .onClick(() => {
          router.pushUrl({ url: 'pages/ReportPage', params: { event_id: this.eventId } });
        })
    }
    .padding(14)
    .backgroundColor('#FFFFFF')
    .borderRadius(12)
    .width('100%')
  }

  @Builder
  timelineCard() {
    Column({ space: 8 }) {
      Text('状态时间线')
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
        .width('100%')

      if (this.timeline.length === 0) {
        Text('暂无时间线记录')
          .fontSize(12)
          .fontColor('#999999')
      } else {
        ForEach(this.timeline, (item: TimelineItem) => {
          Row() {
            Column({ space: 2 }) {
              Text((item.from_state ?? '初始') + ' → ' + item.to_state)
                .fontSize(13)
                .fontWeight(FontWeight.Medium)
              Text(item.reason)
                .fontSize(11)
                .fontColor('#666666')
              Text(item.operator + ' · ' + this.formatTime(item.created_at))
                .fontSize(10)
                .fontColor('#999999')
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)
          }
          .width('100%')
          .padding({ top: 4, bottom: 4 })
        }, (item: TimelineItem) => item.id.toString())
      }
    }
    .padding(14)
    .backgroundColor('#FFFFFF')
    .borderRadius(12)
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  reload(): void {
    if (!AuthStore.isLoggedIn()) {
      this.errorMsg = '请先登录';
      return;
    }
    this.loading = true;
    this.errorMsg = '';
    DataService.getEvent(this.eventId)
      .then((ev) => {
        this.event = ev;
      })
      .catch((err: Error) => {
        this.errorMsg = '加载事件失败：' + err.message;
      })
      .finally(() => {
        this.loading = false;
      });
    DataService.getTimeline(this.eventId)
      .then((tl) => {
        this.timeline = tl;
      })
      .catch((err: Error) => {
        this.errorMsg = '加载时间线失败：' + err.message;
      });
  }

  doConfirm(): void {
    const user = AuthStore.getUser();
    const operator = user ? user.username : 'system';
    DataService.confirmEvent(this.eventId, operator)
      .then(() => {
        promptAction.showToast({ message: '已确认执行' });
        this.reload();
      })
      .catch((err: Error) => {
        promptAction.showToast({ message: err.message });
      });
  }

  doReject(): void {
    const user = AuthStore.getUser();
    const operator = user ? user.username : 'system';
    DataService.rejectEvent(this.eventId, operator, '人工判定无故障')
      .then(() => {
        promptAction.showToast({ message: '已拒绝' });
        this.reload();
      })
      .catch((err: Error) => {
        promptAction.showToast({ message: err.message });
      });
  }

  faultLabel(ev: EventSummary): string {
    const ft = ev.fault_type;
    if (!ft || ft === 'normal') return '正常';
    return ft;
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
    return iso.replace('T', ' ').substring(0, 19);
  }
}