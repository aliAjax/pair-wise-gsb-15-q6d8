import {test,expect,type Page,type Browser} from '@playwright/test';

/** 重置持久化与锁，强制下一次加载从 mock 种子重新水合 */
async function resetStore(page:Page){
  await page.goto('/');
  await page.evaluate(()=>{localStorage.clear();localStorage.setItem('flowdesk-reset','1');});
  await page.goto('/');
  await page.waitForTimeout(300);
}
/** 等待并读取 wf-2 的已提交状态 */
async function snapshotWf2(page:Page){
  return page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('flowdesk-v1')||'{}').state;const w=s.workflows.find((x:any)=>x.id==='wf-2');return {version:w.version,revision:w.revision,versions:w.versions.length,instances:s.instances.length};});
}

test.describe('发布事务：快照冻结与运行实例版本隔离',()=>{
  test('发布冻结新版本，已有实例按旧版本继续、新实例用新版本',async({page})=>{
    await resetStore(page);
    // wf-1 种子里条件节点缺规则，修复后才能发布
    await page.goto('/workflows/wf-1');
    await page.getByTestId('canvas-node-condition').click();
    await page.getByLabel('条件字段').selectOption({label:'申请金额'});
    await page.getByLabel('条件比较值').fill('5000');
    await page.getByTestId('save-node-config').click();
    await page.getByTestId('validate-button').click();
    await expect(page.getByTestId('error-count')).toContainText('0 错误');
    await page.getByTestId('publish-button').click();
    await expect(page.getByRole('status')).toContainText('v2 快照已冻结');

    // 监控：旧实例（wf-1 的 INS-2026-0001 钉在 v1）仍按旧版本执行
    await page.goto('/monitor?instance=INS-2026-0001');
    const detail=page.getByTestId('instance-detail');
    await expect(detail).toBeVisible();
    await expect(page.getByTestId('detail-version')).toContainText('v1');
    await expect(page.getByTestId('detail-version')).toContainText('继续按 v1 快照执行');
    await expect(page.getByTestId('detail-version')).toContainText('v2');
    await expect(page.getByTestId('detail-diff')).toContainText('配置变化');
    // 执行画布按 v1 冻结快照渲染：v1 没有 notify 节点
    await expect(page.locator('.runtime-canvas [data-testid="canvas-node-notify"]')).toHaveCount(0);

    // 发起新实例：钉住刚发布的 v2（先关闭详情抽屉避免遮挡）
    await page.getByTestId('instance-detail').locator('button.icon-btn').click();
    await page.getByLabel('选择流程发起新实例').selectOption('wf-1');
    await page.getByTestId('start-instance').click();
    await expect(page.getByRole('status')).toContainText('v2 启动');
    await expect(page.getByTestId('detail-version')).toContainText('v2');
    await expect(page.getByTestId('detail-version')).toContainText('最新发布版本');
    await expect(page.locator('.runtime-canvas [data-testid="canvas-node-notify"]')).toHaveCount(1);
  });

  test('版本记录显示各版本运行实例数，比较展示结构差异',async({page})=>{
    await resetStore(page);
    await page.goto('/workflows/wf-1/versions');
    await expect(page.getByTestId('version-compare')).toContainText('连线变化');
    const v1Row=page.locator('.version-list button',{hasText:'v1'}).first();
    await expect(v1Row).toContainText('实例仍在执行此版本');
    // 从监控「查看差异」跳入：from=1&to=2 已预选，v2 相对 v1 新增通知节点
    await page.goto('/workflows/wf-1/versions?from=1&to=2');
    await expect(page.getByTestId('version-compare')).toContainText('新增节点');
  });
});

test.describe('发布事务：并发冲突',()=>{
  test('两个窗口同时发布，只有一个成功，另一个保留草稿并看到冲突',async({browser}:{browser:Browser})=>{
    const ctx=await browser.newContext({viewport:{width:1440,height:900}});
    // A 页先做强制重置并从种子水合
    const a=await ctx.newPage();
    await a.goto('/');
    await a.evaluate(()=>{localStorage.clear();localStorage.setItem('flowdesk-reset','1');});
    await a.goto('/workflows/wf-2');
    await a.waitForTimeout(300);
    // B 页在另一个标签打开同一流程，基线同为 rev2
    const b=await ctx.newPage();
    await b.goto('/workflows/wf-2');
    // A 在自己的窗口改稿（修改审批说明，形成未发布草稿）
    await a.getByTestId('canvas-node-approval').click();
    await a.getByLabel('审批说明').fill('A 窗口的改稿：补充合规复核要求');
    // B 先发布成功（revision 2→3，落 v3 快照）；A 未刷新、保留自己的草稿，
    // 随后提交时乐观锁读到 rev3 ≠ 基线 rev2，判冲突。
    await b.getByTestId('publish-button').click();
    await expect(b.getByRole('status'),'B 发布成功').toContainText('发布成功',{timeout:15000});
    await a.getByTestId('publish-button').click();
    await expect(a.getByTestId('publish-conflict'),'A 看到冲突弹窗').toBeVisible({timeout:15000});
    await expect(a.getByTestId('conflict-diff')).toContainText('草稿');
    // A 的草稿画布未被 B 的发布覆盖（版本记录已更新到 v3，但画布保留 A 的草稿）
    await expect(a.getByTestId('flow-canvas')).toBeVisible();
    await expect(a.locator('.draft-indicator')).toContainText('草稿');
    await expect(a.getByLabel('审批说明')).toHaveValue('A 窗口的改稿：补充合规复核要求');
    // A 也可以选择「同步到最新」后重新改稿
    await a.getByTestId('conflict-rebase').click();
    await expect(a.getByRole('status')).toContainText('v3');
    // B 的发布落了 v3 版本快照
    await b.goto('/workflows/wf-2/versions');
    await expect(b.locator('.version-list',{hasText:'v3'})).toBeVisible();
    await ctx.close();
  });

  test('发布锁被另一窗口持有时提交，直接判冲突且版本号不消费',async({page})=>{
    await resetStore(page);
    await page.goto('/workflows/wf-2');
    // 模拟另一窗口此刻正持有发布锁
    await page.evaluate(()=>(window as any).__flowdesk.holdPublishLock('wf-other',2000));
    await page.getByTestId('publish-button').click();
    await expect(page.getByTestId('publish-conflict'),'持锁期间提交应看到冲突').toBeVisible({timeout:15000});
    await page.getByTestId('conflict-keep').click();
    // 锁释放后同一版本号可正常重提（之前没有产生 v3）
    await page.waitForTimeout(2100);
    await page.getByTestId('publish-button').click();
    await expect(page.getByRole('status')).toContainText('v3');
  });
});

test.describe('发布事务：失败回滚',()=>{
  test('落盘失败后流程/版本/实例一起回滚，可重提同一版本号',async({page})=>{
    await resetStore(page);
    await page.goto('/workflows/wf-2');
    // 先成功发布一次建立已提交基线（wf-2 种子 v2 → v3）
    await page.getByTestId('publish-button').click();
    await expect(page.getByRole('status')).toContainText('发布成功');
    await expect(page.locator('.draft-indicator')).toContainText('v3');
    const before=await snapshotWf2(page);
    // 下一次事务落盘失败：流程/版本/实例都应回到 before，且 v4 版本号不被消费
    await page.evaluate(()=>(window as any).__flowdesk.failNextStorageWrite());
    await page.getByTestId('publish-button').click();
    await expect(page.getByRole('status')).toContainText('已回滚到发布前');
    await expect(page.getByRole('status')).toContainText('v'+(before.version+1));
    const after=await snapshotWf2(page);
    expect(after).toEqual(before);
    // 重提同一版本号成功，版本号不被跳过
    await page.getByTestId('publish-button').click();
    await expect(page.getByRole('status')).toContainText('发布成功');
    const retry=await snapshotWf2(page);
    expect(retry.version).toBe(before.version+1);
    expect(retry.revision).toBe(before.revision+1);
    expect(retry.versions).toBe(before.versions+1);
    expect(retry.instances).toBe(before.instances); // 已有实例不迁移
  });

  test('实例路由阶段失败同样整体回滚',async({page})=>{
    await resetStore(page);
    await page.goto('/workflows/wf-2');
    await page.getByTestId('publish-button').click();
    await expect(page.getByRole('status')).toContainText('发布成功');
    const before=await snapshotWf2(page);
    await page.evaluate(()=>(window as any).__flowdesk.failNextPublishStage('instances'));
    await page.getByTestId('publish-button').click();
    await expect(page.getByRole('status')).toContainText('已回滚到发布前');
    const after=await snapshotWf2(page);
    expect(after).toEqual(before);
  });
});
