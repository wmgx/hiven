# 历史窗口静止鼠标与滚动

clipboard-history 2.0.1 删除虚拟行组件中的 `selected → scrollIntoView` effect。该 effect 在已选行重新挂载时也会运行，存在把滚轮位置拉回旧选择的路径；键盘上下导航已有父组件 `virtualizer.scrollToIndex`，保留该明确导航行为。

源码没有 hover 修改 selected 的事件，保持这一语义，不新增鼠标移动改选中。仅对行 hover 视觉加指针意图门控：屏幕坐标真实变化后恢复；键盘输入、滚轮、原生 scroll、列表页替换、窗口 focus/blur、可见性变化时暂停。使用 screen 坐标避免 WebKit 布局重排改变 client 坐标被误判为真实移动；原生 scroll 覆盖没有 wheel 事件的路径。

click 仍直接选中，但随后以 preventScroll 将键盘焦点放到稳定 surface 容器。列表滚动时若焦点仍在虚拟行内，也先移至该容器，避免行卸载后 activeElement 退到 body 导致上下键失效；不会抢走搜索框的焦点。

逻辑验证 `node scripts/test-history-pointer-intent.mts` 覆盖挂载基线、同坐标、键盘/滚轮/重开后暂停和真实移动恢复。没有样式单测。原生实际复现与滚动位置、选中/hover 截图核验由集成者完成；当前 Linux 只能验证公共交互，不声称已验证 macOS 窗口行为。

## 实际桌面复现与修复验收（2026-10-11）

隔离合成历史、Linux 原生 AppImage + X11 键鼠。旧实现选中 RECENT-0060，滚轮滚出可见范围再向上滚：通常每次 74 px，旧选中行重挂时从 scrollTop 592 突然跳至 166，确认是虚拟行 effect 回拉，不是系统鼠标需要重定位。

移除行 effect 后，同一轮连续上滚维持 74 px，经过选中行重挂也不跳变。进一步实测发现 WebKit 原生滚轮只发 scroll 的路径，以及焦点留在卸载 button 后落到 body 的问题，均按上述方案修正。

最终原生操作核对：

- 点击行后 activeElement 是稳定 surface；下滚至 scrollTop 1350、选中行已卸载，hover 门控保持关闭；按 Down 正常选中下一条并明确定位到 scrollTop 204。
- 指针屏幕坐标保持 X=309、Y=520，关闭再用纯键盘重开 History；hover 未自动启用。连续 Down 15 次选中 RECENT-0300、scrollTop 401；Up 3 次选中 RECENT-0240，没有静止指针抢回。
- 真实鼠标移动会恢复 hover；滚动及键盘又会关闭它。快速切换搜索至 RECENT-0619，旧查询不覆盖新结果，全文末尾标记正确，hover 未被虚拟行替换重启。
- 分页过滤栏在 350 px 左栏自然换行，所有标签及回收区完整可见。

未使用真实历史。当前环境没有 macOS 或实体触控板，不能将 Linux 公共交互验收说成 macOS／触控板硬件验收。

分页按钮还暴露了另一处焦点相关位移：底部快捷键提示因原生按钮焦点被条件卸载，分页区域会随之上下移动约 32 px，造成连续点击落空。改为隐藏提示但保留布局占位后，最终原生包连续点击 Next 从第 1 页到第 4 页全部成功，按钮 y 坐标始终为 519.5；搜索框焦点和录入关闭状态保持。
