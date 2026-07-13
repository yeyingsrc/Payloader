# 自定义内容归属与迁移设计

## 目标

后台“自定义 Payload”页面允许管理员将一条自定义文本保存到 `Payload` 或“工具命令”，并在编辑时切换归属。保存后的内容必须成为目标模块中的正式记录，可继续通过对应后台模块编辑，也必须在前台对应标签页的“自定义文本”分组中正常打开。

## 范围

- 自定义内容表单新增必选归属：`payloads` 或 `tools`。
- 已添加内容列表同时展示两类记录，并显示明确的归属标签。
- 编辑时加载原归属；切换归属后由服务端原子迁移。
- 删除使用自定义内容专用接口，并以归属定位记录。
- 前台 Payload 与工具命令导航分别只展示本模块的自定义内容。
- 保留现有 Payload、工具命令、导入导出与公开数据结构，不新增数据库表。

## 数据映射

自定义 Payload 继续保存到 `payloads` 表：

- `name`: 表单标题
- `category`: `{ zh: "自定义", en: "Custom" }`
- `description`: 基于标题生成的简短说明
- `tags`: `["custom"]`
- `execution[0].command`: 表单内容
- `execution[0].platform`: `all`

自定义工具命令保存到 `tools` 表：

- `name`: 表单标题
- `category`: `{ zh: "自定义", en: "Custom" }`
- `description`: 基于标题生成的简短说明
- `commands[0].command`: 表单内容
- `commands[0].platform`: `all`

API 返回统一视图：`{ id, title, content, destination }`。`destination` 只允许 `payloads` 或 `tools`。

## 服务端接口

新增窄接口 `/api/admin/custom-content`，沿用现有 Bearer JWT 管理员鉴权：

- `GET /api/admin/custom-content`: 返回两个数据表中的自定义记录。
- `POST /api/admin/custom-content`: 新建记录，服务端生成唯一 ID。
- `PUT /api/admin/custom-content/:id`: 更新记录；请求同时携带原归属和目标归属。
- `DELETE /api/admin/custom-content/:id?destination=...`: 删除指定归属中的记录。

写入和迁移复用现有 sanitizer、占位内容检查及数据库写队列。归属发生变化时，在一个 SQLite 事务内完成目标表写入和来源表删除。事务任一步失败都回滚，不能出现双份记录或内容丢失。

现有只读 `/api/admin/custom-payloads` 保留，避免破坏已有调用与测试；新页面改用统一接口。

## 后台交互

表单标题调整为“新增自定义内容”，在标题和内容字段之前加入“添加到”分段选择：

- `Payload`
- `工具命令`

默认选择 `Payload`。进入编辑时恢复该记录的归属；取消编辑时清空字段并恢复默认选择。保存期间禁用提交，防止重复请求。迁移成功后刷新统一列表并退出编辑状态。

列表卡片显示标题、内容摘要和归属标签。编辑、删除都使用记录的 `id` 与 `destination`，不依赖 DOM 中的大段内容属性；记录数据保存在页面内存映射中，避免长 Markdown 写入 HTML 属性。

错误信息保持简短：缺少标题或内容、归属无效、记录不存在、保存失败。鉴权失效继续清除 `sessionStorage` 中的令牌并跳转登录页。

## 前台展示

`Sidebar` 按当前标签页构造自定义导航：

- Payload 标签页从 `allPayloads` 中筛选“自定义”分类，并生成 `payloadId` 节点。
- 工具命令标签页从 `allToolCommands` 中筛选“自定义”分类，并生成 `toolId` 节点。

搜索结果继续使用各模块已有的 ID 集合。自定义分组不跨标签页复用数据，避免在工具页点击后错误打开 Payload。

## 兼容与边界

- 既有 `custom-*` Payload 仍可被统一列表识别和编辑。
- 工具记录通过“自定义”分类或约定的自定义 ID 前缀识别。
- 若不同表中意外存在同 ID 记录，接口以 `destination` 精确定位；迁移前检查目标冲突，不能静默覆盖非当前记录。
- 不修改默认种子数据，也不要求数据库迁移。
- 不改变普通 Payload 和普通工具命令的管理接口。

## 验收与验证

自动化测试覆盖：

1. 统一列表能返回两类自定义内容并规范化字段。
2. 新建 Payload 与工具命令后分别进入正确数据表。
3. Payload 到工具命令、工具命令到 Payload 的迁移是原子的。
4. 删除只影响指定归属。
5. 无效归属、空标题、空内容与未授权请求被拒绝。
6. 前台 Sidebar 为两类内容生成正确的 `payloadId` 或 `toolId`。

运行项目现有完整检查，并在真实浏览器中完成新建、编辑迁移、删除以及两个前台标签页的显示验证；同时检查控制台和相关网络请求没有错误。
