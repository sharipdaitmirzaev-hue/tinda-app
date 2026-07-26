# Деплой ТИНДА (Э1) на VPS

Целевой стек: Ubuntu 22.04/24.04, Docker, Nginx, PostgreSQL, Let's Encrypt.

## 1. Подготовка VPS

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git ufw
```

## 2. Установка Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
# перелогиньтесь
docker --version
docker compose version
```

## 3. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 4. Пользователь приложения

```bash
sudo adduser --disabled-password --gecos "" tinda
sudo usermod -aG docker tinda
sudo mkdir -p /opt/tinda && sudo chown tinda:tinda /opt/tinda
```

## 5. Клонирование

```bash
sudo -u tinda -i
cd /opt/tinda
git clone <URL_РЕПОЗИТОРИЯ> app
cd app
```

## 6. `.env.production` / compose env

Создайте файл `.env` рядом с `docker-compose.production.yml`:

```env
POSTGRES_PASSWORD=замените_длинным_паролем
SESSION_SECRET=замените_случайной_строкой_не_короче_32_символов
APP_URL=https://app.example.com
STORAGE_DRIVER=local
RUN_MIGRATIONS_ON_START=true
```

Для S3 добавьте `STORAGE_*` из `.env.example`.

## 7–9. PostgreSQL, миграции, приложение

```bash
docker compose -f docker-compose.production.yml up -d --build
docker compose -f docker-compose.production.yml ps
curl -sS http://127.0.0.1:3000/api/v1/health
```

Ожидаемый ответ: `{"ok":true,"database":"ok"}`.

Seed (только осознанно, один раз):

```bash
docker compose -f docker-compose.production.yml exec \
  -e ALLOW_PROD_SEED=true \
  -e SEED_PASSWORD='СложныйПарольНеМеньше12' \
  app npm run db:seed
```

## 10. Nginx

Скопируйте `deploy/nginx/tinda.conf.example` в `/etc/nginx/sites-available/tinda`, замените домен, включите сайт.

## 11. SSL (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d app.example.com
```

## 12. Health

```bash
curl -sS https://app.example.com/api/v1/health
```

## 13–14. Первый director и смена пароля

После seed войдите как `director@tinda.local` с `SEED_PASSWORD` и сразу смените пароль (в Э1 смена через UI может отсутствовать — меняйте hash через контролируемый скрипт/БД или пересоздайте seed-пароль до публичного доступа).

## 15. Backup

Ежедневно:

```bash
docker compose -f docker-compose.production.yml exec -T db \
  pg_dump -U tinda -d tinda -Fc > "/var/backups/tinda/tinda-$(date +%F).dump"
```

Храните 7–30 дней. Проверяйте восстановление:

```bash
pg_restore -U tinda -d tinda_restore --clean --if-exists tinda-YYYY-MM-DD.dump
```

При `STORAGE_DRIVER=local` резервируйте volume `tinda_uploads`. Для S3 включите versioning на bucket.

## 16. Обновление без потери данных

```bash
cd /opt/tinda/app
git pull
docker compose -f docker-compose.production.yml up -d --build
# миграции применяются entrypoint при RUN_MIGRATIONS_ON_START=true
curl -sS https://app.example.com/api/v1/health
```

## Production checklist

- [ ] `SESSION_SECRET` ≥ 32, не default
- [ ] `APP_URL` = публичный HTTPS URL
- [ ] Сильный `POSTGRES_PASSWORD`
- [ ] Seed-пароли сменены / seed не оставлен с `ChangeMe123!`
- [ ] Firewall только 22/80/443
- [ ] HTTPS работает
- [ ] Health `ok` + `database: ok`
- [ ] Backup PostgreSQL настроен и проверен restore
- [ ] Uploads volume или S3
- [ ] Логи без секретов
