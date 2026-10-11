# G3–G8 初次本地验收快照

这是独立审计修复前的验收记录。原运行 manifest 和已保留文件维持原始字节；部分检查当时的实现有审计发现的覆盖缺口，不将这里的成功状态当作修复后结论。最终结果见 [审计收口](../governance-closeout-2026-10-11/README.md) 和 [完整台账](../../../process/governance-completion-2026-10-11.md)。

此目录是 **curated archive**，不是完整运行目录。`selection-manifest.json` 逐运行列出原 manifest SHA、保留文件与排除原因。临时配置、凭据容器、浏览器 profile、依赖和构建输出没有复制；不得直接拿全运行目录 verifier 判断这些缺失是损坏。所有保留文件必须与原 manifest 的 SHA 一致，保留与排除清单必须完整覆盖原产物表。

使用 Python 标准库独立校验：

```sh
python3 docs/verification/results/governance-completion-2026-10-11/verify-archive.py
```

`SHA256SUMS` 校验完整归档文件集合，包括说明、选取清单、原 manifest 和 verifier。哈希证明文件字节的一致性；命令、源文件摘要、运行时、场景及 SQLite/日志用于复核执行记录，不能据此推断未运行的平台或外部服务已经通过。

包含 30 个成功/失败源运行的原 manifest，以及完整回归、依赖/职责/边界分析、bundle 指纹、性能原始采样和故障诊断。前两轮与初始扫描的 319 个冻结文件另行核对，未改写。Docker daemon/硬件虚拟化不可用；Windows/Linux 原生、签名和真实外部 provider/OAuth 没有本机通过证据。
