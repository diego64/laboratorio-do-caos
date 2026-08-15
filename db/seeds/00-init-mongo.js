// SPEC: db/seeds/00-init-mongo.js
// Responsabilidade : Criar o usuario de aplicacao e a colecao readings no MongoDB.
// Consumido por    : entrypoint do container mongo (docker-entrypoint-initdb.d)
// Regra            : Idempotente. Roda uma unica vez, no primeiro boot com volume vazio.
//
// MGO-04 (falha semeada): o usuario e criado no banco "chaoslab", mas a aplicacao
// autentica sem authSource, o que faz o driver procurar as credenciais em "admin".
db = db.getSiblingDB('chaoslab');

db.createUser({
  user: 'chaos',
  pwd: 'chaos',
  roles: [{ role: 'readWrite', db: 'chaoslab' }],
});

db.createCollection('readings');
