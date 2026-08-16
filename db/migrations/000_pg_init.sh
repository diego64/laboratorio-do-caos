#!/bin/bash
# SPEC: db/migrations/000_pg_init.sh
# Responsabilidade : Criar o database da aplicacao e a extensao pgcrypto no primeiro boot.
# Consumido por    : entrypoint do container postgres
# Regra            : Executa apenas com o volume de dados vazio.
#
# O database da aplicacao ja e criado pelo entrypoint a partir de POSTGRES_DB;
# aqui basta garantir a extensao dentro dele, e nao no database "postgres".
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
