// SPEC: db/seeds/00-init-mongo.js
// Responsabilidade : Criar o usuario de aplicacao e a colecao readings no MongoDB.
// Consumido por    : entrypoint do container mongo (docker-entrypoint-initdb.d)
// Regra            : Idempotente. Roda uma unica vez, no primeiro boot com volume vazio.
//
// O usuario vive em "chaoslab", entao a aplicacao precisa conectar com
// authSource=chaoslab. Manter o usuario aqui (e nao em "admin") preserva o
// menor privilegio: ele so tem readWrite no proprio banco.
const banco = process.env.MONGO_INITDB_DATABASE;
const usuario = process.env.MONGO_APP_USERNAME;
const senha = process.env.MONGO_APP_PASSWORD;

if (!banco || !usuario || !senha) {
  throw new Error('MONGO_INITDB_DATABASE, MONGO_APP_USERNAME e MONGO_APP_PASSWORD sao obrigatorias');
}

db = db.getSiblingDB(banco);

db.createUser({
  user: usuario,
  pwd: senha,
  roles: [{ role: 'readWrite', db: banco }],
});

db.createCollection('readings');
