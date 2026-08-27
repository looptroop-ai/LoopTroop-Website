import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import Layout from './Layout.vue'
import MermaidBlock from './MermaidBlock.vue'
import DownloadHistory from './DownloadHistory.vue'
import ProjectStats from './ProjectStats.vue'
import { useStableHashScroll } from './hashScroll'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout,
  setup() {
    useStableHashScroll()
  },
  enhanceApp({ app }) {
    app.component('MermaidBlock', MermaidBlock)
    app.component('DownloadHistory', DownloadHistory)
    app.component('ProjectStats', ProjectStats)
  },
} satisfies Theme
