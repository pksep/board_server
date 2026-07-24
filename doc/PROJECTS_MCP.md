# Projects MCP

Board предоставляет stateless Streamable HTTP endpoint:

```text
POST /mcp/projects
```

Endpoint принимает только ERP Bearer token с audience
`board-projects-mcp` и одним или несколькими scopes:

- `projects:read`
- `projects:create`
- `projects:update`
- `projects:members`
- `projects:delete`

## Получение токена

Пользователь должен иметь активную ERP-сессию. Токен выдаётся ERP и
отзывается при завершении этой сессии:

```bash
curl -X POST https://erp.example.ru/api/auth/mcp/projects/token \
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
MCP_PROJECTS_AUDIENCE=board-projects-mcp
MCP_PROJECTS_RESOURCE_URL=https://board.example.ru/mcp/projects
# Опционально; по умолчанию ERP_API_URL + /api/auth/check
MCP_PROJECTS_INTROSPECTION_URL=
```

## Конфигурация ERP

```dotenv
MCP_PROJECTS_AUDIENCE=board-projects-mcp
MCP_PROJECTS_TOKEN_TTL=15m
MCP_AUTH_ISSUER=https://erp.example.ru
```
