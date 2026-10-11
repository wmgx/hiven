# CSV 完整导出入口与严格 UTF-8 导入

同步完整解析的 CSV 可能在 JSON 序列化后超过返回搜索的 1 MiB 限制。此前保存按钮只出现在异步全量任务完成后，导致错误提示推荐了不可达的保存操作。现在将唯一的“另存完整结果”入口移至页头，以当前完整结果可用性启用；同步与全量任务复用同一 saveFullResult/saveText、10 MiB UTF-8 字节限制、取消、版本快照和晚回执保护。输出预览不参与保存，合法空结果仍可存，超限明确拒绝而不截断。

文件读取改为 arrayBuffer + fatal UTF-8 TextDecoder，支持开头 BOM，不猜测其他编码。完整解码成功后才替换材料；失败显示可重试的中英文错误，保留原材料、筛选及已有完整结果。开始读取只撤销在途交付，不清空完整结果；更新材料、参数或退出会撤销旧读取的身份，迟到读取不能覆盖较新编辑。合法编码的 U+FFFD 字符仍可导入。

## 验证

- 独立逻辑审查与输入审查通过。纯解码测试覆盖 UTF-8、BOM、中文/emoji、合法 U+FFFD、GBK、非法及截断字节；聚焦生产回调测试覆盖同步输出膨胀、取消重试、筛选变化、10 MiB 边界、旧结果保留及迟到读取/保存。
- 真实 Linux AppImage、隔离 profile、合成数据：199,193 字节的 3,000 行 CSV 同步完整解析，返回搜索因大小被拒后，通过系统另存对话框保存 1,401,902 字节 JSON；取消后结果保留且可重试，磁盘上的全部对象及末行逐值核对通过。
- 筛选到末行再另存，磁盘文件恰含该对象。GBK 与非法字节导入均拒绝，源全文、筛选与旧结果保持；UTF-8 中文 BOM 文件重试成功。
- 全量任务完成后使用同一入口另存，磁盘文件包含全部 9,001 行且逐值一致。
- 最小 704×480 窗口下保存入口、错误提示和重试操作可达；最后恢复默认窗口。输入文件通过 WebDriver 的真实 file input 选择，未验证系统打开文件对话框；保存使用了真实系统另存对话框。
- 类型检查、架构检查、前端及原生构建通过；未写样式单测，未重跑无关算法或接触真实数据/API。CSV 版本 1.11.2。

聚焦逻辑检查可使用：

```bash
node scripts/test-csv-file-input.mjs
CSV_CHECK_FILTER='expanded synchronous|strict UTF8|late UTF8|native save handles|cancel preserves|revokes a pending save|late old|file read|synchronous.*10 MiB' node scripts/test-csv-result-return.mjs
```
