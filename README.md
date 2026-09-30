# FlowDesk Studio

FlowDesk Studio 是一个完全运行在浏览器中的企业级低代码流程编排与审批监控演示平台。项目使用 React、TypeScript、Vite、Zustand 和 React Flow，所有数据均为本地 mock，不需要后端、登录或外部 API。

## 启动

需要 Node.js 20+。

```bash
npm install
npm run dev
```

打开终端显示的本地地址（默认 `http://localhost:5173`）。建议使用 1440px 或更宽的现代桌面浏览器。

## 测试

首次运行先安装 Chromium：

```bash
npx playwright install chromium
npm test
```

Playwright 会自动启动 Vite（端口 4173），串行验证 Dashboard、编辑器审批配置、双区域校验、条件修复、动态表单预览、发布联动、异常实例详情、版本比较和历史恢复。测试失败时会保留截图和 trace。

## 浏览器验证路径

1. Dashboard 点击“差旅费用审批”进入编辑器。
2. 选择“直属主管审批”，切换审批人来源并保存草稿。
3. 运行校验，观察 Condition 节点红色错误态和底部问题面板。
4. 选择“金额判断”，配置申请金额大于 5000，再次校验。
5. 打开预览，输入金额 12000，观察模拟分支切换。
6. 返回并发布；在 Dashboard 和 Workflows 检查状态及版本。
7. 进入运行监控，筛选异常并打开实例，查看时间线及高亮节点。
8. 从编辑器进入版本历史，选择两个版本比较，再恢复旧版本为草稿。

## 项目结构

- `mock-data/`：12 个流程、80 个实例、8 个用户、6 个角色、5 个业务域及边界案例。
- `src/components/`：布局、公共状态组件和 React Flow 画布。
- `src/pages/`：Dashboard、流程列表、编辑器、表单预览、运行监控、版本历史。
- `src/store/`：Zustand 全局状态、校验、发布、复制、归档及恢复逻辑。
- `src/types/`：核心业务数据 TypeScript 类型。
- `tests/`：关键产品链路 Playwright 测试。

## Mock 边界案例

数据集中包含空流程、孤立审批节点、缺少结束节点、未配置条件分支、审批人为空、表单必填校验、超长流程名称、超长说明展示能力、无异常实例，以及由搜索筛选产生的空结果状态。
