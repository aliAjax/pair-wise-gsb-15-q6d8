export type WorkflowStatus='draft'|'published'|'archived';
export type NodeKind='start'|'form'|'approval'|'condition'|'automation'|'notify'|'end';
export type NodeState='unconfigured'|'configuring'|'valid'|'invalid';
export interface FormField {id:string;label:string;type:'text'|'number'|'amount'|'date'|'select'|'attachment';required:boolean;options?:string[]}
export interface FlowNode {id:string;type:NodeKind;position:{x:number;y:number};data:{label:string;state:NodeState;config:Record<string,any>}}
export interface FlowEdge {id:string;source:string;target:string;label?:string}
export interface Version {version:number;createdAt:string;note:string;nodes:FlowNode[];edges:FlowEdge[]}
export interface Workflow {id:string;name:string;domain:string;status:WorkflowStatus;version:number;editor:string;updatedAt:string;publishedAt?:string;abnormalCount:number;nodes:FlowNode[];edges:FlowEdge[];versions:Version[];
  /** 乐观锁修订号：每次发布成功 +1，两个窗口据此识别并发发布 */
  revision:number}
export interface Instance {id:string;workflowId:string;applicant:string;domain:string;currentNode:string;status:'abnormal'|'timeout'|'running'|'completed';submittedAt:string;duration:string;risk:'high'|'medium'|'low';
  /** 实例启动时冻结的流程版本，实例终生按该版本快照执行，不随后续发布变化 */
  version:number;
  timeline:{title:string;time:string;status:string}[]}
export interface ValidationIssue {nodeId:string;level:'error'|'warning';message:string}
export interface VersionDiff {added:FlowNode[];removed:FlowNode[];changed:FlowNode[];edgeDelta:number}
/** 发布事务结果：success 原子提交；conflict 保留草稿；failed 整体回滚，可用同一版本号重提 */
export type PublishOutcome={ok:true;version:number}|{ok:false;reason:'conflict';baseRevision:number;latestRevision:number;latestVersion:number}|{ok:false;reason:'failed';stage:string;version:number;message:string}|{ok:false;reason:'invalid';issues:ValidationIssue[]};
