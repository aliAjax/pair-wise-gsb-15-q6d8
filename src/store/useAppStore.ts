import {create} from 'zustand';
import {workflows as seed} from '../../mock-data/workflows';
import {instances as seedInstances} from '../../mock-data/instances';
import type {FlowEdge,FlowNode,Instance,PublishResult,ValidationIssue,Workflow,Version} from '../types';
const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const stamp=()=>{const d=new Date(),p=(k:number)=>String(k).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`};
const validate=(w:Workflow):ValidationIssue[]=>{
 const issues:ValidationIssue[]=[];
 if(!w.nodes.some(n=>n.type==='end')) issues.push({nodeId:w.nodes[0]?.id||'flow',level:'error',message:'流程缺少结束节点'});
 const linked=new Set(w.edges.flatMap(e=>[e.source,e.target]));
 w.nodes.filter(n=>n.type!=='start'&&n.type!=='end'&&!linked.has(n.id)).forEach(n=>issues.push({nodeId:n.id,level:'error',message:'必经节点不能孤立'}));
 w.nodes.forEach(n=>{
  if(n.type==='condition'&&!n.data.config.ruleType)issues.push({nodeId:n.id,level:'error',message:'条件分支规则未配置'});
  if(n.type==='approval'&&!n.data.config.approverSource)issues.push({nodeId:n.id,level:'error',message:'审批人不能为空'});
 });
 return issues;
};
interface State{
 workflows:Workflow[];instances:Instance[];
 currentId:string;selectedNodeId:string|null;issues:ValidationIssue[];toast:string;
 failNextWrite:boolean;
 setCurrent:(id:string)=>void;selectNode:(id:string|null)=>void;
 updateNodes:(nodes:FlowNode[])=>void;updateEdges:(edges:FlowEdge[])=>void;
 updateConfig:(id:string,config:Record<string,any>)=>void;
 runValidation:()=>ValidationIssue[];
 save:()=>void;
 publish:()=>PublishResult;
 rebaseDraft:()=>void;
 peerPublish:(note?:string)=>void;
 armWriteFailure:(v:boolean)=>void;
 spawnInstance:(workflowId?:string)=>void;
 create:()=>string;copy:(id:string)=>void;archive:(id:string)=>void;restore:(v:number)=>void;clearToast:()=>void;
}
export const useAppStore=create<State>((set,get)=>({
 workflows:clone(seed),instances:clone(seedInstances),
 currentId:'wf-1',selectedNodeId:null,issues:[],toast:'',failNextWrite:false,
 setCurrent:id=>set({currentId:id,selectedNodeId:null,issues:[]}),
 selectNode:id=>set({selectedNodeId:id}),
 updateNodes:nodes=>set(s=>({workflows:s.workflows.map(w=>w.id===s.currentId?{...w,nodes}:w)})),
 updateEdges:edges=>set(s=>({workflows:s.workflows.map(w=>w.id===s.currentId?{...w,edges}:w)})),
 updateConfig:(id,config)=>set(s=>({workflows:s.workflows.map(w=>w.id===s.currentId?{...w,nodes:w.nodes.map(n=>n.id===id?{...n,data:{...n.data,config:{...n.data.config,...config},state:'configuring'}}:n)}:w)})),
 runValidation:()=>{
  const w=get().workflows.find(x=>x.id===get().currentId)!;
  const issues=validate(w);
  set(s=>({issues,workflows:s.workflows.map(x=>x.id===w.id?{...x,nodes:x.nodes.map(n=>({...n,data:{...n.data,state:issues.some(i=>i.nodeId===n.id)?'invalid':'valid'}}))}:x),toast:issues.length?`发现 ${issues.length} 个问题`:'校验通过'}));
  return issues;
 },
 save:()=>set(s=>({workflows:s.workflows.map(w=>w.id===s.currentId?{...w,status:w.status==='archived'?'archived':'draft',updatedAt:stamp()}:w),toast:'草稿已保存'})),
 /**
  * 发布事务：草稿 → 冻结版本快照 → 乐观锁冲突检查 → 写入流程/版本/实例三张表。
  * 写入阶段抛错时整事务回滚到发布前快照，版本号不前进，可用同一版本号重提。
  * 已有运行实例携带自己的 version，继续按原版本执行；仅新实例采用新版本。
  */
 publish:()=>{
  const id=get().currentId;
  const before={workflows:clone(get().workflows),instances:clone(get().instances)};
  try{
   const w=get().workflows.find(x=>x.id===id)!;
   const issues=validate(w);
   if(issues.length){
    set(s=>({issues,workflows:s.workflows.map(x=>x.id===id?{...x,nodes:x.nodes.map(n=>({...n,data:{...n.data,state:issues.some(i=>i.nodeId===n.id)?'invalid':'valid'}}))}:x)}));
    return {ok:false,reason:'invalid',message:`校验未通过，存在 ${issues.length} 个待修复问题，发布已中止`};
   }
   // 发布前冻结版本快照（先在事务外算好，提交时整体写入）
   const next=w.revision+1;
   const snapshot:Version={version:next,createdAt:stamp(),note:'发布最新审批配置',nodes:clone(w.nodes),edges:clone(w.edges),publishedBy:w.editor};
   // 乐观锁：另一个窗口已经提交过发布，本窗口草稿基线落后 → 冲突，草稿原样保留
   if(w.draftBaseRevision!==w.revision){
    return {ok:false,reason:'conflict',message:`发布冲突：另一窗口已发布 v${w.revision}，当前草稿仍基于 v${w.draftBaseRevision}。草稿已保留，请确认差异后重新发布`,serverVersion:w.revision};
   }
   set(s=>{
    if(s.failNextWrite){
     // 模拟提交阶段写入失败（版本表/实例表落库异常）：抛出以触发事务回滚
     throw new Error('版本记录写入失败（模拟）');
    }
    return {
     failNextWrite:false,
     workflows:s.workflows.map(x=>x.id!==id?x:{
      ...x,status:'published' as const,version:next,revision:next,draftBaseRevision:next,
      publishedAt:snapshot.createdAt,updatedAt:snapshot.createdAt,
      nodes:snapshot.nodes,edges:snapshot.edges,
      versions:[...x.versions,snapshot]
     })
    };
   });
   set({toast:`发布成功，新版本 v${next} 已生效（运行中的旧实例继续按原版本执行）`});
   return {ok:true,version:next};
  }catch(err){
   // 流程、版本、实例一起回滚到发布前
   set({...before,failNextWrite:false,toast:`写入失败，已回滚到发布前状态（版本、实例未变更），可用原版本号重新提交：${(err as Error).message}`});
   const w0=before.workflows.find(x=>x.id===id)!;
   return {ok:false,reason:'write-failed',message:'发布事务写入失败，已整体回滚',retryVersion:w0.revision+1};
  }
 },
 // 基于服务端最新版本更新草稿基线：查看差异后把最新配置并入草稿，再发布为下一版本
 rebaseDraft:()=>set(s=>{
  const id=s.currentId;
  const w=s.workflows.find(x=>x.id===id)!;
  return {workflows:s.workflows.map(x=>{
   if(x.id!==id)return x;
   const latest=[...x.versions].sort((a,b)=>b.version-a.version)[0];
   if(!latest||x.draftBaseRevision===x.revision)return x;
   return {...x,nodes:clone(latest.nodes),edges:clone(latest.edges),draftBaseRevision:x.revision,updatedAt:stamp()};
  }),toast:`草稿已合并最新 v${w.revision}，可重新发布`};
 }),
 // 模拟“另一个窗口/他人”先完成发布：服务端版本前进，但不覆盖当前窗口的草稿内容
 peerPublish:(note='另一窗口提交的审批调整')=>{
  const id=get().currentId;
  const w=get().workflows.find(x=>x.id===id)!;
  const next=w.revision+1;
  const nodes=w.nodes.map(nn=>nn.type==='approval'?{...nn,data:{...nn.data,config:{...nn.data.config,instruction:`${nn.data.config.instruction||''}（v${next} 补充：请同步核验预算中心）`.trim()}}}:nn);
  const snapshot:Version={version:next,createdAt:stamp(),note,nodes:clone(nodes),edges:clone(w.edges),publishedBy:'陈默（另一窗口）'};
  set(s=>({workflows:s.workflows.map(x=>x.id!==id?x:{
   ...x,version:next,revision:next,status:x.status==='archived'?'archived':'published',
   publishedAt:snapshot.createdAt,updatedAt:snapshot.createdAt,
   versions:[...x.versions,snapshot]
   // 不动 x.nodes：那是本窗口的草稿；运行定义以 versions 快照为准
  }),toast:''}));
 },
 armWriteFailure:v=>set({failNextWrite:v,toast:''}),
 // 新实例始终采用流程当前最新已发布版本
 spawnInstance:(workflowId)=>{
  const id=workflowId||get().currentId;
  const w=get().workflows.find(x=>x.id===id)!;
  const latest=w.version;
  const ins:Instance={id:`INS-2026-${String(Date.now()).slice(-6)}`,workflowId:id,applicant:'林秋',domain:w.domain,version:latest,currentNode:w.nodes.find(nn=>nn.type==='approval')?.data.label||'提交申请',status:'running',submittedAt:stamp(),duration:'0h 0m',risk:'low',timeline:[{title:'提交申请',time:'刚刚',status:'completed'},{title:'直属主管审批',time:'待处理',status:'current'},{title:'金额判断',time:'待处理',status:'pending'}]};
  set(s=>({instances:[ins,...s.instances],toast:`新实例 ${ins.id} 已按最新版本 v${latest} 启动`}));
 },
 create:()=>{
  const id='wf-'+Date.now();
  set(s=>({workflows:[{id,name:'未命名流程',domain:'财务',status:'draft',version:0,revision:0,draftBaseRevision:0,editor:'林秋',updatedAt:stamp(),abnormalCount:0,nodes:[],edges:[],versions:[]},...s.workflows],currentId:id}));
  return id;
 },
 copy:id=>set(s=>{
  const w=s.workflows.find(x=>x.id===id)!;
  return{workflows:[{...clone(w),id:'wf-'+Date.now(),name:w.name+'（副本）',status:'draft',revision:0,draftBaseRevision:0,version:0,versions:[]},...s.workflows]};
 }),
 archive:id=>set(s=>({workflows:s.workflows.map(w=>w.id===id?{...w,status:'archived'}:w)})),
 restore:v=>set(s=>({workflows:s.workflows.map(w=>{
  if(w.id!==s.currentId)return w;
  const old=w.versions.find(x=>x.version===v)!;
  return{...w,status:'draft',nodes:clone(old.nodes),edges:clone(old.edges),draftBaseRevision:w.revision,updatedAt:stamp()};
 }),toast:`已恢复 v${v} 为草稿（基于当前 v${s.workflows.find(w=>w.id===s.currentId)!.revision}，确认后可发布为新版本）`})),
 clearToast:()=>set({toast:''})
}));
