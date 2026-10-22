import { CloudClient } from '../common/CloudClient';
import {
  DiagnosisEvent,
  MAINTAIN_ACTIONS,
  MaintainAction,
  TimelineItem,
  WindowSnapshot,
  ageText,
  basisText,
  emptyEvent,
  emptyWindow,
  errorMessage,
  eventStatusText,
  formatConfidence,
  formatScore,
  isActiveStatus
} from '../common/Models';
import { UiColor } from '../common/UiColor';

@Component
export struct DiagnosisView {
  @Link loggedIn: boolean;
  @Link @Watch('onDeviceChanged') deviceId: string;
  @Link deviceName: string;
  @State snapshot: WindowSnapshot = emptyWindow();
  @State event: DiagnosisEvent = emptyEvent();
  @State timeline: Array<TimelineItem> = [];
  @State error: string = '';
  @State notice: string = '';
  @State reason: string = '';
  @State rejecting: boolean = false;
  @State busy: boolean = false;
  private generation: number = 0;

  aboutToAppear(): void {
    this.reload();
  }

  onDeviceChanged(): void {
    this.event = emptyEvent();
    this.timeline = [];
    this.notice = '';
    this.error = '';
    this.reason = '';
    this.rejecting = false;
    this.snapshot = emptyWindow();
    this.reload();
  }

  build() {
    Scroll() {
      Column({ space: 12 }) {
        Text(this.deviceId.length > 0 ? `${this.deviceName} · ${this.deviceId}` : '先在设备页选择一台设备')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(UiColor.text)
          .width('100%')
        Text('发起诊断会把当前采样窗口交给云侧。泵和电机的分数在云上计算，本机不另算一个分数。')
          .fontSize(12)
          .fontColor(UiColor.muted)
          .width('100%')
          .lineHeight(18)
        Text(ageText(this.snapshot))
          .fontSize(13)
          .fontColor(this.snapshot.stale ? UiColor.warn : UiColor.ok)
          .width('100%')
        Text('模型需要最近 30 个点。点数不够时，云侧会返回未评分。')
          .fontSize(12)
          .fontColor(UiColor.muted)
          .width('100%')

        Button(this.busy ? '处理中' : '发起诊断')
          .width('100%')
          .height(44)
          .fontColor('#F4FBFF')
          .backgroundColor(UiColor.primary)
          .enabled(this.canDiagnose())
          .onClick(() => {
            this.start();
          })

        Button('刷新')
          .width('100%')
          .height(36)
          .fontSize(14)
          .fontColor(UiColor.text)
          .backgroundColor(UiColor.card)
          .enabled(!this.busy && this.deviceId.length > 0)
          .onClick(() => {
            this.reload();
          })

        if (this.hasActive()) {
          Text('这台设备还有未闭环事件。下面显示当前事件，不再新建一条诊断。')
            .fontSize(13)
            .fontColor(UiColor.warn)
            .width('100%')
        }

        if (this.error.length > 0) {
          Text(this.error)
            .fontSize(13)
            .fontColor(UiColor.fault)
            .width('100%')
        }
        if (this.notice.length > 0) {
          Text(this.notice)
            .fontSize(13)
            .fontColor(UiColor.ok)
            .width('100%')
        }

        if (this.event.id > 0) {
          this.eventCard()
          this.actions()
          this.timelineBlock()
        }
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 8, bottom: 24 })
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .height('100%')
    .scrollBar(BarState.Off)
    .align(Alignment.Top)
  }

  @Builder
  eventCard() {
    Column({ space: 8 }) {
      Text(`事件 #${this.event.id} · ${eventStatusText(this.event.status)}`)
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
        .fontColor(UiColor.text)
        .width('100%')
      if (this.event.reused) {
        Text('云侧返回的是已有事件，没有新建诊断。')
          .fontSize(12)
          .fontColor(UiColor.warn)
          .width('100%')
      }
      Text(this.event.faultLabel.length > 0 ? this.event.faultLabel : '没有故障结论')
        .fontSize(15)
        .fontColor(UiColor.text)
        .width('100%')
      Text(`${this.event.scoreLabel.length > 0 ? this.event.scoreLabel : '本次模型分数'} ${formatScore(this.event.healthScore)}`)
        .fontSize(15)
        .fontColor(UiColor.text)
        .width('100%')
      Text(basisText(this.event.healthBasis))
        .fontSize(12)
        .fontColor(UiColor.muted)
        .width('100%')
      if (this.event.modelName.length > 0) {
        Text(`模型 ${this.event.modelName}`)
          .fontSize(12)
          .fontColor(UiColor.muted)
          .width('100%')
      }
      if (this.event.scoreFormula.length > 0) {
        Text(this.event.scoreFormula)
          .fontSize(12)
          .fontColor(UiColor.muted)
          .width('100%')
      }
      if (this.event.metricText.length > 0) {
        Text(this.event.metricText)
          .fontSize(12)
          .fontColor(UiColor.muted)
          .width('100%')
      }
      if (formatConfidence(this.event.confidence).length > 0) {
        Text(`模型置信度 ${formatConfidence(this.event.confidence)}`)
          .fontSize(12)
          .fontColor(UiColor.muted)
          .width('100%')
      }
      if (this.event.summary.length > 0) {
        Text(this.event.summary)
          .fontSize(14)
          .fontColor(UiColor.text)
          .width('100%')
          .lineHeight(22)
      }
      if (this.event.recommendation.length > 0) {
        Text(`维护建议：${this.event.recommendation}`)
          .fontSize(14)
          .fontColor(UiColor.text)
          .width('100%')
          .lineHeight(22)
      }
    }
    .width('100%')
    .padding(14)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor(UiColor.card)
    .borderRadius(12)
  }

  @Builder
  actions() {
    Column({ space: 8 }) {
      if (this.event.status === 'pending') {
        Text('确认只表示接受这次诊断并进入处置，还没有给设备下发动作。')
          .fontSize(12)
          .fontColor(UiColor.muted)
          .width('100%')
        Button('确认处置')
          .width('100%')
          .height(40)
          .fontColor('#F4FBFF')
          .backgroundColor(UiColor.primary)
          .enabled(!this.busy)
          .onClick(() => {
            this.confirm();
          })
        if (this.rejecting) {
          TextInput({ text: this.reason, placeholder: '拒绝原因' })
            .placeholderColor(UiColor.muted)
            .fontColor(UiColor.text)
            .backgroundColor(UiColor.bg)
            .borderRadius(8)
            .height(42)
            .onChange((value: string) => {
              this.reason = value;
            })
          Button('提交拒绝')
            .width('100%')
            .height(40)
            .fontColor(UiColor.text)
            .backgroundColor(UiColor.line)
            .enabled(!this.busy)
            .onClick(() => {
              this.reject();
            })
        } else {
          Button('拒绝')
            .width('100%')
            .height(40)
            .fontColor(UiColor.text)
            .backgroundColor(UiColor.line)
            .enabled(!this.busy)
            .onClick(() => {
              this.rejecting = true;
            })
        }
      } else if (this.event.status === 'handling') {
        Text('只能下发润滑、降载或检修。公开数据回放不能下发；若云侧拒绝，原因会显示在上面。下发成功只说明云侧已发布指令，不代表设备已经执行，也不代表故障已经恢复。')
          .fontSize(12)
          .fontColor(UiColor.muted)
          .width('100%')
          .lineHeight(18)
        ForEach(MAINTAIN_ACTIONS, (action: MaintainAction) => {
          Button(action.label)
            .width('100%')
            .height(40)
            .fontColor('#F4FBFF')
            .backgroundColor(UiColor.primary)
            .enabled(!this.busy)
            .onClick(() => {
              this.dispatch(action);
            })
        }, (action: MaintainAction) => action.code)
      } else if (this.event.status === 'observing') {
        Text('已进入观察期。本页没有设备回执查询，不能把这一步写成设备已经修好。')
          .fontSize(12)
          .fontColor(UiColor.warn)
          .width('100%')
      } else if (this.event.status === 'consulting') {
        Text('会诊还在进行，点刷新查看云侧结果。')
          .fontSize(12)
          .fontColor(UiColor.muted)
          .width('100%')
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  timelineBlock() {
    Column({ space: 6 }) {
      Text('状态记录')
        .fontSize(13)
        .fontColor(UiColor.muted)
        .width('100%')
      if (this.timeline.length === 0) {
        Text('还没有状态记录')
          .fontSize(12)
          .fontColor(UiColor.muted)
          .width('100%')
      } else {
        ForEach(this.timeline, (item: TimelineItem) => {
          Text(item.text)
            .fontSize(12)
            .fontColor(UiColor.text)
            .width('100%')
            .lineHeight(18)
        }, (item: TimelineItem, index: number) => `${index}:${item.text}`)
      }
    }
    .width('100%')
    .padding(14)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor(UiColor.card)
    .borderRadius(12)
  }

  private canDiagnose(): boolean {
    return !this.busy && this.deviceId.length > 0 && this.snapshot.count > 0 && !this.snapshot.stale && !this.hasActive();
  }

  private hasActive(): boolean {
    return this.event.id > 0 && this.event.deviceId === this.deviceId && isActiveStatus(this.event.status);
  }

  private async reload(): Promise<void> {
    if (this.deviceId.length === 0) {
      return;
    }
    const ticket = ++this.generation;
    const deviceId = this.deviceId;
    this.busy = true;
    this.error = '';
    try {
      const snapshot = await CloudClient.windowOf(deviceId);
      const latest = await CloudClient.latestEvent(deviceId);
      if (ticket !== this.generation || deviceId !== this.deviceId) {
        return;
      }
      this.snapshot = snapshot;
      if (latest === undefined || latest.deviceId !== deviceId) {
        this.event = emptyEvent();
        this.timeline = [];
      } else {
        this.event = latest;
        this.timeline = await CloudClient.timeline(latest.id);
      }
    } catch (error) {
      if (ticket === this.generation) {
        this.fail(error);
      }
    } finally {
      if (ticket === this.generation) {
        this.busy = false;
      }
    }
  }

  private async start(): Promise<void> {
    if (!this.canDiagnose()) {
      return;
    }
    const deviceId = this.deviceId;
    this.busy = true;
    this.error = '';
    this.notice = '';
    try {
      const fresh = await CloudClient.windowOf(deviceId);
      if (deviceId !== this.deviceId) {
        return;
      }
      this.snapshot = fresh;
      if (fresh.count === 0 || fresh.stale) {
        this.error = '暂无有效采样，请等待数据源恢复后再试';
        return;
      }
      const created = await CloudClient.createEvent(deviceId, fresh.points);
      if (deviceId !== this.deviceId) {
        return;
      }
      if (created.deviceId.length > 0 && created.deviceId !== deviceId) {
        throw new Error('云侧：诊断结果和当前设备不一致');
      }
      this.event = created;
      this.notice = created.reused ? '云侧复用了未闭环事件。' : '诊断已返回。';
      this.timeline = await CloudClient.timeline(created.id);
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
    }
  }

  private async confirm(): Promise<void> {
    if (this.busy || this.event.status !== 'pending') {
      return;
    }
    await this.applyEvent(await this.run(() => CloudClient.confirm(this.event.id)), '已确认，进入处置。还没有下发动作。');
  }

  private async reject(): Promise<void> {
    if (this.busy || this.event.status !== 'pending') {
      return;
    }
    if (this.reason.trim().length === 0) {
      this.error = '请填写拒绝原因';
      return;
    }
    const reason = this.reason.trim();
    const updated = await this.run(() => CloudClient.reject(this.event.id, reason));
    if (updated === undefined) {
      return;
    }
    this.reason = '';
    this.rejecting = false;
    await this.applyEvent(updated, '已拒绝。');
  }

  private async dispatch(action: MaintainAction): Promise<void> {
    if (this.busy || this.event.status !== 'handling') {
      return;
    }
    this.busy = true;
    this.error = '';
    this.notice = '';
    try {
      const submitted = await CloudClient.execute(this.event.id, action.code);
      this.event = submitted.event;
      const commandId = submitted.commandId.length > 0 ? submitted.commandId : '未返回';
      this.notice = `已把「${action.label}」提交到云侧。指令编号 ${commandId}。这只说明云侧已发布，不代表设备已经执行，也不代表故障已经恢复。`;
      this.timeline = await CloudClient.timeline(this.event.id);
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
    }
  }

  private async applyEvent(updated: DiagnosisEvent | undefined, notice: string): Promise<void> {
    if (updated === undefined) {
      return;
    }
    this.event = updated;
    this.notice = notice;
    try {
      this.timeline = await CloudClient.timeline(updated.id);
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  private async run(task: () => Promise<DiagnosisEvent>): Promise<DiagnosisEvent | undefined> {
    this.busy = true;
    this.error = '';
    this.notice = '';
    try {
      return await task();
    } catch (error) {
      this.fail(error);
      return undefined;
    } finally {
      this.busy = false;
    }
  }

  private fail(error: Object): void {
    const message = errorMessage(error);
    this.error = message;
    this.notice = '';
    if (message.indexOf('登录已失效') >= 0) {
      this.loggedIn = false;
    }
  }
}
