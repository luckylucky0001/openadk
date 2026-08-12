# OpenADK 完整体验：CI 日志安全脱敏器

这个案例用于展示 OpenADK 如何把一个看似简单的安全需求，推进为边界清楚、可追踪、可验证的工程交付。

目标是在已有 Node.js 项目中实现一个 `redact-log` CLI。它从标准输入或文件读取 CI 日志，识别明确支持的敏感信息并输出脱敏结果，同时保证不修改源文件、不在错误信息中回显秘密，并能用流式方式处理大日志。

案例会完整经过需求、设计、决策、任务、实现、验证、导出和归档，也可以在 Codex、OpenCode、Claude Code 与 Cursor Agent 之间交接。

## 1. 为什么选择日志脱敏

“把日志里的秘密隐藏掉”听起来只有一句话，但实际包含很多不能由 Agent 自行猜测的问题：

- 哪些内容属于必须识别的秘密；
- 掩码是否保留前缀、长度或可关联信息；
- 普通文本长得像密钥时是否允许误杀；
- 跨 chunk 的秘密如何被流式扫描发现；
- 输入文件是否允许原地覆盖；
- 输出中途失败时能否留下半个文件；
- 错误消息、调试日志和测试快照是否可能二次泄密；
- 如何证明大文件处理没有退化成整文件读入内存。

这些边界能充分展示 OpenADK 的价值：Agent 可以快速实现，但必须先把安全合同、非目标和验证方法写清楚。

## 2. 固定案例边界

为了让体验可复现，本案例采用以下约束：

- Node.js 20 或更高版本；
- CommonJS；
- 零第三方运行时依赖；
- 默认从 stdin 读取并写到 stdout；
- 可通过 `--input` 和 `--output` 使用文件；
- 输入文件永远只读，禁止原地覆盖；
- 文件输出使用同目录临时文件和原子 rename；
- 不访问网络，不执行 Git push，不发布远端内容；
- 不修改已有 `README.md` 和 `package.json`。

第一版只识别以下四类明确格式：

| 类型 | 输入示例 | 脱敏结果 |
| --- | --- | --- |
| Bearer Token | `Authorization: Bearer abc.def.ghi` | `Authorization: Bearer [REDACTED]` |
| API Key | `api_key=sk_live_123456` | `api_key=[REDACTED]` |
| Password | `password: hunter2` | `password: [REDACTED]` |
| Email | `owner=alice@example.com` | `owner=[EMAIL]` |

匹配应忽略字段名大小写，但不扩展到 JWT 解析、信用卡识别、自然语言实体识别或自定义正则插件。

## 3. 一条命令进入已有项目

```bash
cd ci-tools
openadk start
```

首次接入已有项目时，OpenADK 会显示项目绝对路径并要求一次确认：

```text
OpenADK will add local method assets to /path/to/ci-tools. Continue? [y/N] y
```

确认只授权 OpenADK 创建自己的受管目录和 Agent 原生 Skill，不授权修改业务文件或执行远端操作。

接入后先运行只读检查：

```bash
openadk doctor
openadk project status
```

预期项目状态为 `healthy`，并存在四个宿主投影：

```text
.agents/skills/openadk-orchestrator/SKILL.md
.opencode/skills/openadk-orchestrator/SKILL.md
.claude/skills/openadk-orchestrator/SKILL.md
.cursor/skills/openadk-orchestrator/SKILL.md
```

## 4. 从一句模糊描述创建 Draft

在 Agent 中输入：

```text
我要建一个 Spec，为 CI 日志增加安全脱敏 CLI，避免 token 和个人信息进入构建产物。
先澄清需求和安全边界，不要直接实现。
```

Agent 应创建且只创建一个 Spec：

```bash
openadk spec init "add a safe CI log redaction CLI" --id ci-log-redaction
```

项目中会出现：

```text
specs/ci-log-redaction/
├── requirements.md
├── design.md
├── decisions.md
├── tasks.md
├── verification.md
└── spec-state.json
```

此时必须是 `draft`、revision `1`。Agent 应开始提问，而不是凭经验直接选择正则、掩码和文件写入策略。

## 5. 用门禁证明需求还不完整

在回答问题前运行：

```bash
openadk spec check
```

预期得到 `Gate: FAIL`。错误会指出 requirements 章节仍有占位内容、缺少 FR/AC，或 Open Questions 尚未明确收敛。

这一步很重要：OpenADK 的阶段是磁盘上的可验证状态，不是 Agent 在聊天里说“需求已经完成”。

## 6. 回答澄清问题

可以直接向 Agent 提供下面的答案：

```text
第一版只支持 Bearer Token、api_key、password 和 email 四类格式，字段名匹配忽略大小写。
固定掩码，不保留秘密长度，也不生成可关联 hash。stdin/stdout 是默认模式；文件模式必须拒绝
input 和 output 指向同一文件。成功退出码为 0；参数或输入错误为 2；读取或写入失败为 3。
输出文件必须原子替换，失败时删除临时文件并保留原目标文件。错误消息只能包含错误类别和安全路径，
不能包含原始日志片段或匹配到的秘密。需要处理跨流 chunk 的匹配；处理 10 MiB 日志时，
相对处理前基线的额外 RSS 不得超过 64 MiB。
非 UTF-8 输入返回 INVALID_ENCODING。本次不支持自定义规则、压缩日志、目录递归、网络输入和原地改写。
```

Agent 应将答案整理到 `requirements.md`，至少形成以下追踪关系：

| ID | 要求 |
| --- | --- |
| `FR-001` | 解析 stdin/stdout 与 input/output 参数，并拒绝原地覆盖 |
| `FR-002` | 脱敏四类批准格式，字段名匹配忽略大小写 |
| `FR-003` | 使用固定掩码且不回显秘密长度或内容 |
| `FR-004` | 使用流式处理并识别跨 chunk 的匹配 |
| `FR-005` | 文件输出通过临时文件和原子 rename 提交 |
| `FR-006` | 按错误类别返回稳定退出码和安全错误消息 |
| `AC-001` | 四类批准格式的黄金样例全部得到预期掩码 |
| `AC-002` | 相似但不符合格式的普通文本保持不变 |
| `AC-003` | 秘密跨输入 chunk 时仍能被完整脱敏 |
| `AC-004` | 10 MiB 输入的峰值额外 RSS 不超过 64 MiB |
| `AC-005` | input 与 output 相同或指向同一文件时在读取前拒绝 |
| `AC-006` | 写入失败不改变已有目标文件且不遗留临时文件 |
| `AC-007` | stderr、异常和测试输出中不出现任何测试秘密 |
| `AC-008` | 非 UTF-8 输入和参数错误返回约定退出码 |

Open Questions 收敛后必须明确写 `None`。然后运行：

```bash
openadk spec check
openadk spec advance
```

预期进入 `specified`、revision `2`。

## 7. 设计流式安全边界

让 Agent 根据已确认需求完成 `design.md` 和 `decisions.md`。推荐架构如下：

- CLI 层只负责参数、流和退出码；
- redactor 层接受 byte chunks，维护有限长度的尾部缓冲；
- 只有确认不会属于下一段匹配前缀的内容才可以输出；
- 解码器使用 fatal UTF-8 模式，禁止静默替换无效字节；
- 文件输出先写入同目录、权限受限的临时文件；
- 完成 flush、sync 和 close 后再原子 rename；
- 失败路径关闭句柄并清理临时文件；
- 错误对象只携带错误码和经过约束的路径，不携带输入片段。

需要显式记录的决策：

```text
D-001: 使用有限尾部缓冲处理跨 chunk 匹配，而不是整文件加载
D-002: 使用固定不可关联掩码，而不是保留长度或计算 hash
D-003: 文件输出采用同目录临时文件加原子 rename
D-004: 第一版采用批准格式白名单，不开放用户正则
```

每个决策都必须有 resolved Status、Context、Decision 和 Consequences。检查通过后推进：

```bash
openadk spec check
openadk spec advance
```

预期进入 `planned`、revision `3`。

## 8. 建立 FR/AC 到任务的映射

`tasks.md` 可以拆成：

```text
T-001: 实现参数校验、路径同一性检查和退出码合同（FR-001，FR-006，AC-005，AC-008）
T-002: 实现四类白名单规则和固定掩码（FR-002，FR-003，AC-001，AC-002）
T-003: 实现 UTF-8 流式扫描和跨 chunk 尾部缓冲（FR-004，AC-003，AC-004，AC-008）
T-004: 实现原子文件输出、权限和失败清理（FR-005，AC-006）
T-005: 实现错误信息泄漏审计和完整测试集（FR-006，AC-001..008）
```

每个 FR 和 AC 至少由一个任务引用。随后依次进入实现阶段：

```bash
openadk spec check
openadk spec advance  # planned -> tasked
openadk spec check
openadk spec advance  # tasked -> implementing
```

此时应为 `implementing`、revision `5`。源码修改只能在需求、设计和任务边界明确之后开始。

## 9. 实现阶段测试矩阵

建议使用 Node 内置测试运行器，至少覆盖：

1. Bearer Token 得到固定掩码；
2. `api_key` 得到固定掩码；
3. password 得到固定掩码；
4. email 得到 `[EMAIL]`；
5. 字段名大小写不影响识别；
6. 一行多个秘密全部脱敏；
7. 普通 `passwordless` 文本不被误杀；
8. 不完整 Bearer 文本保持不变；
9. 每一种秘密分别跨 chunk 边界；
10. 输入末尾的秘密在 flush 时仍被脱敏；
11. stdin/stdout 模式不创建文件；
12. 文件输入不会被修改；
13. 相同 input/output 路径被拒绝；
14. hard link 指向同一 inode 时也被拒绝；
15. 成功文件输出通过 rename 一次提交；
16. 注入写入失败后原目标内容不变；
17. 失败后临时文件被清理；
18. 非 UTF-8 输入返回退出码 2；
19. 读取或写入错误返回退出码 3；
20. stderr 不包含 fixture 中的秘密；
21. 10 MiB 日志测试通过且峰值额外 RSS 不超过 64 MiB；
22. 源日志、README 和 package.json 的哈希保持不变。

先保护案例明确禁止修改的项目文件：

```bash
openadk project protect README.md package.json CASE.md
```

通过 OpenADK 运行真实测试并签发结构化 receipt：

```bash
openadk verify run --kind test --covers AC-001,AC-002,AC-003,AC-004,AC-005,AC-006,AC-007,AC-008 -- npm test
openadk verify run --kind adversarial --covers AC-003,AC-004,AC-007 -- node --test test/adversarial-boundaries.test.js
```

对抗测试必须迫使流处理器先开始输出，再让每类秘密跨越真实 emission boundary；同时扫描完整大输出、stdout、stderr、快照和临时目录，不能用“小输入全部留到 flush”冒充跨 chunk 验证，也不能只检查函数返回值。

## 10. 建立验证证据

实现和测试完成后勾选所有 `T-###`，并在 `verification.md` 中把证据链接回 AC：

```text
V-001: 四类黄金样例与大小写组合全部得到固定掩码（AC-001）
V-002: 负向样例保持逐字节一致，没有扩大匹配范围（AC-002）
V-003: 每类秘密在所有 chunk 切分点下均被完整脱敏（AC-003）
V-004: 10 MiB 测试记录了输入大小和峰值额外内存（AC-004）
V-005: 路径与 inode 同一性测试都在打开输出前被拒绝（AC-005）
V-006: 故障注入证明原目标未变且临时文件为零（AC-006）
V-007: 对 stdout、stderr、错误对象和临时目录的审计未发现测试秘密（AC-007）
V-008: 非 UTF-8、参数、读取和写入错误返回约定退出码（AC-008）
```

Commands 必须记录 OpenADK receipt ID 和真实执行结果，例如：

```text
VR-... (test): npm test, tests 22, pass 22, fail 0
VR-... (adversarial): emission-boundary leakage audit passed
```

然后完成交付状态：

```bash
openadk spec check
openadk spec advance  # implementing -> verified
openadk spec export
openadk spec check
openadk spec advance  # verified -> archived
openadk spec status
```

最终预期：

```text
Spec: ci-log-redaction
Phase: archived
Revision: 7
Next: none
```

`export.md` 应记录 verified revision `6` 的产物哈希；归档事件将状态推进到 revision `7`。归档后的 Spec 不可继续修改。

## 11. 可选的四宿主交接

单个 Agent 可以跑完整流程。为了证明工作状态不依赖某一段聊天记录，可以做一次跨宿主交接：

```bash
# Codex：创建 Spec 并完成需求澄清
openadk config --agent codex
openadk start

# Claude Code：审查安全边界并完成设计决策
openadk config --agent claude
openadk start

# Cursor Agent：按照 tasks.md 实现和补测试
openadk config --agent cursor
openadk start

# OpenCode：独立检查泄漏证据、导出并归档
openadk config --agent opencode
openadk start
```

每次切换后，对新 Agent 输入：

```text
读取当前 OpenADK Spec、artifact 和 gate。只完成当前阶段要求，不依赖之前的聊天记录，不跳阶段。
```

正确结果是每个 Agent 从相同的 `specs/current.json`、Spec 产物和 Orchestrator Skill 恢复上下文。

## 12. OpenADK 自身的安全检查

案例完成后还应检查工作流本身：

- 已有项目首次接入只确认一次；
- 客户文件占用受管 Skill 路径时停止，不覆盖文件；
- projection 路径包含 symlink 时 fail closed；
- 可信 dead-owner 锁可以通过公开流程回收；
- Spec 只允许相邻阶段推进；
- 缺少 FR、AC、任务或验证证据时不能进入下一阶段；
- 缺少成功的 test/adversarial receipt 或 AC receipt 覆盖时不能进入 verified；
- receipt 在 verified 后被修改时不能归档；
- protected-files 基线发生漂移时项目和 Spec 门禁都 fail closed；
- export 被修改或落后于 verified revision 时不能归档；
- `start` 不隐式升级项目 pin；
- 整个流程没有 Git、网络、同步或发布副作用。

只读核验命令：

```bash
openadk doctor --json
openadk project status
find . -type l -o -name '*.lock' -o -iname '*journal*'
```

## 13. 完成标准

只有同时满足以下条件，才算跑通 OpenADK：

- 模糊需求先成为 revision `1` 的 draft；
- 不完整 requirements 被门禁真实拒绝；
- Spec 只经过相邻阶段并达到 archived revision `7`；
- FR/AC/D/T/V 唯一且追踪闭环；
- 正向、负向、跨 chunk、原子写入和泄漏审计都有自动化证据；
- 常规测试和独立对抗命令都由 OpenADK 签发成功 receipt；
- 22 项测试真实通过，verification 与命令输出一致；
- export 对应 verified revision `6`；
- 项目状态保持 `healthy`；
- 输入日志和已有项目文件哈希不变；
- 没有临时文件、锁或事务日志残留；
- 没有远端 Git 或网络副作用；
- 更换 Agent 后可以仅凭项目资产继续工作。

这个案例展示的不是“Agent 会写一个正则工具”，而是 OpenADK 如何让安全边界、设计取舍、实现任务和泄漏证据在同一条可审计状态链中收敛。
