# План обновления realtime-доски

Документ описывает изменение существующего deployment доски. Realtime использует тот же процесс и порт, что и REST API, поэтому новый сервис, база данных или публичный порт не требуются.

## 1. Новые переменные окружения

| Компонент      | Новая переменная         | Значение для canary    | Где задаётся                                  | Обязательность                                                          |
| -------------- | ------------------------ | ---------------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| `board_server` | `BOARD_SOCKET_PATH`      | `/api/socket.io`       | Runtime ConfigMap/environment контейнера      | Рекомендуется задать явно; это значение также используется по умолчанию |
| ERP-клиент     | `VITE_BOARD_SOCKET_PATH` | `/board-api/socket.io` | Build argument/environment при сборке клиента | Обязательно                                                             |

Новых секретов нет. `BOARD_SOCKET_PATH` является runtime-параметром сервера, а `VITE_BOARD_SOCKET_PATH` встраивается Vite в статический клиент во время сборки. Изменение environment уже собранного ERP-контейнера не заменит клиентский путь — ERP необходимо пересобрать.

Внешний и внутренний пути намеренно различаются:

- браузер подключается к `/board-api/socket.io` на ERP-домене;
- reverse proxy удаляет префикс `/board-api` и передаёт запрос как `/api/socket.io` в `board_server`;
- Socket.IO использует namespace `/board` поверх этого соединения.

Существующие `VITE_BOARD_SERVICE_URL=/board-api` и `ALLOWED_ORIGIN=<точный ERP origin>` менять не требуется. Локальные `BOARD_PROXY_TARGET` и `BOARD_PROXY_REWRITE_TO_API` в canary и production не добавляются.

## 2. Reverse proxy

Маршрут REST API доски должен также поддерживать HTTP Upgrade для Socket.IO:

```nginx
location /board-api/ {
    proxy_pass http://board-server:3000/api/;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

Отдельный ingress и отдельный порт для WebSocket не создаются. Если инфраструктура использует не Nginx, эквивалентный маршрут должен сохранять cookie ERP, поддерживать WebSocket Upgrade и переписывать внешний путь в `/api/socket.io`.

## 3. Порядок поставки в canary

1. Добавить `BOARD_SOCKET_PATH=/api/socket.io` в runtime-конфигурацию `board_server`.
2. Включить WebSocket Upgrade и увеличенные таймауты на существующем маршруте `/board-api/`.
3. Развернуть `board_server` и проверить доступность существующего REST API.
4. Собрать ERP-клиент с `VITE_BOARD_SOCKET_PATH=/board-api/socket.io`.
5. Развернуть клиент и выполнить smoke-test из следующего раздела.

Сервер рекомендуется выкатывать раньше клиента: старый клиент продолжит работать через REST, а новый клиент после поставки сразу получит корректный realtime-маршрут.

## 4. Smoke-test

1. Авторизоваться в canary ERP и открыть одну доску в двух браузерах или под двумя пользователями.
2. В DevTools проверить запрос `/board-api/socket.io`: после HTTP-polling соединение должно перейти на WebSocket со статусом `101 Switching Protocols`.
3. Переместить задачу, изменить её поля и создать подзадачу в первой вкладке.
4. Убедиться, что изменения появляются во второй вкладке без обновления страницы.
5. Кратковременно перезапустить `board_server` и убедиться, что клиент переподключается и сверяет актуальные данные.
6. Проверить консоль и серверные логи: не должно быть циклических `connect_error`, `404` для `socket.io` или отказов авторизации.

## 5. Откат

- При откате только ERP-клиента серверный realtime-маршрут можно оставить: он не мешает REST API.
- При откате `board_server` нужно одновременно вернуть совместимую proxy-конфигурацию, если старая версия использовала другой Socket.IO path.
- Изменения схемы PostgreSQL, Redis и RabbitMQ для этого обновления не требуются.
