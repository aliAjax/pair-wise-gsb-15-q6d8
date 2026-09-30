import type {FlowEdge,FlowNode,Instance,Version,VersionDiff,Workflow} from '../types';

/** 比较两个版本快照：b 相对 a 的结构与配置差异 */
export function diffVersions(a?:Version,b?:Version):VersionDiff{
  if(!a||!b)return {added:[],removed:[],changed:[],edgeDelta:0};
  const added=b.nodes.filter(n=>!a.nodes.some(x=>x.id===n.id));
  const removed=a.nodes.filter(n=>!b.nodes.some(x=>x.id===n.id));
  const changed=b.nodes.filter(n=>{const old=a.nodes.find(x=>x.id===n.id);
    return !!old&&JSON.stringify(old.data.config)!==JSON.stringify(n.data.config);});
  const edgeSet=(es:FlowEdge[])=>new Set(es.map(e=>`${e.source}>${e.target}`));
  const ea=edgeSet(a.edges),eb=edgeSet(b.edges);
  const edgeDelta=[...eb].filter(k=>!ea.has(k)).length+[...ea].filter(k=>!eb.has(k)).length;
  return {added,removed,changed,edgeDelta};
}

/**
 * 实例按其启动时钉住的版本快照执行；快照缺失时回退到「不高于钉住版本」的最新快照。
 * 已有运行实例不会被后续发布的新配置覆盖。
 */
export function resolveInstanceFlow(w:Workflow|undefined,i:Instance):{nodes:FlowNode[];edges:FlowEdge[];snapshot?:Version;latest:Version|null;outdated:boolean}{
  const latest=w&&w.versions.length?w.versions.reduce((m,v)=>v.version>m.version?v:m,w.versions[0]):null;
  const snap=w?.versions.find(v=>v.version===i.version)||w?.versions.filter(v=>v.version<=i.version).sort((a,b)=>b.version-a.version)[0];
  if(snap)return {nodes:snap.nodes,edges:snap.edges,snapshot:snap,latest,outdated:latest?snap.version<latest.version:false};
  return {nodes:w?.nodes??[],edges:w?.edges??[],snapshot:undefined,latest,outdated:false};
}

/** 该版本下仍在运行（含异常/超时）的实例数，用于版本记录展示 */
export function runningOnVersion(instances:Instance[],workflowId:string,version:number):number{
  return instances.filter(i=>i.workflowId===workflowId&&i.version===version&&i.status!=='completed').length;
}
