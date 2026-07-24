# Projects MCP

Board предоставляет stateless Streamable HTTP endpoint:

```text
POST /mcp/projects
```

Endpoint принимает только ERP Bearer token с audience, равным каноническому
URL ресурса (`https://board.example.ru/mcp/projects`), и одним или несколькими
scopes:

- `projects:read`
- `projects:create`
- `projects:update`
- `projects:members`
- `projects:delete`

## Получение токена

Стандартный клиент получает токен через OAuth 2.1 Authorization Code + PKCE.
ERP публикует authorization-server metadata по адресу:

```text
/.well-known/oauth-authorization-server
```

OAuth-клиент должен быть заранее зарегистрирован в
`MCP_OAUTH_CLIENTS_JSON`. Параметр `resource` в authorization и token
requests должен совпадать с `MCP_PROJECTS_AUDIENCE`.

Для ручной диагностики пользователь с активной ERP-сессией может получить
токен через внутренний session endpoint:

```bash
curl -X POST https://erp.example.ru/api/auth/mcp/projects/session-token \
  --cookie "access_token=<ERP_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "codex",
    "scope": "projects:read projects:create projects:update projects:members"
  }'
```

Полученный `access_token` передаётся MCP-клиентом:

```text
Authorization: Bearer <MCP_ACCESS_TOKEN>
```

OAuth protected-resource metadata опубликованы по адресу:

```text
/.well-known/oauth-protected-resource/mcp/projects
```

## Write-операции

Каждый write-tool требует `idempotencyKey` длиной от 8 до 128 символов.
Повторный вызов с тем же ключом возвращает сохранённый результат и не
создаёт дубликат. Повторное использование ключа с другими параметрами
отклоняется. Операции сохраняются в `mcp_project_operations` вместе с
actor, client, project, action и результатом.

`projects_delete` дополнительно требует `confirm: true` и выполняет soft
delete.

## Конфигурация Board

```dotenv
ERP_API_URL=https://erp.example.ru
MCP_PROJECTS_AUDIENCE=https://board.example.ru/mcp/projects
MCP_PROJECTS_RESOURCE_URL=https://board.example.ru/mcp/projects
# Опционально; по умолчанию ERP_API_URL + /api/auth/check
MCP_PROJECTS_INTROSPECTION_URL=
# Публичный URL ERP; используется в OAuth metadata
MCP_AUTH_ISSUER=https://erp.example.ru
```

## Конфигурация ERP

```dotenv
MCP_PROJECTS_AUDIENCE=https://board.example.ru/mcp/projects
MCP_PROJECTS_TOKEN_TTL=15m
MCP_AUTH_ISSUER=https://erp.example.ru
MCP_OAUTH_CLIENTS_JSON=[{"clientId":"codex","redirectUris":["http://127.0.0.1:1455/callback"]}]
```
