import {test,expect} from '@playwright/test';
test.describe.serial('FlowDesk 完整链路',()=>{
 test('Dashboard KPI 与最近流程进入编辑器',async({page})=>{await page.goto('/');await expect(page.getByTestId('kpi-grid')).toBeVisible();await expect(page.getByText('流程总数')).toBeVisible();await expect(page.getByText('异常实例',{exact:true}).first()).toBeVisible();await page.getByTestId('recent-workflow').first().click();await expect(page.getByTestId('flow-canvas')).toBeVisible();});
 test('审批配置、保存和双区域校验',async({page})=>{await page.goto('/workflows/wf-1');await page.getByTestId('canvas-node-approval').click();await expect(page.getByTestId('config-panel')).toContainText('审批配置');await page.getByLabel('审批人来源').selectOption({label:'固定角色'});await page.getByTestId('save-node-config').click();await page.getByRole('button',{name:'保存草稿'}).click();await page.getByTestId('validate-button').click();await expect(page.getByTestId('canvas-node-condition')).toHaveClass(/invalid/);await expect(page.getByTestId('issues-panel')).toContainText('条件分支规则未配置');const before=await page.getByTestId('error-count').textContent();expect(Number(before?.match(/\d+/)?.[0])).toBeGreaterThan(0);await page.getByTestId('canvas-node-condition').click();await page.getByLabel('条件字段').selectOption('amount');await page.getByLabel('条件比较值').fill('5000');await page.getByTestId('save-node-config').click();await page.getByTestId('validate-button').click();await expect(page.getByTestId('error-count')).toContainText('0 错误');});
 test('表单预览金额驱动条件分支',async({page})=>{await page.goto('/workflows/wf-1/preview');await expect(page.getByTestId('branch-result')).toContainText('标准分支');await page.getByLabel('申请金额').fill('12000');await expect(page.getByTestId('branch-result')).toContainText('高额分支');});
 test('发布后列表和总览同步',async({page})=>{await page.goto('/workflows/wf-2');await page.getByTestId('publish-button').click();await expect(page.getByRole('status')).toContainText('发布成功');await page.getByRole('link',{name:'流程管理'}).click();const row=page.getByTestId('workflow-row').filter({hasText:'采购合同审批'});await expect(row).toContainText('已发布');await expect(row).toContainText('v3');await page.getByRole('link',{name:'总览'}).click();await expect(page.getByTestId('kpi-grid')).toBeVisible();});
 test('异常实例详情、时间线与当前节点高亮',async({page})=>{await page.goto('/monitor');await page.getByRole('button',{name:'异常',exact:true}).click();await page.getByTestId('instance-row').first().click();await expect(page.getByTestId('instance-detail')).toBeVisible();await expect(page.getByTestId('execution-timeline')).toContainText('提交申请');await expect(page.locator('.runtime-highlight')).toHaveCount(1);});
 test('版本比较并恢复历史版本',async({page})=>{await page.goto('/workflows/wf-2/versions');await expect(page.getByTestId('version-compare')).toContainText('新增节点');await page.getByTestId('restore-version').click();await expect(page).toHaveURL(/\/workflows\/wf-2$/);await expect(page.getByRole('status')).toContainText('已恢复');await expect(page.getByTestId('flow-canvas')).toBeVisible();});
 test('发布事务：旧实例固定旧版本、失败整体回滚、同版本重提、新实例采用新版本',async({page})=>{
  // wf-3 已发布 v3；存在固定在 v2 的运行实例（i=26 → INS-2026-0027）
  await page.goto('/monitor');
  await page.getByRole('button',{name:'进行中'}).click();
  const oldRow=page.getByTestId('instance-row').filter({hasText:'INS-2026-0027'});
  await expect(oldRow).toContainText('v2');
  await expect(oldRow).toContainText('旧版本');
  await oldRow.click();
  await expect(page.getByTestId('detail-version')).toContainText('v2');
  await expect(page.getByTestId('instance-detail')).toContainText('旧版本（最新 v3）');
  await page.keyboard.press('Escape').catch(()=>{});
  await page.locator('.drawer-backdrop .icon-btn').click().catch(()=>{});
  // 发布 v4 前注入写入失败：流程/版本/实例整体回滚
  await page.goto('/workflows/wf-3');
  await expect(page.getByTestId('draft-indicator')).toContainText('运行版本 v3');
  await page.getByTestId('arm-failure').check();
  await page.getByTestId('publish-button').click();
  await expect(page.getByTestId('publish-failed')).toBeVisible();
  await expect(page.getByTestId('publish-failed')).toContainText('v4');
  await expect(page.getByTestId('draft-indicator')).toContainText('运行版本 v3');
  await expect(page.getByRole('status')).toContainText('已回滚');
  // 用同一版本号 v4 重提成功
  await page.getByTestId('retry-publish').click();
  await expect(page.getByRole('status')).toContainText('v4');
  await expect(page.getByTestId('draft-indicator')).toContainText('运行版本 v4');
  // 老实例仍按 v2 执行（快照渲染，旧版本标记）——用站内导航保持发布事务状态
  await page.getByRole('link',{name:'运行监控'}).click();
  await expect(page).toHaveURL(/\/monitor$/);
  const oldRow2=page.getByTestId('instance-row').filter({hasText:'INS-2026-0027'});
  await expect(oldRow2).toContainText('v2');
  await expect(oldRow2).toContainText('最新 v4');
  await oldRow2.click();
  await expect(page.getByTestId('detail-version')).toContainText('v2');
  await expect(page.getByTestId('instance-detail')).toContainText('最新 v4');
  await page.locator('.drawer-backdrop .icon-btn').click();
  // 新实例采用最新版本 v4
  await page.getByLabel('新实例采用的流程').selectOption({label:'员工入职流程（最新 v4）'});
  await page.getByTestId('spawn-instance').click();
  await expect(page.getByRole('status')).toContainText('v4');
  const newRow=page.getByTestId('instance-row').filter({hasText:'林秋'}).first();
  await expect(newRow).toContainText('v4');
  await expect(newRow).not.toContainText('旧版本');
 });
 test('两窗口同时发布：只成功一个，冲突窗口保留草稿并看到差异，合并后重提为下一版本',async({page})=>{
  // 完整刷新以隔离上一用例的发布状态
  await page.goto('/');
  // wf-8 已发布 v2；本窗口改草稿（切换审批人来源），模拟另一窗口先发布 v3
  await page.goto('/workflows/wf-8');
  await page.getByTestId('canvas-node-approval').click();
  await page.getByLabel('审批人来源').selectOption({label:'固定角色'});
  await page.getByTestId('save-node-config').click();
  await page.getByRole('button',{name:'保存草稿'}).click();
  await page.getByTestId('peer-publish').click();
  await expect(page.getByTestId('draft-indicator')).toContainText('草稿基于 v2 · 落后');
  await expect(page.getByTestId('draft-indicator')).toContainText('运行版本 v3');
  // 本窗口提交发布 → 冲突，草稿保留
  await page.getByTestId('publish-button').click();
  await expect(page.getByTestId('publish-conflict')).toBeVisible();
  await expect(page.getByTestId('publish-conflict')).toContainText('服务端当前为 v3');
  // 冲突窗口未产生任何发布，草稿画布内容不变（仍有固定角色改动）
  await expect(page.getByTestId('publish-conflict')).toContainText('草稿已保留');
  await expect(page.getByTestId('draft-indicator')).toContainText('草稿基于 v2');
  // 版本比较可看到两版差异与各自采用实例数（站内导航保留另一窗口的发布）
  await page.getByRole('button',{name:'查看版本差异'}).click();
  await expect(page).toHaveURL(/\/workflows\/wf-8\/versions$/);
  await expect(page.getByTestId('version-compare')).toContainText('配置变化');
  // 旧版本仍有运行实例采用，新版本暂无实例（新实例才会采用）
  await expect(page.getByTestId('version-adoption').filter({hasText:'个运行实例仍采用此版本'}).first()).toContainText('个运行实例仍采用此版本');
  await expect(page.getByTestId('version-adoption').filter({hasText:'暂无实例'})).toContainText('暂无实例');
  // 合并最新 v3 后重提，发布为 v4
  await page.getByRole('button',{name:'返回编辑器'}).click();
  await page.getByTestId('rebase-draft-lab').click();
  await expect(page.getByRole('status')).toContainText('v3');
  await expect(page.getByTestId('draft-indicator')).not.toContainText('落后');
  await page.getByTestId('publish-button').click();
  await expect(page.getByRole('status')).toContainText('v4');
 });
});

test('1440px 桌面视觉与控制台验证',async({page})=>{
 const errors:string[]=[]; page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 for(const path of ['/','/workflows/wf-1','/monitor']){await page.goto(path);await page.waitForTimeout(250);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);expect(overflow,`${path} 不应横向溢出`).toBeFalsy()}
 await page.goto('/'); await page.screenshot({path:'test-results/dashboard-1440.png',fullPage:true});
 expect(errors,'浏览器 console 不应出现 error').toEqual([]);
});
