import * as echarts from 'echarts/core'
import { LineChart, BarChart, ScatterChart, HeatmapChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent, TitleComponent, VisualMapComponent, DatasetComponent, MarkLineComponent, MarkPointComponent, MarkAreaComponent, DataZoomComponent } from 'echarts/components'
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers'
import { LabelLayout } from 'echarts/features'
echarts.use([LineChart,BarChart,ScatterChart,HeatmapChart,PieChart,GridComponent,LegendComponent,TooltipComponent,TitleComponent,VisualMapComponent,DatasetComponent,MarkLineComponent,MarkPointComponent,MarkAreaComponent,DataZoomComponent,CanvasRenderer,SVGRenderer,LabelLayout])
export default echarts
