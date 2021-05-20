/* eslint-disable no-undef */
const assert = require('assert');
const supertest = require('supertest');

const proxyquire = require('proxyquire');

const MockedKC = function () {
  return {
    middleware: () => {
      return (req, resp, next) => {
        return next();
      };
    },
    protect: () => {
      return (req, resp, next) => {
        return next();
      };
    }
  };
};

const app = proxyquire('../app', {
  'keycloak-connect': MockedKC
});

describe('Greeting route', () => {
  it('with no query param', async () => {
    const { body } = await supertest(app)
      .get('/api/greeting')
      .expect('Content-Type', /json/)
      .expect(200);

    assert.ok(body.id);
    assert.strictEqual(body.content, 'Hello, World!');
  });

  it('with a query param', async () => {
    const { body } = await supertest(app)
      .get('/api/greeting?name=Luke')
      .expect('Content-Type', /json/)
      .expect(200);

    assert.ok(body.id);
    assert.strictEqual(body.content, 'Hello, Luke');
  });
});
