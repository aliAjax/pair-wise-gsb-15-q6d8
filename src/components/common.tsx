import type {ReactNode} from 'react';
export const Status=({value}:{value:string})=><span className={'status '+value}>{({published:'已发布',draft:'草稿',archived:'已归档',abnormal:'异常',timeout:'超时',running:'进行中',completed:'已完成',high:'高风险',medium:'中风险',low:'低风险'} as any)[value]||value}</span>;
export const Empty=({title='暂无数据',text='当前筛选条件下没有匹配内容'}:{title?:string;text?:string})=><div className="empty"><div>⌁</div><b>{title}</b><p>{text}</p></div>;
export const PageTitle=({eyebrow,title,desc,actions}:{eyebrow?:string;title:string;desc:string;actions?:ReactNode})=><div className="page-title"><div>{eyebrow&&<small>{eyebrow}</small>}<h1>{title}</h1><p>{desc}</p></div>{actions&&<div className="title-actions">{actions}</div>}</div>;
