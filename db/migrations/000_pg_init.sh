#!/bin/bash
# SPEC: db/migrations/000_pg_init.sh
# Responsabilidade : Criar o database da aplicacao e a extensao pgcrypto no primeiro boot.
# Consumido por    : entrypoint do container postgres
# Regra            : Executa apenas com o volume de dados vazio.
#
# PG-03 (falha semeada): cria a extensao no database "postgres" e nao no database
# da aplicacao; alem disso o nome do database aqui diverge do POSTGRES_DB do compose.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-SQL
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
