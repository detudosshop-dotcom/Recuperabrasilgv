// Store em memória para dados das transações (TTL: enquanto o servidor está rodando)
const store = new Map();

module.exports = {
  get:    (key) => store.get(key),
  set:    (key, value) => store.set(key, value),
  delete: (key) => store.delete(key),
};
