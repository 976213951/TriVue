<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { AppShell, UiButton, UiBadge } from '@research-platform/design-system'
import { isDark, toggleTheme } from '@research-platform/design-system/theme'
const route=useRoute()
const pageName=computed(()=>route.path.includes('compaction')?'组件与消融实验':route.path.includes('engines')?'块存储诊断':'整套系统对照')
</script>
<template>
  <AppShell>
    <template #brand><RouterLink class="brand" to="/benchmark" aria-label="ScalaFusion 整套系统对照"><span class="brand-mark" aria-hidden="true">SF</span><strong>ScalaFusion</strong></RouterLink></template>
    <template #navigation>
      <p class="nav-group-label">工作区</p>
      <nav class="snow-nav" aria-label="系统导航">
        <RouterLink to="/benchmark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg><span>整套系统对照</span></RouterLink>
        <RouterLink to="/diagnostics/compaction"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 20V10m8 10V4m8 16v-7M2 20h20"/></svg><span>组件与消融实验</span></RouterLink>
        <RouterLink to="/diagnostics/engines"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M6 7h.01M6 17h.01M16 7h2m-2 10h2"/></svg><span>块存储诊断</span></RouterLink>
      </nav>
    </template>
    <template #footer><p>存算协同优化系统</p><span>ScalaAFA · CaaS-LSM · dPP</span></template>
    <template #header><span class="topbar-label">研究平台 <span aria-hidden="true">/</span> <span class="topbar-current">{{pageName}}</span></span><div class="topbar-actions"><UiBadge>System 03</UiBadge><UiButton variant="ghost" :aria-label="isDark?'切换为浅色主题':'切换为深色主题'" :title="isDark?'切换为浅色主题':'切换为深色主题'" @click="toggleTheme"><svg v-if="isDark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M20 15A8.5 8.5 0 019 4a8.5 8.5 0 1011 11z"/></svg><span>{{isDark?'浅色':'深色'}}</span></UiButton></div></template>
    <RouterView />
  </AppShell>
</template>
