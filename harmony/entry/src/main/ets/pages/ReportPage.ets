import { router } from '@kit.ArkUI';
import { promptAction } from '@kit.ArkUI';
import { DataService } from '../service/DataService';
import { AuthStore } from '../service/AuthStore';

interface ReportPageParams {
  event_id?: number;
}

@Entry
@Component
struct ReportPage {
  @State eventIdInput: string = '';
  @State reportText: string = '';
  @State loading: boolean = false;

  aboutToAppear(): void {
    const params = router.getParams() as ReportPageParams;
    if (params && params.event_id) {
      this.eventIdInput = Number(params.event_id).toString();
      this.loadReport();
    }
  }

  build() {
    Column() {
      Row() {
        Text('诊断报告')
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

      Row({ space: 8 }) {
        TextInput({ placeholder: '输入事件 ID', text: this.eventIdInput })
          .type(InputType.Number)
          .layoutWeight(1)
          .onChange((value: string) => {
            this.eventIdInput = value;
          })
        Button('生成报告')
          .height(40)
          .onClick(() => this.loadReport())
      }
      .width('100%')
      .padding({ left: 16, right: 16, bottom: 8 })

      if (this.loading) {
        Column() {
          LoadingProgress().width(48).height(48)
          Text('生成中…').fontSize(13).fontColor('#888888').margin({ top: 8 })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else {
        Scroll() {
          Text(this.reportText.length > 0 ? this.reportText : '输入事件 ID 后点击「生成报告」')
            .fontSize(14)
            .fontColor('#333333')
            .width('100%')
            .padding(16)
            .textAlign(TextAlign.Start)
        }
        .width('100%')
        .layoutWeight(1)
        .backgroundColor('#FFFFFF')
        .scrollBar(BarState.Auto)
        .align(Alignment.Top)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F5F6FA')
  }

  loadReport(): void {
    if (!AuthStore.isLoggedIn()) {
      promptAction.showToast({ message: '请先登录' });
      return;
    }
    const id = Number(this.eventIdInput);
    if (!id || id <= 0) {
      promptAction.showToast({ message: '请输入有效的事件 ID' });
      return;
    }
    this.loading = true;
    DataService.getEventReport(id)
      .then((data) => {
        this.reportText = data.report;
      })
      .catch((err: Error) => {
        promptAction.showToast({ message: err.message });
      })
      .finally(() => {
        this.loading = false;
      });
  }
}