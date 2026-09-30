import type {Instance} from '../src/types';
import {domains,users} from './catalog';
import {workflows} from './workflows';
// 实例在创建时冻结所采用的流程版本；发布新版本不会迁移仍在执行的实例。
// 每隔一个批次回退到上一版本，制造“老实例跑旧版本、新实例跑新版本”的并存场景。
export const instances:Instance[]=Array.from({length:80},(_,i)=>{
 const status:Instance['status']=i<12?'abnormal':i<22?'timeout':i<50?'running':'completed';
 const wf=workflows[i%12]; const latest=wf.version; const rank=Math.floor(i/12);
 const version=rank%2===0?Math.max(1,latest-1):latest;
 return {id:`INS-2026-${String(i+1).padStart(4,'0')}`,workflowId:`wf-${i%12+1}`,applicant:users[i%8],domain:domains[i%5],version,currentNode:i%3===0?'直属主管审批':'金额判断',status,submittedAt:`2026-07-${String(10-i%9).padStart(2,'0')} ${String(8+i%10).padStart(2,'0')}:10`,duration:status==='timeout'?`${28+i}h`:`${i%9+1}h ${i%6*10}m`,risk:i<22?'high':i<45?'medium':'low',timeline:[{title:'提交申请',time:'09:10',status:'completed'},{title:'直属主管审批',time:'10:24',status:i%3===0?'current':'completed'},{title:'金额判断',time:'11:05',status:i%3!==0?'current':'pending'}]};
});
