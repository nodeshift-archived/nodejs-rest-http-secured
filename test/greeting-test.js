const test = require('ava');
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

test('test out greeting route with no query param', (t) => {
  supertest(app)
    .get('/api/greeting')
    .expect('Content-Type', /json/)
    .expect(200)
    .then(response => {
      t.equal(response.body.content, 'Hello, World');
      t.end();
    }).catch((err) => {
      console.log(err);
      t.end();
    });
});

test('test out greeting route with a query param', (t) => {
  supertest(app)
    .get('/api/greeting?name=Luke')
    .expect('Content-Type', /json/)
    .expect(200)
    .then(response => {
      t.equal(response.body.content, 'Hello, Luke');
      t.end();
    });
});
