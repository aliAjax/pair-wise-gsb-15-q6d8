import {useMemo,useState} from 'react';import {useNavigate,useParams} from 'react-router-dom';import {ArrowLeft,GitCompare,History,RotateCcw,Users} from 'lucide-react';import {PageTitle} from '../components/common';import {useAppStore} from '../store/useAppStore';
const edgeKey=(e:{source:string;target:string})=>`${e.source}->${e.target}`;
export function Versions(){
 const {id}=useParams(),nav=useNavigate(),store=useAppStore();
 const w=store.workflows.find(x=>x.id===id)!;
 const all=[...w.versions].sort((a,b)=>b.version-a.version);
 // 每个版本当前仍在采用的实例（运行中/异常/超时未结束的实例不会随发布迁移）
 const adoption=useMemo(()=>{const m:Record<number,number>={};store.instances.filter(i=>i.workflowId===id).forEach(i=>{m[i.version]=(m[i.version]||0)+1});return m},[store.instances,id]);
 const [left,setLeft]=useState(all.at(-1)?.version||1),[right,setRight]=useState(all[0]?.version||w.version);
 const a=all.find(v=>v.version===left),b=all.find(v=>v.version===right);
 const diff=useMemo(()=>{
  if(!a||!b)return {added:[],removed:[],changed:[],edgesAdded:[],edgesRemoved:[]};
  const aEdges=new Set(a.edges.map(edgeKey)),bEdges=new Set(b.edges.map(edgeKey));
  return {
   added:b.nodes.filter(n=>!a.nodes.some(x=>x.id===n.id)),
   removed:a.nodes.filter(n=>!b.nodes.some(x=>x.id===n.id)),
   changed:b.nodes.filter(n=>{const old=a.nodes.find(x=>x.id===n.id);return old&&JSON.stringify(old.data.config)!==JSON.stringify(n.data.config)}),
   edgesAdded:b.edges.filter(e=>!aEdges.has(edgeKey(e))),
   edgesRemoved:a.edges.filter(e=>!bEdges.has(edgeKey(e)))
  };
 },[a,b]);
 const restore=()=>{store.setCurrent(w.id);store.restore(left);nav(`/workflows/${w.id}`)};
 const nodeLabel=(nid:string)=>w.nodes.find(n=>n.id===nid)?.data.label||nid;
 const edgeLabel=(e:{source:string;target:string;label?:string})=>`${nodeLabel(e.source)} → ${nodeLabel(e.target)}${e.label?`（${e.label}）`:''}`;
 return <div className="page versions-page"><button className="back-link" onClick={()=>nav(`/workflows/${id}`)}><ArrowLeft/>返回编辑器</button><PageTitle eyebrow="流程版本" title="Version History" desc={`${w.name} · 发布前冻结快照；运行实例继续按各自版本执行，可比较结构差异或恢复历史版本。`}/><div className="version-layout"><aside className="panel version-list"><h3><History/>版本记录</h3>{all.map((v,i)=><button key={v.version} className={v.version===right?'active':''} onClick={()=>setRight(v.version)}><span><b>v{v.version}</b>{v.version===w.revision&&<em>当前运行</em>}</span><small>{v.createdAt}{v.publishedBy?` · ${v.publishedBy}`:''}</small><p>{v.note}</p><small className="adoption" data-testid="version-adoption"><Users/>{adoption[v.version]?`${adoption[v.version]} 个运行实例仍采用此版本`:((v.version===w.revision&&w.status==='published')?'暂无实例，新实例将采用此版本':'当前无实例采用')}</small></button>)}</aside><section className="panel compare" data-testid="version-compare"><div className="compare-head"><div><GitCompare/><h2>版本对比</h2></div><button className="secondary" data-testid="restore-version" onClick={restore}><RotateCcw/>恢复 v{left} 为草稿</button></div><div className="compare-select"><label>基准版本<select value={left} onChange={e=>setLeft(Number(e.target.value))}>{all.map(v=><option key={v.version} value={v.version}>v{v.version} · {v.createdAt} · {adoption[v.version]||0} 个实例采用</option>)}</select></label><span>→</span><label>比较版本<select value={right} onChange={e=>setRight(Number(e.target.value))}>{all.map(v=><option key={v.version} value={v.version}>v{v.version} · {v.createdAt} · {adoption[v.version]||0} 个实例采用</option>)}</select></label></div><div className="diff-summary"><article><small>新增节点</small><b>{diff.added.length}</b></article><article><small>删除节点</small><b>{diff.removed.length}</b></article><article><small>配置变化</small><b>{diff.changed.length}</b></article><article><small>连线变化</small><b>{diff.edgesAdded.length+diff.edgesRemoved.length}</b></article></div><div className="diff-list"><h3>变更明细</h3>{diff.added.map(n=><div key={n.id} className="diff added"><span>＋ 新增</span><b>{n.data.label}</b><small>{n.type} 节点</small></div>)}{diff.removed.map(n=><div key={n.id} className="diff removed"><span>− 删除</span><b>{n.data.label}</b><small>{n.type} 节点</small></div>)}{diff.changed.map(n=><div key={n.id} className="diff changed"><span>~ 配置</span><b>{n.data.label}</b><small>节点配置已更新</small></div>)}{diff.edgesAdded.map(e=><div key={'ea'+edgeKey(e)} className="diff added"><span>＋ 连线</span><b>{edgeLabel(e)}</b><small>新增连线</small></div>)}{diff.edgesRemoved.map(e=><div key={'er'+edgeKey(e)} className="diff removed"><span>− 连线</span><b>{edgeLabel(e)}</b><small>删除连线</small></div>)}{!diff.added.length&&!diff.removed.length&&!diff.changed.length&&!diff.edgesAdded.length&&!diff.edgesRemoved.length&&<div className="empty-diff">这两个版本的节点结构一致</div>}<div className="release-note"><small>发布说明（v{right}）</small><p>{b?.note}</p></div></div></section></div></div>}
