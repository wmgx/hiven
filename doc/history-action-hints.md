# 剪贴板历史快捷键提示与当前上下文

## 已证问题与范围

实际隔离 QA 中，无查询结果时顶部粘贴已禁用，底部仍显示 Enter 粘贴、Ctrl+Enter 带回、退格删除；设置按钮获焦时仍提示 Enter 粘贴；搜索输入获焦时仍提示退格删除记录。旧 handler 实际会对无选中项、原生按钮和输入编辑分别让行。此证据是提示与行为不一致，不是发生误删或误贴的证明。

本次用同一纯资格判定驱动这三个快捷键分支与现有 footer：选择、加载、启用、弹窗/合并状态及当前焦点决定可用提示。输入/SELECT 不显示删除，普通按钮不显示历史操作，无选中不显示三项。保留底部容器，避免焦点移动导致列表高度变化；不新增按钮、灰色不可用文字或 Esc 说明。

三个快捷键新增 loading/disabled 窄守卫，对未处理的键不 preventDefault。输入中 Enter 原有交付语义、IME、复制、导航、合并及实际删除/交付函数保持不变。焦点监听限定当前 surface，处理 webview 内外、窗口隐藏/重显和虚拟行移除；只观察局部 childList，卸载清理监听与 observer，排队回调失效。

clipboard-history 版本 1.4.3，内置索引 101。与独立文件分类实验分支无合并。

## 验证

正式 `npm run test:clipboard-history-shortcuts` 在最终接线后通过，覆盖生产 helper、实际 handler AST 与焦点监听。独立审查补验快速焦点切换、无 focusout 的 DOM 移除、排队回调晚到、root 替换及 loading/disabled 下复制与导航保持原行为。architecture 和 diff-check 通过；没有真实删除或交付操作。

ee29acc 最终 check:typecheck、内置源码释放检查、Vite 和 diff-check 通过；官方 native + AppImage 首轮 exit 0。日志分别为 `hiven-linux-env/logs/history-hints-frontend.log` 与 `history-hints-appimage-build.log`。

2026-10-09 22:26 UTC 原隔离 QA 正常启动 PID 8007，真实四态确认：有选中且搜索框获焦时只显示 Enter/Ctrl+Enter；无匹配结果时三项消失；恢复有记录后 Tab 到设置按钮时三项消失；真实单击记录正文使行获焦后三项恢复。底部容器高度不变。AX activate 最初只改变选择未移焦，随后依据原单击选择/双击粘贴合同使用一次真实单击确认行焦点，没有调用交付键或删除键。

内部四图与时序记录位于 `hiven-qa-oct9/history-hints-ee29acc/`，不随产品提交。加载/停用、窗口隐藏恢复与 DOM 移除等交错由隔离逻辑测试覆盖；真实界面验收未删除记录、交付文本、开启采集或改变权限。
