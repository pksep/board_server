<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo_text.svg" width="320" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

</p>

## Description

`board-server` is a NestJS service for board management: projects, boards, columns, tasks, subtasks, users, websocket events, and ERP synchronization.

## Installation

```bash
$ bun install
$ cp .env.docker.example .env
$ docker compose --env-file .env -f docker-compose.yml up -d
```

Вместо docker можно использовать и другие менеджеры контейнеров, такие как [podman](https://podman.io) или [nerdctl](https://github.com/containerd/nerdctl)

При инициализации (Если база данных абсолютли пустая), необходимо выполнить сидирования в строгом порядке.
Семена и описание определны в файле app-init.service.ts.
Важно, должен быть установлен модуль sequelize глобально.

```bash
$ bun run init
```

## Running the app

```bash
# development
$ bun run start

# watch mode
$ bun run start:dev

# production mode
$ bun run start:prod
```

## Postman

You can use the button to start a collection based on the SEP ERP server APIs

[<img src="https://run.pstmn.io/button.svg" alt="Run In Postman" style="width: 128px; height: 32px;">](https://app.getpostman.com/run-collection/31775278-1bc760a8-584c-4c65-90d9-4539722ddc5f?action=collection%2Ffork&source=rip_markdown&collection-url=entityId%3D31775278-1bc760a8-584c-4c65-90d9-4539722ddc5f%26entityType%3Dcollection%26workspaceId%3D3c3fd690-ce25-4668-8282-b7973fa7d803)

## Описание

```bash
# Для генерации документации проекта
$ bun run docs
```

## Code Style

1. Controller

- Контроллер должен иметь название соответствующее функции к которой он обращается в Сервисе.
  Предварительно необходимо установить:
  Postgres - последнюю версию
  NodeJS - 20 версия

## Code Style Git

Правило работы с задачами:
Новая задача в youtrack = новая ветка в репрозитории
ветка должна называться по номеру задачи.

Правило написания коммита: #НазваниеПроекта-НомерЗадачи здесь описываем что мы делали в коде, понятным языком
Например:

```
#SEP-1123 Оптимизировал SQL запрос на 100ms
```

Коммит должен относиться к конкретной задаче и выполнять конкретное действие необходимое для выполнения задачи.
Язык написания коммита желательно использовать Английский, но можно Русский

## Testing

Для запуска юнит тестов:

```
bun run test:unit
```

Для запуска тестов контроллеров:

```
bun run test:e2e
```

Для запуска всех тестов:

```
bun run test
```

## Migrations

Для запуска миграций

```
bun run migrate:up
bun run migrate:down
bun run migrate:status
```

Также есть возможность указать конкретную миграцию:

```
pnpm run migrate:up -- --name=***
```

Миграции должны храниться в папке с текущей датой их создания, путь до миграции должен выглядеть так: 
```
migrations/YYYY/DD.MM.YYYY/HASH-CustomNameMigration.js
```

день в названии папки - крайний перед сдачей задачи. 
Сгенерировать миграцию к определенной папке можно так, если у sequelize установлен глобально: 
```
sequelize migration:generate --name delete-old-field-detal-mass-zag --migrations-path ./migrations/2024/25.03.2024/
```

Если локально в проекте:

```
bunx sequelize-cli migration:generate --name delete-old-field-detal-mass-zag --migrations-path ./migrations/2024/2
```
