BRANCH ?= main
COMMAND ?= undefined
PROFILE ?= local-db

.PHONY: git deploy down clean command network start-all server initialization down-test deploy-test minio-up minio-network minio-down

ci:
	make git
	@echo "Starting install process..."
	bun install
	@echo "Starting build process..."
	bun run build:lib
	@echo "Starting nest build process..."
	nest build
	@echo "Starting migration process..."
	bun run migrate:up
	@echo "Starting restart process..."
	pm2 restart instance1
	@echo "CI completed successfully"

deploy:
	@echo "Starting deployment process..."
	@make down
	@make clean
	@make network
	@make git
	@make initialization
	@make server
	@if [ "$(PROFILE)" = "local-db" ]; then \
		bun run migrate:up; \
	else \
		docker exec -it sep-erp_app_instance1_1 bun run migrate:up; \
	fi
	@echo "Deployment completed successfully"

deploy-test:
	@echo "Starting deployment process..."
	@make down-test
	@make clean
	@make network
	@make git
	@make initialization
	@make server-test
		docker exec -it sep-erp-test_app_test_1 bun run migrate:up;
	@echo "Deployment completed successfully"

initialization:
	@echo "Install process started"; \
    bun install && bun run actual:dist;

start-all:
	@echo "Starting deployment process..."
	@make down
	@make clean
	@make network
	@make git
	@make initialization
	@make minio-up
	@make server
	@if [ "$(PROFILE)" = "local-db" ]; then \
		bun run migrate:up; \
	else \
		docker exec -it sep-erp_app_instance1_1 bun run migrate:up; \
	fi
	@echo "Deployment completed successfully"

server:
	@echo "Building and starting server container..."
	docker-compose -f docker-compose.prod.yml -p sep-erp \
		--profile $(PROFILE) --env-file env/.production.env up -d --force-recreate --build

server-test:
	@echo "Building and starting server container..."
	docker-compose -f docker-compose.test.yml -p sep-erp-test \
		 --env-file env/test/.production.env up -d --force-recreate --build

down:
	@echo "Stopping and removing existing containers..."
	docker-compose -f docker-compose.prod.yml -p sep-erp --env-file env/.production.env down --volumes

down-test:
	@echo "Stopping and removing existing containers..."
	docker-compose -f docker-compose.test.yml -p sep-erp-test --env-file env/test/.production.env down --volumes

clean:
	@echo "Cleaning up unused containers, networks, and images..."
	docker system prune -f --all --volumes
	@echo "Cleanup completed"

network:
	@if ! docker network inspect custom_network >/dev/null 2>&1; then \
		echo "Creating network 'custom_network'..."; \
		docker network create \
			--driver bridge \
			--subnet=172.30.0.0/16 \
			--gateway=172.30.0.1 \
			custom_network; \
	else \
		echo "Network 'custom_network' already exists"; \
	fi

minio-up:
	@echo "Starting MinIO containers..."
	@make minio-network
	@make minio-down
	@make clean
	docker-compose -f docker-compose.minio.yml -p sep-erp-minio \
		 --env-file env/.minio.env up -d --force-recreate

minio-down:
	@echo "Stopping and removing MinIO containers..."
	docker-compose -f docker-compose.minio.yml -p sep-erp-minio --env-file env/.minio.env down --volumes

minio-network:
	@if ! docker network inspect minio-network >/dev/null 2>&1; then \
		echo "Creating network 'minio-network'..."; \
		docker network create \
			minio-network; \
	else \
		echo "Network 'minio-network' already exists"; \
	fi

git:
	@if git ls-remote --exit-code --heads origin $(BRANCH); then \
		echo "Branch $(BRANCH) exists, proceeding..."; \
		git fetch origin $(BRANCH); \
		git checkout $(BRANCH); \
		git reset --hard origin/$(BRANCH); \
	else \
		echo "Branch $(BRANCH) does not exist, defaulting to 'main'"; \
		git fetch origin main; \
		git checkout main; \
		git reset --hard origin/main; \
	fi



command:
	@if [ "$(COMMAND)" = "undefined" ]; then \
		echo "Error: COMMAND is not specified. Usage: make command COMMAND='your_command'"; \
		exit 1; \
	fi
	@if [ "$(PROFILE)" = "local-db" ]; then \
		docker exec -it sep-erp_app_instance1_local_db_1 $(COMMAND); \
	else \
		docker exec -it sep-erp_app_instance1_1 $(COMMAND); \
	fi

help:
	@echo ""
	@echo "📘 Добро пожаловать в Makefile справку проекта sep_erp_server!"
	@echo "-------------------------------------------------------------"
	@echo ""
	@echo "⚙️  ДОСТУПНЫЕ ПЕРЕМЕННЫЕ:"
	@echo "BRANCH=...           — указывает ветку Git (по умолчанию: main)"
	@echo "PROFILE=local-db/app — режим запуска (по умолчанию: local-db)"
	@echo "COMMAND='...'        — команда, которую нужно выполнить в контейнере"
	@echo ""
	@echo "🚀 ОСНОВНЫЕ КОМАНДЫ:"
	@echo "make deploy [BRANCH=n] [PROFILE=...]   — Полный деплой сервера"
	@echo "make start-all [BRANCH=n]             — Полный цикл: очистка, обновление, запуск всех сервисов"
	@echo "make server                           — Запуск сервера с текущим профилем ($(PROFILE))"
	@echo "make server-test                      — Запуск тестовой версии сервера"
	@echo "make down                             — Остановка и удаление основных контейнеров"
	@echo "make down-test                        — Остановка и удаление тестовой среды"
	@echo "make network                          — Создание сетей для взаимодействия контейнеров"
	@echo "make clean                            — Чистка неиспользуемых данных Docker"
	@echo "make git                              — Обновление кода из указанной ветки ($(BRANCH))"
	@echo "make initialization                   — Установка зависимостей и сборка"
	@echo "make command COMMAND='...'            — Выполнить команду в контейнере"
	@echo ""
	@echo "📂 РАБОТА С БАЗОЙ ДАННЫХ:"
	@echo "- Чтобы использовать дамп базы данных при запуске Docker-БД,"
	@echo "  положите файл .sql в директорию ./dump."
	@echo "- Чтобы обновить дамп: остановите контейнер, удалите старые данные,"
	@echo "  замените дамп и перезапустите контейнер."
	@echo ""
	@echo "🐧 ВНИМАНИЕ: Linux / PostgreSQL:"
	@echo "- Для подключения контейнеров к локальной БД требуется настройка pg_hba.conf"
	@echo "- Разрешите подключение с IP-сети Docker, например:"
	@echo "    host    all    all    172.16.0.0/12    md5"
	@echo "- Также разрешите внешние подключения в postgresql.conf:"
	@echo "    listen_addresses = '*'"
	@echo "- Перезапустите PostgreSQL после изменений:"
	@echo "    sudo systemctl restart postgresql"
	@echo ""
	@echo "📌 ПРИМЕР ИСПОЛЬЗОВАНИЯ:"
	@echo "make deploy BRANCH=dev PROFILE=app"
	@echo "make command COMMAND='npm run seed'"
	@echo "make start-all BRANCH=canary"
	@echo ""