<script setup lang="ts">
import { UiButton, UiCard, UiBadge, DataTable, PageLayout } from '@research-platform/design-system'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import MetricChart from '../components/MetricChart.vue'
import type { EChartsOption } from '../domain/dashboard'
import '../assets/fusion.css'
import '../assets/score.css'
import { calculateOptimizationScore, type ScoreRubric } from '../domain/optimization-score'

interface Group { measured_trials:number; seconds:number[]; median_seconds:number; median_apply_seconds?:number; remote_compactions:number[]; verified:boolean; median_counters:Record<string,number>; replay_plus_drain_seconds?:number; drained_counters?:Record<string,number>; compaction_policy?:{mode:string;minimum_remote_bytes:number;local_jobs:number[];selected_remote_jobs:number[]} }
interface Evidence {
  verified:boolean; factor:string; job_id:string; qualified?:boolean; release?:string;
  summary:{run_id:string; operations_per_trial?:number; correctness_passed:boolean; repeats_complete:boolean; performance_gain_proven:boolean; measurement_timestamps?:Record<string,(string|null)[]>; summary:{native:Group;optimized:Group;previous?:Group;common_jvm?:Group}; limits:string[]; preconditioning_notes?:string[]};
  acceptance?:{cold_cache_readback?:{passed:boolean;databases:number};current_three_group?:{passed:boolean;groups:number;formal_trials:number};restored_original?:{passed:boolean;cold_cache_reopen:boolean};final_parity_scrub?:{passed:boolean;checked_stripes:number;mismatches:number};remote_compaction_chain?:{passed:boolean;actual_remote_compactions:number};five_minute_durable_write_load?:{passed:boolean;operations:number;seconds:number};controlled_guest_restart?:{passed:boolean;trials:unknown[]}}
}

const evidence=ref<Evidence>(),loading=ref(false),error=ref(''),healthState=ref('正在检查在线业务'),healthOk=ref(false)
const native=computed(()=>evidence.value?.summary.summary.native),optimized=computed(()=>evidence.value?.summary.summary.optimized)
const previous=computed(()=>evidence.value?.summary.summary.previous),isCurrent=computed(()=>!!previous.value)
const sizePolicy=computed(()=>optimized.value?.compaction_policy?.mode==='size_threshold')
const remoteProof=computed(()=>evidence.value?.acceptance?.remote_compaction_chain)
const records=[
 {key:'live',label:'在线 · 当前已验收版本',url:'/system-3/api/scalafusion/release',runId:''},
 {key:'current',label:'本周 · 2026-11-03 三组正式对照',url:'/system-3/assets/scalafusion-resource-v2-20261103.json',runId:'20261103-cache-v8-r3'},
 {key:'historical',label:'历史 · 2026-10-25 上周对照',url:'/system-3/api/optimization/run/optimization-bf065af8406a4a6fa7b34b2de5407c5a',runId:'20261025-latency20'}]
const selectedRecord=ref('live'),selectedRubric=ref<ScoreRubric>('resource-v2')
const isLive=computed(()=>selectedRecord.value==='live')
const commonJvm=computed(()=>evidence.value?.summary.summary.common_jvm)
const timeLabel=computed(()=>isLive.value?'回放＋排空中位耗时':'业务回放中位耗时')
let controller:AbortController|undefined
const f=(n:number|undefined,d=2)=>n!=null&&Number.isFinite(n)?n.toFixed(d):'—'
const percent=(a?:number,b?:number)=>a!=null&&b!=null&&a>0?(b/a-1)*100:undefined
const signed=(n:number|undefined)=>n!=null&&Number.isFinite(n)?n===0?'持平':(n>0?'增加 ':'减少 ')+Math.abs(n).toFixed(1)+'%':'—'
const reduction=(n:number)=>n===0?'持平':(n>0?'减少 ':'增加 ')+Math.abs(n).toFixed(1)+'%'
const change=computed(()=>percent(native.value?.median_seconds,optimized.value?.median_seconds))
const date=computed(()=>{const id=evidence.value?.summary.run_id;return id?.match(/^\d{8}/)?id.slice(0,4)+'-'+id.slice(4,6)+'-'+id.slice(6,8):id||'—'})
const rubricLabel=computed(()=>selectedRubric.value==='resource-v2'?'读取 · 写入 · 存储网络':selectedRubric.value==='io-total-v1'?'耗时 · 读写总量 · 存储网络':'耗时 · SSD 读取 · 存储网络')
function inputFor(g:Group|undefined){return {valid:!!(evidence.value?.verified&&evidence.value.summary.correctness_passed&&evidence.value.summary.repeats_complete&&native.value?.verified&&g?.verified),
 baselineSeconds:native.value?.median_seconds,optimizedSeconds:g?.median_seconds,
 baselineRead:native.value?.median_counters.host_read_bytes,optimizedRead:g?.median_counters.host_read_bytes,
 baselineWrite:native.value?.median_counters.host_write_bytes,optimizedWrite:g?.median_counters.host_write_bytes,
 baselineIo:native.value?.median_counters.ssd_interface_total_bytes,optimizedIo:g?.median_counters.ssd_interface_total_bytes,
 baselineNetwork:native.value?.median_counters.storage_pod_tx_bytes,optimizedNetwork:g?.median_counters.storage_pod_tx_bytes}}
const score=computed(()=>calculateOptimizationScore(inputFor(optimized.value),selectedRubric.value))
function replayThroughput(group: Group | undefined, operations: number): number | undefined {
  if (!group || group.seconds.length !== 3 || group.seconds.some(seconds => !Number.isFinite(seconds) || seconds <= 0)) return
  return group.seconds.map(seconds => operations / seconds).sort((a, b) => a - b)[1]
}
const throughput = computed(() => {
  const operations = evidence.value?.summary.operations_per_trial
  if (!score.value || operations == null || !Number.isSafeInteger(operations) || operations <= 0) return
  const baseline = replayThroughput(native.value, operations)
  const prior = replayThroughput(previous.value, operations)
  const candidate = replayThroughput(optimized.value, operations)
  if (baseline == null || candidate == null) return
  return { operations, baseline, prior, candidate, change: percent(baseline, candidate) }
})
const totalScore=computed(()=>calculateOptimizationScore(inputFor(optimized.value),'io-total-v1'))
const coreScore=computed(()=>calculateOptimizationScore(inputFor(optimized.value),'core-v3'))
const displayGroups=computed(()=>[
 {key:'native',label:'原 Kubernetes 系统',group:native.value,color:'#171717'},

 {key:'optimized',label:isCurrent.value?'优化候选':'ScalaFusion',group:optimized.value,color:'#525252'}])
const metrics=[{key:'host_read_bytes',label:'SSD 接口读取'},{key:'host_write_bytes',label:'SSD 接口写入'},{key:'ssd_interface_total_bytes',label:'SSD 接口读写总量'},{key:'storage_pod_tx_bytes',label:'存储 Pod 发送量'}]
const rows=computed(()=>[{key:'seconds',label:isLive.value?'完整窗口耗时':'业务回放耗时',unit:'s',n:native.value?.median_seconds,p:previous.value?.median_seconds,o:optimized.value?.median_seconds},
 ...metrics.map(m=>({key:m.key,label:m.label,unit:'MiB',n:(native.value?.median_counters[m.key]??NaN)/1024**2,p:(previous.value?.median_counters[m.key]??NaN)/1024**2,o:(optimized.value?.median_counters[m.key]??NaN)/1024**2}))])
const chart=(names:string[],series:Array<{name:string;data:number[];color:string}>):EChartsOption=>({
  textStyle:{color:'#737373',fontFamily:'system-ui'},tooltip:{trigger:'axis',confine:true,backgroundColor:'#ffffff',borderColor:'#e5e5e5',textStyle:{color:'#737373'}},
  legend:{top:0,textStyle:{color:'#737373'},itemWidth:10,itemHeight:10},grid:{top:48,left:12,right:18,bottom:5,containLabel:true},
  xAxis:{type:'category',data:names,axisLabel:{color:'#737373',fontSize:11},axisLine:{lineStyle:{color:'#737373'}}},
  yAxis:{type:'value',min:0,axisLabel:{color:'#737373'},splitLine:{lineStyle:{color:'#737373'}}},
  series:series.map(s=>({type:'bar',name:s.name,data:s.data,barMaxWidth:42,itemStyle:{color:s.color,borderRadius:[5,5,0,0]}}))
})
const legacyChecks=computed(()=>[
  {name:'业务读写正确性',ok:evidence.value?.summary.correctness_passed,text:'3024 次操作 · 1755 个键逐值一致'},
  {name:'compaction 执行与分流',ok:(optimized.value?.remote_compactions.length===3&&optimized.value.remote_compactions.every(n=>n>0))||(sizePolicy.value&&remoteProof.value?.passed),text:sizePolicy.value?`本轮远程 ${optimized.value?.remote_compactions.join(' / ')} 次；强制远程链路另经 ${remoteProof.value?.actual_remote_compactions??'—'} 次验证`:`三轮远程成功次数：${optimized.value?.remote_compactions.join(' / ')||'—'}`},
  {name:'重启后读回',ok:evidence.value?.acceptance?.controlled_guest_restart?.passed,text:'存储服务重启后四份数据一致'},
  {name:'持续写入验证',ok:evidence.value?.acceptance?.five_minute_durable_write_load?.passed,text:`5 分钟 · ${evidence.value?.acceptance?.five_minute_durable_write_load?.operations.toLocaleString()||'—'} 次持久化覆盖写`},
])

const timeChart=computed(()=>chart(['第 1 轮','第 2 轮','第 3 轮'],displayGroups.value.map(x=>({name:x.label,data:x.group?.seconds||[],color:x.color}))))
const ioChart=computed(()=>chart(['读取 MiB','写入 MiB','读写总量 MiB'],displayGroups.value.map(x=>({name:x.label,color:x.color,data:['host_read_bytes','host_write_bytes','ssd_interface_total_bytes'].map(k=>(x.group?.median_counters[k]||0)/1024**2)}))))
const networkChart=computed(()=>chart(['存储 Pod eth0 发送量 · MiB'],displayGroups.value.map(x=>({name:x.label,color:x.color,data:[(x.group?.median_counters.storage_pod_tx_bytes||0)/1024**2]}))))
const checks=computed(()=>isLive.value?[
 {name:'逐键逐值校验',ok:evidence.value?.summary.correctness_passed,text:'每轮 3024 次操作 · 1755 个键完整一致'},
 {name:'三组同负载对照',ok:evidence.value?.acceptance?.current_three_group?.passed,text:'原基线、同 JVM 基线、优化组，各预热 1 轮、正式 3 轮'},
 {name:'远程合并链路',ok:remoteProof.value?.passed,text:`独立强制远程 ${remoteProof.value?.actual_remote_compactions??'—'} 次成功，不计入性能结果`},
 {name:'校验条带检查',ok:evidence.value?.acceptance?.final_parity_scrub?.passed,text:`${evidence.value?.acceptance?.final_parity_scrub?.checked_stripes??'—'} 个条带 · ${evidence.value?.acceptance?.final_parity_scrub?.mismatches??'—'} 处不一致`},
 {name:'清空缓存后读回',ok:evidence.value?.acceptance?.cold_cache_readback?.passed,text:`重启网关及参与者，原读取程序核对 ${evidence.value?.acceptance?.cold_cache_readback?.databases??'—'} 个数据库`}
]:isCurrent.value?[
 {name:'业务读写正确性',ok:evidence.value?.summary.correctness_passed,text:'12 轮 · 每轮 3024 次操作 · 1755 个键逐值一致'},
 {name:'三组正式对照',ok:evidence.value?.acceptance?.current_three_group?.passed,text:'各 1 轮预热＋3 轮正式测量，预热排除'},
 {name:'恢复后重新读回',ok:evidence.value?.acceptance?.restored_original?.cold_cache_reopen,text:'原版网关恢复后，候选数据库逐值一致'},
 {name:'恢复后校验检查',ok:evidence.value?.acceptance?.final_parity_scrub?.passed,text:'检查 '+(evidence.value?.acceptance?.final_parity_scrub?.checked_stripes??'—')+' 个条带 · 0 不一致'}
]:legacyChecks.value)
async function refresh(){
 if(loading.value)return
 loading.value=true;error.value='';controller=new AbortController()
 const timeout=setTimeout(()=>controller?.abort(),15000)
 try{
  const record=records.find(r=>r.key===selectedRecord.value);if(!record)throw new Error('未知实验记录。')
  const response=await fetch(record.url,{cache:'no-store',signal:controller.signal})
  if(!response.ok)throw new Error('暂时无法读取对照结果，请稍后刷新。')
  const data=await response.json() as Evidence
  if(data.factor!=='whole_stack'||!data.verified||!data.summary?.repeats_complete||!data.summary.correctness_passed||(record.runId&&data.summary.run_id!==record.runId)||(record.key==='live'&&!data.qualified))throw new Error('实验编号或验收状态不一致，暂不显示评分。')
  const groups=[data.summary.summary.native,data.summary.summary.optimized,...(data.summary.summary.previous?[data.summary.summary.previous]:[])]
  for(const g of groups){
   if(!g.verified||g.measured_trials!==3||g.seconds.length!==3||!g.seconds.every(n=>Number.isFinite(n)&&n>0)||!Number.isFinite(g.median_seconds)||g.median_seconds<=0)throw new Error('正式对照数据不完整。')
   if(g.remote_compactions.length!==3||!g.remote_compactions.every(n=>Number.isSafeInteger(n)&&n>=0)||metrics.some(m=>!Number.isFinite(g.median_counters[m.key])||g.median_counters[m.key]<0))throw new Error('设备或网络计数缺失。')
  }
  evidence.value=data
 }catch(e){error.value=e instanceof Error?e.message:'结果读取失败。'}finally{clearTimeout(timeout);loading.value=false}
}
async function changeRecord(){evidence.value=undefined;await refresh();await updateHealth()}
interface RunStatus {job_id:string;state:string;phase?:string;trial?:number;warmup?:boolean;completed_rows?:number;expected_rows?:number;error?:string}
const runningJob=ref<string>(),runSubmitting=ref(false),jobMessage=ref(''),jobError=ref(false)
const runBusy=computed(()=>runSubmitting.value||!!runningJob.value)
let pollTimer:ReturnType<typeof setTimeout>|undefined,unmounted=false
const phases:Record<string,string>={preflight:'检查运行条件','switch-original-full-stack':'准备原始基线',native_original:'运行原 Kubernetes 基线',native_common_jvm:'运行相同 JVM 的基线',candidate:'运行 ScalaFusion 优化组',forced_remote:'验证独立远程合并链路',queued:'任务排队中','cold-restart-readback':'冷重启及原 SDK 读回验证'}
function followJob(job:string){
 if(!/^sf-[0-9a-f]{32}$/.test(job))return
 runningJob.value=job;sessionStorage.setItem('scalafusion-live-job',job)
 if(pollTimer)clearTimeout(pollTimer)
 pollTimer=setTimeout(pollJob,300)
}
async function pollJob(){
 const job=runningJob.value;if(!job||unmounted)return
 try{
  const response=await fetch('/system-3/api/scalafusion/run/'+job,{cache:'no-store',signal:AbortSignal.timeout(20000)})
  if(!response.ok)throw new Error('暂时无法读取任务进度；后台任务不会因此取消。')
  const data=await response.json() as RunStatus & Partial<Evidence>
  if(data.state==='done'){
   runningJob.value=undefined;sessionStorage.removeItem('scalafusion-live-job')
   if(data.verified&&data.qualified&&data.summary){if(isLive.value)evidence.value=data as Evidence;jobMessage.value='本轮验收完成，吞吐及完整读取量门槛通过。';jobError.value=false}
   else{jobMessage.value='本轮未达到上线门槛，保留上一次已验收版本。';jobError.value=true}
   await updateHealth();return
  }
  if(data.state==='failed'){
   runningJob.value=undefined;sessionStorage.removeItem('scalafusion-live-job');jobMessage.value='本轮执行中断：'+(data.error||'请查看运行记录');jobError.value=true;await updateHealth();return
  }
  const trial=data.trial==null?'':data.warmup?' · 预热':` · 正式第 ${data.trial}/3 轮`
  jobMessage.value=(phases[data.phase||data.state]||'准备及验证中')+trial+` · 已完成 ${data.completed_rows??0}/12 次回放`;jobError.value=false
 }catch(e){jobMessage.value=e instanceof Error?e.message:'连接暂时中断，后台任务继续运行。';jobError.value=true}
 if(!unmounted&&runningJob.value)pollTimer=setTimeout(pollJob,4000)
}
async function runAcceptance(){
 if(runBusy.value)return
 runSubmitting.value=true;jobError.value=false;jobMessage.value='正在提交真实验收任务…'
 try{
  const response=await fetch('/system-3/api/scalafusion/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({factor:'whole_stack',repeats:3}),signal:AbortSignal.timeout(20000)})
  const data=await response.json()
  if(response.status===409&&data.detail?.active_job){followJob(data.detail.active_job);jobMessage.value='已有验收任务运行，正在读取其进度。';return}
  if(!response.ok||!/^sf-[0-9a-f]{32}$/.test(data.job_id||''))throw new Error('任务提交失败，请检查在线执行状态。')
  followJob(data.job_id)
 }catch(e){jobMessage.value=e instanceof Error?e.message:'任务提交失败。';jobError.value=true}
 finally{runSubmitting.value=false}
}
async function updateHealth(){
 try{
  const response=await fetch(isLive.value?'/system-3/api/scalafusion/health':'/system-3/api/caas/health',{cache:'no-store',signal:AbortSignal.timeout(20000)})
  const h=await response.json();healthOk.value=!!(response.ok&&h.ok)
  healthState.value=healthOk.value?(isLive.value?(h.state==='running'?'在线验收正在运行':'在线执行服务就绪'):'原业务接口运行正常'):'执行状态待确认'
  if(isLive.value&&h.active_job&&!runningJob.value)followJob(h.active_job)
 }catch{healthOk.value=false;healthState.value='在线执行状态暂不可用'}
}
function download(){if(!evidence.value)return;const url=URL.createObjectURL(new Blob([JSON.stringify(evidence.value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='ScalaFusion-'+evidence.value.summary.run_id+'-evidence.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
onMounted(async()=>{await refresh();const saved=sessionStorage.getItem('scalafusion-live-job');if(saved)followJob(saved);await updateHealth()});onBeforeUnmount(()=>{unmounted=true;controller?.abort();if(pollTimer)clearTimeout(pollTimer)})
</script>

<template>
 <PageLayout class="fusion-page">
  <template #heading><header class="fusion-hero"><div><p class="fusion-eyebrow">KUBERNETES · STORAGE &amp; COMPUTE</p><h1>一套业务，两条存算路径。</h1><p class="fusion-intro">ScalaFusion 存算协同优化系统 <span>ScalaAFA ＋ CaaS-LSM ＋ dPP</span></p></div><div class="hero-status" :class="{pending:!healthOk}"><span><i/>{{healthState}}</span><small>{{isLive?(healthOk?'固定轨迹在线执行 · 当前版本':'正在核对在线执行状态'):'历史实验记录 · 原始数据保留'}}</small></div></header></template>
  <div class="benchmark-controls">
   <label>实验记录<select v-model="selectedRecord" :disabled="loading" @change="changeRecord"><option v-for="record in records" :key="record.key" :value="record.key">{{record.label}}</option></select></label>
   <label>评分口径<select v-model="selectedRubric"><option value="resource-v2">资源开销版 v2</option><option value="io-total-v1">读写总量版 v1</option><option value="core-v3">读取指标版 v3</option></select></label>
   <span>同一记录使用同轮基线；历史结果单独保留</span>
  </div>
  <section v-if="isLive" class="live-run-panel" aria-label="在线固定轨迹验收">
   <div><strong>重新运行原始验收负载</strong><p>真实运行原 Kubernetes 基线、同 JVM 基线与优化组，各预热 1 轮、测量 3 轮。任务需数分钟，可在后台继续。</p><p v-if="jobMessage" :class="{'live-run-error':jobError}" role="status">{{jobMessage}}</p><small v-if="runningJob">任务 {{runningJob}}</small></div>
   <UiButton :disabled="runBusy||!healthOk" @click="runAcceptance">{{runBusy?'验收运行中…':'重新验收'}}</UiButton>
  </section>
  <section class="optimization-score" aria-labelledby="optimization-score-title" aria-live="polite">
   <div class="score-heading"><div><p class="fusion-eyebrow">COMPARISON SCORE</p><h2 id="optimization-score-title">{{selectedRubric==='resource-v2'?'资源开销优化评分':'系统优化参考评分'}}</h2><p>{{rubricLabel}}</p></div><div v-if="evidence" class="score-meta"><span>{{date}} · 每组 3 轮正式测量</span><span>{{evidence.summary.run_id}} · FEMU 模拟设备</span></div></div>
   <div v-if="score" class="score-content">
    <div class="score-summary"><p class="score-caption">{{isLive?'在线验收参考分':isCurrent?'本轮候选参考分':'历史实验参考分'}}</p><p class="score-value">{{f(score.total,1)}}<small>/ 100 分</small></p><p class="score-explanation">{{selectedRubric==='resource-v2'?'读取、写入与网络计分，耗时另列':selectedRubric==='io-total-v1'?'写入计入读写总量':'读取单独计分，写入与总量见明细'}}</p></div>
    <div class="score-rules"><h3>评分标准与得分</h3><div v-for="item in score.items" :key="item.key" class="score-rule"><div class="score-rule-title"><strong>{{item.label}}</strong><span>实测{{reduction(item.reductionPercent)}} · 减少 {{item.targetPercent}}% 得满分</span></div><div class="score-points">{{f(item.points,2)}} <span>/ {{item.weight}} 分</span></div><div class="score-track" aria-hidden="true"><span :style="{width:(item.points/item.weight*100)+'%'}"/></div></div><p class="score-explanation">项目自定义目标 · 按改善比例计分，持平或增加得 0 分，各项封顶。</p></div>
   </div>
   <p v-else class="score-empty">{{loading?'正在读取实验数据…':'暂无已验收的完整对照记录。'}}</p>
   <section v-if="throughput" class="score-throughput" aria-labelledby="score-throughput-title">
    <h3 id="score-throughput-title">业务回放吞吐量 <span>（次/秒）</span></h3>
    <dl>
     <div><dt>原 Kubernetes 系统</dt><dd>{{ f(throughput.baseline) }}</dd></div>
     <div v-if="throughput.prior != null"><dt>原版 ScalaFusion</dt><dd>{{ f(throughput.prior) }}</dd></div>
     <div><dt>{{ isCurrent ? '优化候选' : 'ScalaFusion' }}</dt><dd>{{ f(throughput.candidate) }}</dd></div>
     <div><dt>较原 Kubernetes 系统</dt><dd>{{ signed(throughput.change) }}</dd></div>
    </dl>
    <p class="score-explanation">每轮 {{ throughput.operations }} 次操作 ÷ {{isLive?'完整完成窗口（回放＋同步排空及双节点采样）':'回放耗时'}}，取三轮正式测量的中位数。单独展示，不计入评分。</p>
   </section>
   <details v-if="evidence && totalScore && coreScore" class="score-storage-details"><summary>评分口径与完整数据</summary><p class="score-explanation">同一组实测：读写总量版 {{f(totalScore.total,1)}} 分，读取指标版 {{f(coreScore.total,1)}} 分。两套规则权重均为 40 / 30 / 30，满分目标沿用原设置；评分不代表所有业务的性能。</p></details>
  </section>
  <section class="workload-strip" aria-label="固定业务与实验口径"><div><small>共同业务负载</small><strong>混合键值读写与压缩</strong></div><div><small>固定轨迹</small><strong>3024 次操作 · 1755 个键</strong></div><div><small>测量轮次</small><strong>预热 1 轮＋正式 3 轮 / 组</strong></div><UiButton variant="default" class="fusion-button" :disabled="loading" @click="refresh">{{loading?'正在读取…':'刷新实验结果'}}</UiButton></section>
  <p v-if="error" class="fusion-notice" role="alert">{{error}} <span v-if="evidence">保留同一记录上次成功读取的数据。</span></p>
  <div v-if="!evidence" class="fusion-empty">{{loading?'正在读取完整对照结果…':'尚未获得完整实验结果。'}}</div>
  <template v-else>
   <section class="systems-grid" aria-label="基线与候选系统">
    <UiCard class="system-card baseline"><div class="system-top"><span class="path-number">01</span><span>BASELINE</span><UiBadge>同轮基线</UiBadge></div><h2>原 Kubernetes 基线系统</h2><p>HDFS ＋ 本地 LSM compaction ＋ 普通 RAID5</p><div class="path-flow"><span>业务回放</span><b>→</b><span>HDFS</span><b>→</b><span>普通 RAID5</span></div><div class="system-result"><div><small>{{timeLabel}}</small><strong>{{f(native?.median_seconds)}}<em>秒</em></strong></div><span class="system-ok">✓ 内容校验一致</span></div></UiCard>
    <UiCard class="system-card optimized"><div class="system-top"><span class="path-number">02</span><span>SCALAFUSION</span><UiBadge>{{isCurrent?'本周候选':'优化组'}}</UiBadge></div><h2>ScalaFusion 协同优化系统</h2><p>ScalaAFA ＋ dPP ＋ CaaS-LSM {{sizePolicy?'按任务规模分流 compaction':'远程 compaction'}}</p><div class="path-flow"><span>业务回放</span><b>→</b><span>HDFS / SPDK</span><b>→</b><span>协同存算路径</span></div><div class="system-result"><div><small>{{timeLabel}}</small><strong>{{f(optimized?.median_seconds)}}<em>秒</em></strong></div><span class="system-ok">✓ 内容校验一致</span></div></UiCard>
   </section>
   <section class="resource-gains" aria-label="相对原始 RAID5 的资源节省"><div v-for="metric in metrics.slice(0,3)" :key="metric.key"><small>{{metric.label}}</small><strong>{{signed(percent(native?.median_counters[metric.key],optimized?.median_counters[metric.key]))}}</strong></div></section>
   <section class="conclusion" :class="change!=null&&change>0?'regression':'gain'" aria-live="polite"><span class="conclusion-icon">{{change!=null&&change>0?'↗':'↘'}}</span><div><strong>相对同轮原 Kubernetes 基线，{{isLive?'完整窗口':'业务回放'}}耗时{{signed(change)}}</strong><p>读写量与网络变化分别列在下表；性能结论以本轮实验范围为限。</p></div><span>{{date}} · 3 轮中位数</span></section>
   <section v-if="isLive&&commonJvm" class="live-run-panel">
    <div><strong>排除通用 JVM 调整后的对照</strong><p>相同 JVM 的基线 {{f(commonJvm.median_seconds)}} 秒，优化组 {{f(optimized?.median_seconds)}} 秒；吞吐变化 {{signed(percent(3024/commonJvm.median_seconds,3024/(optimized?.median_seconds||NaN)))}}。</p><p>读取含设备内部转换及排空：基线 {{f((native?.median_counters.read_including_internal_bytes||0)/1024**2)}} MiB，优化组 {{f((optimized?.median_counters.read_including_internal_bytes||0)/1024**2)}} MiB。</p></div>
   </section>
   <section class="measure-grid">
    <UiCard class="measure-panel time-panel"><div class="panel-heading"><div><p class="fusion-eyebrow">REPLAY TIME</p><h3>同一业务的逐轮耗时</h3></div><span>秒 · 越低越好</span></div><MetricChart :option="timeChart" label="同轮各组三次业务回放耗时对照"/><DataTable class="trial-table"><table data-slot="table"><thead data-slot="table-header"><tr data-slot="table-row"><th data-slot="table-head">系统</th><th data-slot="table-head">第 1 轮</th><th data-slot="table-head">第 2 轮</th><th data-slot="table-head">第 3 轮</th><th data-slot="table-head">中位数</th></tr></thead><tbody data-slot="table-body"><tr v-for="item in displayGroups" :key="item.key" data-slot="table-row"><td data-slot="table-cell">{{item.label}}</td><td v-for="(n,i) in item.group?.seconds" :key="i" data-slot="table-cell">{{f(n)}} s</td><td data-slot="table-cell">{{f(item.group?.median_seconds)}} s</td></tr></tbody></table></DataTable></UiCard>
    <UiCard class="measure-panel"><div class="panel-heading"><div><p class="fusion-eyebrow">STORAGE I/O</p><h3>设备接口读写</h3></div><span>MiB · 三轮中位数</span></div><MetricChart :option="ioChart" label="同轮各组SSD接口读写字节对照"/><p class="panel-note">记录 SSD 接口载荷，不等同于物理 NAND I/O。设备内部转换读写另列。</p></UiCard>
    <UiCard class="measure-panel"><div class="panel-heading"><div><p class="fusion-eyebrow">STORAGE NETWORK</p><h3>存储节点发送量</h3></div><span>MiB · 三轮中位数</span></div><MetricChart :option="networkChart" label="同轮各组存储Pod网络发送字节对照"/><p class="panel-note">两台存储 Pod 的 eth0 发送量，不代表整个系统全部网络流量。</p></UiCard>
   </section>
   <section data-slot="card" class="measure-panel metrics-panel"><div class="panel-heading"><div><p class="fusion-eyebrow">MEASURED CHANGES</p><h3>各项指标的实际变化</h3></div><UiButton variant="ghost" class="fusion-link" @click="download">导出原始测量 ↓</UiButton></div><DataTable class="trial-table"><table data-slot="table"><thead data-slot="table-header"><tr data-slot="table-row"><th data-slot="table-head">指标</th><th data-slot="table-head">原 Kubernetes（RAID5）</th><th data-slot="table-head">{{isCurrent?'优化候选':'ScalaFusion'}}</th><th data-slot="table-head">相对原 Kubernetes 基线</th></tr></thead><tbody data-slot="table-body"><tr v-for="row in rows" :key="row.key" data-slot="table-row"><td data-slot="table-cell">{{row.label}}</td><td data-slot="table-cell">{{f(row.n)}} {{row.unit}}</td><td data-slot="table-cell">{{f(row.o)}} {{row.unit}}</td><td data-slot="table-cell" :class="(percent(row.n,row.o)||0)>0?'metric-worse':'metric-better'">{{signed(percent(row.n,row.o))}}</td></tr></tbody></table></DataTable><p class="panel-note">各指标分别取三轮中位数，总量不一定等于读取与写入中位数之和。预热不参与统计。</p></section>
   <details v-if="previous" class="measure-panel incremental-panel"><summary>展开同轮增量对照与排空耗时</summary><div class="panel-heading"><div><p class="fusion-eyebrow">INCREMENTAL COMPARISON</p><h3>相对改动前 ScalaFusion 的变化</h3></div><span>同轮交错对照</span></div><p>回放耗时{{signed(percent(previous.median_seconds,optimized?.median_seconds))}}；读取{{signed(percent(previous.median_counters.host_read_bytes,optimized?.median_counters.host_read_bytes))}}；写入{{signed(percent(previous.median_counters.host_write_bytes,optimized?.median_counters.host_write_bytes))}}；读写总量{{signed(percent(previous.median_counters.ssd_interface_total_bytes,optimized?.median_counters.ssd_interface_total_bytes))}}。</p><p class="panel-note">候选采用 512 KiB SST、稀疏校验和每节点 4 MiB 有效数据缓存，索引等内存开销另计。各项改善与退化分别保留。</p><p v-if="optimized?.replay_plus_drain_seconds!=null&&native?.replay_plus_drain_seconds!=null" class="panel-note">回放＋后续排空：原始 RAID5 {{f(native.replay_plus_drain_seconds)}} 秒，候选 {{f(optimized.replay_plus_drain_seconds)}} 秒（{{signed(percent(native.replay_plus_drain_seconds,optimized.replay_plus_drain_seconds))}}）。</p></details>
   <section class="checks-grid" aria-label="当前记录正确性和恢复验证"><UiCard v-for="check in checks" :key="check.name"><span :class="check.ok?'check-ok':'check-pending'">{{check.ok?'✓':'○'}}</span><div><h3>{{check.name}}</h3><p>{{check.text}}</p><small>{{check.ok?'本记录验证通过':'待确认'}}</small></div></UiCard></section>
   <details id="experiment-config" class="experiment-config"><summary><span>实验配置与测量范围</span><small>{{date}} · 展开详情</small></summary><div class="config-content"><p>同一组 5 个 FEMU 测试设备、相同轨迹与 SDK、2 GiB 保留文件系统。Kubernetes 为共同部署平台。</p><dl><dt>节点分工</dt><dd>158：业务、HDFS 与 AFA 前端；35 / 36：测试存储设备。远程 compaction 服务由 ProCP / CSA 执行。</dd><dt>基线实现</dt><dd>HDFS ＋ 相同 SDK 本地 compaction 模式 ＋ 普通内核 RAID5。</dd><dt>测量范围</dt><dd>{{isCurrent?'原始 RAID5 先测，ScalaFusion 两组交错；每组 1 轮预热＋3 轮正式测量。两套保留文件系统的分配历史不同；网关切换会重建缓存。':'分组顺序测量，保留文件系统的历史分配不同。'}}{{isLive?'在线记录以回放＋同步排空和完整采样作为主窗口；准备与后续独立诊断另列。':'回放区间单独计时，准备与验证不计入回放耗时。'}}</dd><template v-if="sizePolicy"><dt>compaction 分流</dt><dd>输入小于 {{f((optimized?.compaction_policy?.minimum_remote_bytes||0)/1024**2,0)}} MiB 的任务在本地执行；达到阈值后选择远程。本轮实际远程次数 {{optimized?.remote_compactions.join(' / ')}}，当前结果不单独证明远程 compaction 加速。</dd></template><dt>设备内部转换</dt><dd>候选中位数 {{optimized?.median_counters.device_conversions}} 次；内部读 {{f((optimized?.median_counters.internal_read_bytes||0)/1024**2)}} MiB、内部写 {{f((optimized?.median_counters.internal_write_bytes||0)/1024**2)}} MiB。主机接口总量不含这部分。</dd><template v-if="isCurrent"><dt>排空后接口总量</dt><dd>原始 RAID5 {{f((native?.drained_counters?.ssd_interface_total_bytes||0)/1024**2)}} MiB；候选 {{f((optimized?.drained_counters?.ssd_interface_total_bytes||0)/1024**2)}} MiB。</dd><dt>含内部转换与排空</dt><dd>原始 RAID5 {{f((native?.drained_counters?.all_counted_bytes||0)/1024**2)}} MiB；候选 {{f((optimized?.drained_counters?.all_counted_bytes||0)/1024**2)}} MiB。</dd></template><template v-if="isLive"><dt>读取优化</dt><dd>每节点 4 MiB 易失性只读缓存，索引内存另计；写入确认与持久化屏障保留，重启清空并独立读回。</dd></template><dt>运行范围</dt><dd>{{isLive?'正式入口执行固定轨迹任务，使用独立存算卷；原通用 HDFS/CaaS 接口继续保留。':'独立测试卷；本历史记录未切换正式业务。'}}恢复后读回与条带校验不等于任意断电或生产级高可用验收。</dd><dt>结果记录</dt><dd><code>{{evidence.job_id}}</code></dd></dl></div></details>
   <footer class="fusion-footer"><span>ScalaFusion · ScalaAFA / CaaS-LSM / dPP / SPDK</span><span>实际已测结果 · 支持原始证据导出</span></footer>
  </template>
 </PageLayout>
</template>

<style scoped>
.live-run-panel{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;margin:1rem 0;padding:1.2rem 1.5rem;border:1px solid #e5e5e5;border-radius:12px;background:#fff;color:#404040}
.live-run-panel p{margin:.5rem 0;font-size:.875rem;line-height:1.65}.live-run-panel small{overflow-wrap:anywhere;color:#737373}.live-run-panel .live-run-error{color:#b91c1c}
</style>
