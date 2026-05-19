'use strict';

const request = require('supertest');

async function getToken(app, username, password) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username, password });
  if (res.status !== 200) {
    throw new Error(`Auth failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.token;
}

module.exports = { getToken };
