import {create} from 'zustand';
import {persist,createJSONStorage,type StateStorage} from 'zustand/middleware';
import {workflows as seed} from '../../mock-data/workflows';
import {instances as seedInstances} from '../../mock-data/instances';
import type {FlowEdge,FlowNode,Instance,PublishOutcome,ValidationIssue,Workflow} from '../types';

const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const NOW='2026-09-30 16:35';
const STORAGE_KEY='flowdesk-v1';
const LOCK_KEY='flowdesk-publish-lock';
const LOCK_TTL_MS=4000;

const validate=(w:Workflow):ValidationIssue[]=>{
  const issues:ValidationIssue[]=[];
  if(!w.nodes.some(n=>n.type==='end'))issues.push({nodeId:w.nodes[0]?.id||'flow',level:'error',message:'流程缺少结束节点'});
  const linked=new Set(w.edges.flatMap(e=>[e.source,e.target]));
  w.nodes.filter(n=>n.type!=='start'&&n.type!=='end'&&!linked.has(n.id)).forEach(n=>issues.push({nodeId:n.id,level:'error',message:'必经节点不能孤立'}));
  w.nodes.forEach(n=>{
    if(n.type==='condition'&&!n.data.config.ruleType)issues.push({nodeId:n.id,level:'error',message:'条件分支规则未配置'});
    if(n.type==='approval'&&!n.data.config.approverSource)issues.push({nodeId:n.id,level:'error',message:'审批人不能为空'});
  });
  return issues;
};

/** 本窗口改过、尚未发布的草稿：跨窗口同步时草稿内容不被另一窗口的发布覆盖 */
const dirtyDrafts=new Set<string>();
/** 各流程进入编辑时所依据的修订号，发布时用于乐观冲突检测 */
const baseRevisions=new Map<string,number>();

/** 下一次存储写入抛错（模拟磁盘故障），仅触发一次 */
let failNextStorageWrite=false;
/** 下一次发布事务在指定阶段抛错，仅触发一次 */
let failNextPublishStage:string|false=false;
/** 下一次发起实例写入失败，仅触发一次 */
let failNextStartInstance=false;

const baseStorage:StateStorage={
  getItem:name=>localStorage.getItem(name),
  setItem:(name,value)=>{
    if(failNextStorageWrite){failNextStorageWrite=false;throw new Error('StorageError: 磁盘写入失败（模拟）');}
    localStorage.setItem(name,value);
  },
  removeItem:name=>localStorage.removeItem(name),
};
/** persist 只负责首次水合与跨窗口同步；事务写入由 commitPersisted 显式控制，避免写入错误被中间件吞掉 */
const readOnlyStorage:StateStorage={
  getItem:name=>{
    // 演示/测试重置通道：带 reset 标记加载时无视持久层，从 mock 种子重新水合
    if(name===STORAGE_KEY&&localStorage.getItem('flowdesk-reset')==='1'){localStorage.removeItem(STORAGE_KEY);localStorage.removeItem('flowdesk-reset');localStorage.removeItem(LOCK_KEY);return null;}
    return localStorage.getItem(name);
  },
  setItem:()=>{/* 事务外不落盘；发布/发起实例走 commitPersisted，失败可回滚 */},
  removeItem:()=>{/* noop */},
};
/** 模块级单例：zustand v5 跨标签水合要求 storage 引用稳定，并据此绑定 storage 事件监听 */
const hydratedStorage=createJSONStorage(()=>readOnlyStorage);

function readPersistedState():{workflows:Workflow[];instances:Instance[]}|null{
  try{
    const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return null;
    const data=JSON.parse(raw)?.state;
    if(!data||!Array.isArray(data.workflows))return null;
    return data;
  }catch{return null;}
}
function readPersistedRevision(id:string):number|undefined{return readPersistedState()?.workflows.find(w=>w.id===id)?.revision;}
/** 提交前存储可用性预检（不消耗故障注入） */
function assertStorageWritable(){
  try{localStorage.setItem(STORAGE_KEY+'.probe','1');localStorage.removeItem(STORAGE_KEY+'.probe');}
  catch(e){throw new Error('StorageError: 存储不可写');}
}
/**
 * 原子提交：写内存 + 显式落盘。落盘失败抛错，由调用方统一回滚（内存 + 持久层）。
 * 不依赖 persist 自动写入（其错误会被吞掉），事务内手动持久化，保证可检测、可回滚。
 */
function commitPersisted(workflows:Workflow[],instances:Instance[]){
  baseStorage.setItem(STORAGE_KEY,JSON.stringify({state:{workflows,instances},version:0}));
}

/** 跨窗口发布互斥锁：两窗口同时发布时只允许一个拿到锁 */
function acquireLock(workflowId:string):Promise<boolean>{
  const tryOnce=()=>{
    try{
      const raw=localStorage.getItem(LOCK_KEY);
      const now=Date.now();
      if(raw){const lock=JSON.parse(raw);if(lock.workflowId!==workflowId&&now-lock.at<LOCK_TTL_MS)return false;}
      const token=Math.random().toString(36).slice(2);
      localStorage.setItem(LOCK_KEY,JSON.stringify({workflowId,at:now,token}));
      return JSON.parse(localStorage.getItem(LOCK_KEY)||'{}').token===token;
    }catch{return true;} // 存储不可用时退化为窗口内串行
  };
  return new Promise(resolve=>{
    if(tryOnce())return resolve(true);
    let tries=0;
    const timer=setInterval(()=>{
      tries++;
      if(tryOnce()){clearInterval(timer);resolve(true);}
      else if(tries>12){clearInterval(timer);resolve(false);}
    },25);
  });
}
function releaseLock(workflowId:string){
  try{const raw=localStorage.getItem(LOCK_KEY);if(raw&&JSON.parse(raw).workflowId===workflowId)localStorage.removeItem(LOCK_KEY);}catch{/* ignore */}
}

export interface ConflictInfo{workflowId:string;workflowName:string;baseRevision:number;latestRevision:number;latestVersion:number;retryVersion:number}
interface State{
  workflows:Workflow[];instances:Instance[];currentId:string;selectedNodeId:string|null;issues:ValidationIssue[];toast:string;toastTone:'ok'|'error'|'warn';
  publishing:boolean;conflict:ConflictInfo|null;
  setCurrent:(id:string)=>void;selectNode:(id:string|null)=>void;
  updateNodes:(nodes:FlowNode[])=>void;updateEdges:(edges:FlowEdge[])=>void;updateConfig:(id:string,config:Record<string,any>)=>void;
  runValidation:()=>ValidationIssue[];save:()=>void;
  publish:()=>Promise<PublishOutcome>;rebaseDraft:()=>void;discardConflict:()=>void;
  startInstance:(workflowId:string)=>Instance;
  create:()=>string;copy:(id:string)=>void;archive:(id:string)=>void;restore:(v:number)=>void;clearToast:()=>void;
  __failStorageWrite:()=>void;__failPublishStage:(stage:string)=>void;__failStartInstance:()=>void;
}

export const useAppStore=create<State>()(persist((set,get)=>({
  workflows:clone(seed),instances:clone(seedInstances),currentId:'wf-1',selectedNodeId:null,issues:[],toast:'',toastTone:'ok',publishing:false,conflict:null,

  setCurrent:id=>{baseRevisions.set(id,get().workflows.find(w=>w.id===id)?.revision??0);set({currentId:id,selectedNodeId:null,issues:[]});},
  selectNode:id=>set({selectedNodeId:id}),
  updateNodes:nodes=>{const id=get().currentId;dirtyDrafts.add(id);set(s=>({workflows:s.workflows.map(w=>w.id===id?{...w,nodes}:w)}));},
  updateEdges:edges=>{const id=get().currentId;dirtyDrafts.add(id);set(s=>({workflows:s.workflows.map(w=>w.id===id?{...w,edges}:w)}));},
  updateConfig:(idArg,config)=>{dirtyDrafts.add(get().currentId);
    set(s=>({workflows:s.workflows.map(w=>w.id===s.currentId?{...w,nodes:w.nodes.map(n=>n.id===idArg?{...n,data:{...n.data,config:{...n.data.config,...config},state:'configuring'}}:n)}:w)}));},

  runValidation:()=>{const w=get().workflows.find(x=>x.id===get().currentId)!;const issues=validate(w);
    set(s=>({issues,workflows:s.workflows.map(x=>x.id===w.id?{...x,nodes:x.nodes.map(n=>({...n,data:{...n.data,state:issues.some(i=>i.nodeId===n.id)?'invalid':'valid'}}))}:x),toast:issues.length?`发现 ${issues.length} 个问题`:'校验通过',toastTone:issues.length?'warn':'ok'}));return issues;},

  save:()=>set(s=>({workflows:s.workflows.map(w=>w.id===s.currentId?{...w,status:'draft',updatedAt:NOW}:w),toast:'草稿已保存',toastTone:'ok'})),

  /**
   * 发布事务（草稿 → 版本快照 → 实例路由）：
   * 1. 发布前冻结当前草稿为不可变版本快照；已有运行实例继续按钉住的旧版本执行，不做任何改写；
   * 2. 乐观锁 + 跨窗口互斥锁，两窗口并发只成功一个，另一个保留草稿并看到冲突；
   * 3. 流程、版本记录、实例路由分阶段写入，任一阶段（含落盘）失败，三者一起回滚到发布前；
   * 4. 失败后版本号不被消费，重提仍使用同一版本号。
   */
  publish:async()=>{
    const s0=get();const w0=s0.workflows.find(w=>w.id===s0.currentId);
    if(!w0)return {ok:false,reason:'failed',stage:'prepare',version:0,message:'未找到流程'};
    const issues=validate(w0);
    if(issues.length){set({issues,toast:'存在校验错误，无法发布',toastTone:'error'});return {ok:false,reason:'invalid',issues};}
    if(s0.publishing)return {ok:false,reason:'failed',stage:'prepare',version:w0.version+1,message:'发布正在进行中'};

    set({publishing:true});
    const nextVersion=w0.version+1;
    // 发布前完整快照，任何阶段失败都回滚到这里（流程 + 版本记录 + 实例）
    const rollback={workflows:clone(s0.workflows),instances:clone(s0.instances)};
    try{
      // 阶段 0：跨窗口互斥锁
      const locked=await acquireLock(w0.id);
      const base=baseRevisions.get(w0.id)??w0.revision;
      const fresh=get().workflows.find(w=>w.id===w0.id)!;
      if(!locked){
        const latestRevision=readPersistedRevision(w0.id)??fresh.revision;
        const info:ConflictInfo={workflowId:w0.id,workflowName:w0.name,baseRevision:base,latestRevision,latestVersion:fresh.version,retryVersion:fresh.version+1};
        set({publishing:false,conflict:info,toast:'发布冲突：另一窗口已发布新版本，草稿已保留',toastTone:'warn'});
        return {ok:false,reason:'conflict',baseRevision:base,latestRevision,latestVersion:info.latestVersion};
      }

      // 乐观锁：重读已提交修订号，被其他窗口抢先发布则放弃，草稿原样保留
      const committedRevision=readPersistedRevision(w0.id);
      if(committedRevision!==undefined&&committedRevision!==base){
        releaseLock(w0.id);
        const latest=get().workflows.find(w=>w.id===w0.id)!;
        const info:ConflictInfo={workflowId:w0.id,workflowName:w0.name,baseRevision:base,latestRevision:committedRevision,latestVersion:latest.version,retryVersion:latest.version+1};
        set({publishing:false,conflict:info,toast:'发布冲突：另一窗口已发布新版本，草稿已保留',toastTone:'warn'});
        return {ok:false,reason:'conflict',baseRevision:base,latestRevision:committedRevision,latestVersion:latest.version};
      }

      // 阶段 1：冻结版本快照（旧依据不可变，已有实例继续引用旧快照）
      const snapshot={version:nextVersion,createdAt:NOW,note:`发布最新审批配置（v${nextVersion}）`,nodes:clone(fresh.nodes),edges:clone(fresh.edges)};
      if(failNextPublishStage){
        const stage=failNextPublishStage;failNextPublishStage=false;throw new Error(`StageError: ${stage} 阶段写入失败（模拟）`);
      }

      // 阶段 2：暂存流程聚合根与版本记录（实例显式不迁移、不重路由）
      const stagedWorkflows=get().workflows.map(w=>w.id===w0.id
        ?{...w,status:'published' as const,version:nextVersion,publishedAt:NOW,updatedAt:NOW,revision:w.revision+1,
          nodes:clone(snapshot.nodes),edges:clone(snapshot.edges),versions:[...w.versions,snapshot]}
        :w);
      if(failNextPublishStage==='instances'){failNextPublishStage=false;throw new Error('StageError: instances 阶段写入失败（模拟）');}
      const stagedInstances=get().instances;

      // 阶段 3：提交前存储预检（模拟磁盘不可用会在这里失败，内存尚未改动）
      assertStorageWritable();

      // 阶段 4：写入内存聚合根（流程 + 版本记录 + 不动的实例表）
      set({workflows:stagedWorkflows,instances:stagedInstances});

      // 阶段 5：事务落盘（模拟磁盘故障在此抛错 → catch 中存储与内存一起回滚）
      commitPersisted(stagedWorkflows,stagedInstances);

      releaseLock(w0.id);
      baseRevisions.set(w0.id,fresh.revision+1);dirtyDrafts.delete(w0.id);
      set({publishing:false,toast:`发布成功：v${nextVersion} 快照已冻结，运行中实例继续按旧版本执行，新实例才用 v${nextVersion}`,toastTone:'ok'});
      return {ok:true,version:nextVersion};
    }catch(err){
      // 事务失败：先解除故障注入，把持久层恢复到发布前，再回滚内存，保证流程/版本/实例三处一致
      failNextStorageWrite=false;failNextPublishStage=false;
      try{commitPersisted(rollback.workflows,rollback.instances);}catch{/* 存储本身已故障，至少保证内存回滚 */}
      releaseLock(w0.id);
      set({workflows:rollback.workflows,instances:rollback.instances,publishing:false,
        toast:`发布失败，流程/版本/实例已回滚到发布前（${err instanceof Error?err.message:'写入失败'}），可重提 v${nextVersion}`,toastTone:'error'});
      return {ok:false,reason:'failed',stage:'commit',version:nextVersion,message:err instanceof Error?err.message:'写入失败'};
    }
  },

  rebaseDraft:()=>{const c=get().conflict;if(!c)return;
    const latest=get().workflows.find(w=>w.id===c.workflowId);
    if(latest){baseRevisions.set(latest.id,latest.revision);dirtyDrafts.delete(latest.id);
      set(s=>({currentId:latest.id,workflows:s.workflows.map(w=>w.id===latest.id?{...w,nodes:clone(latest.nodes),edges:clone(latest.edges)}:w),conflict:null,toast:`已同步到最新 v${latest.version}，请在此基础上重新改稿`,toastTone:'ok'}));}
    else set({conflict:null});
  },
  discardConflict:()=>set({conflict:null}),

  /** 发起实例（事务）：新实例钉住当前最新发布版本；写入失败整体回滚 */
  startInstance:(workflowId)=>{
    const w=get().workflows.find(x=>x.id===workflowId)!;
    const pinVersion=w.version;
    const inst:Instance={id:`INS-2026-${String(Date.now()).slice(-6)}-${Math.floor(Math.random()*90+10)}`,workflowId,applicant:'林秋',domain:w.domain,currentNode:'提交申请',status:'running',submittedAt:'2026-09-30 16:40',duration:'0h 0m',risk:'low',version:pinVersion,timeline:[{title:'提交申请',time:'16:40',status:'current'}]};
    const before={workflows:clone(get().workflows),instances:clone(get().instances)};
    const nextInstances=[inst,...get().instances];
    try{
      if(failNextStartInstance){failNextStartInstance=false;throw new Error('StorageError: 实例写入失败（模拟）');}
      set({instances:nextInstances});
      commitPersisted(get().workflows,nextInstances);
      set({toast:`新实例 ${inst.id} 已按 v${pinVersion} 启动（新版本仅对新实例生效）`,toastTone:'ok'});
      return inst;
    }catch(err){
      failNextStorageWrite=false;
      try{commitPersisted(before.workflows,before.instances);}catch{/* ignore */}
      set({workflows:before.workflows,instances:before.instances,toast:`发起失败，已回滚：${err instanceof Error?err.message:'写入失败'}`,toastTone:'error'});
      throw err;
    }
  },

  create:()=>{const id='wf-'+Date.now();
    set(s=>({workflows:[{id,name:'未命名流程',domain:'财务',status:'draft',version:0,editor:'林秋',updatedAt:'2026-09-30 16:40',abnormalCount:0,nodes:[],edges:[],versions:[],revision:0},...s.workflows],currentId:id}));
    baseRevisions.set(id,0);dirtyDrafts.add(id);return id;},
  copy:id=>set(s=>{const w=s.workflows.find(x=>x.id===id)!;
    return{workflows:[{...clone(w),id:'wf-'+Date.now(),name:w.name+'（副本）',status:'draft',revision:w.revision},...s.workflows]};}),
  archive:id=>set(s=>({workflows:s.workflows.map(w=>w.id===id?{...w,status:'archived'}:w)})),
  restore:v=>set(s=>({workflows:s.workflows.map(w=>{if(w.id!==s.currentId)return w;const old=w.versions.find(x=>x.version===v)!;dirtyDrafts.add(w.id);
    return{...w,status:'draft',nodes:clone(old.nodes),edges:clone(old.edges)}}),toast:`已恢复 v${v} 为草稿`,toastTone:'ok'})),
  clearToast:()=>set({toast:''}),
  __failStorageWrite:()=>{failNextStorageWrite=true;},
  __failPublishStage:(stage:string)=>{failNextPublishStage=stage;},
  __failStartInstance:()=>{failNextStartInstance=true;},
}),{
  name:STORAGE_KEY,
  storage:hydratedStorage,
  /** 其他窗口提交发布/发起实例后，监听原生 storage 事件重新水合已提交事实（草稿仍由 merge 保护） */
  onRehydrateStorage:()=>{
    if(typeof window==='undefined')return;
    const listener=(e:StorageEvent)=>{
      if(e.key===STORAGE_KEY&&e.newValue){try{(useAppStore as any).persist.rehydrate();}catch{/* ignore */}}
    };
    window.addEventListener('storage',listener);
  },
  partialize:s=>({workflows:s.workflows,instances:s.instances}),
  /**
   * 跨窗口合并：版本快照/修订号/实例路由等已提交事实以持久层为准；
   * 本窗口未发布的草稿画布（dirtyDrafts）保持不动，另一窗口的发布不能覆盖它。
   */
  merge:(persisted:any,current)=>{
    const p=persisted?.state??persisted;
    if(!p||!Array.isArray(p.workflows))return current;
    const workflows=current.workflows.map(w=>{
      const inc=p.workflows.find((x:Workflow)=>x.id===w.id);
      if(!inc)return w;
      // 本窗口有未发布草稿时：版本记录/修订号等已提交事实以持久层为准，
      // 但画布节点与 draft 状态保留本窗口草稿，不被另一窗口的发布覆盖
      const keepDraft=dirtyDrafts.has(w.id);
      return keepDraft
        ?{...w,status:'draft' as const,version:inc.version,publishedAt:inc.publishedAt,revision:inc.revision,versions:inc.versions,abnormalCount:inc.abnormalCount}
        :{...inc,nodes:inc.nodes,edges:inc.edges};
    });
    p.workflows.forEach((inc:Workflow)=>{if(!workflows.some(w=>w.id===inc.id))workflows.push(inc);});
    return {...current,...p,workflows};
  },
}));

// 事务失败注入点，供演示与端到端验证「写入失败 → 整体回滚 → 重提同一版本号」
(window as any).__flowdesk={
  failNextStorageWrite:()=>useAppStore.getState().__failStorageWrite(),
  failNextPublishStage:(stage='instances')=>useAppStore.getState().__failPublishStage(stage),
  failNextStartInstance:()=>useAppStore.getState().__failStartInstance(),
  /** 模拟另一窗口正持有发布锁（默认 3 秒），用于确定性验证同时刻提交的互斥 */
  holdPublishLock:(workflowId='wf-other',ttlMs=3000)=>{localStorage.setItem(LOCK_KEY,JSON.stringify({workflowId,at:Date.now(),token:'sim-'+Math.random()}));setTimeout(()=>{try{const raw=localStorage.getItem(LOCK_KEY);if(raw&&JSON.parse(raw).workflowId===workflowId)localStorage.removeItem(LOCK_KEY);}catch{/* ignore */}},ttlMs);},
  reset:()=>localStorage.removeItem(STORAGE_KEY),
};
