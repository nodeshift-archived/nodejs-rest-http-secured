'use strict';

const test = require('ava');
const OpenshiftTestAssistant = require('openshift-test-assistant');
const testAssistant = new OpenshiftTestAssistant();
const request = require('supertest');
const config = require('./config.js');

const deploymentConfigName = 'nodejs-rest-http-secured';
const SsoUrlVarName = 'SSO_AUTH_SERVER_URL';

// leave this line, so supertest request will accept self signed certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// URL to the SSO Authentication service
let SsoAuthServerDomain;

/**
 * Deploy secure http service and set route to the SSO service via HTTPS
 * presumes that SSO service is already deployed
 */
test.before('setup', async (t) => {
  const restClient = await testAssistant.getRestClient();

  // Check that route to the SSO service exists
  const routes = await restClient.routes.findAll();
  const ssoRoute = routes.items.find(val => val.metadata.name === 'secure-sso');
  if (ssoRoute === undefined) {
    t.fail(new Error('Route to SSO service not found'));
  }
  // get URL to the SSO service
  SsoAuthServerDomain = 'https://' + ssoRoute.spec.host;
  const url = SsoAuthServerDomain + '/auth';

  // deploy the secured booster
  await testAssistant.deploy();

  // **** Change environmental variable SSO_AUTH_SERVER_URL in the secured booster to point to the SSO service

  // changing deployment config forces service to redeploy,
  // undeploing the service manually helps to wait for it, to become ready again
  await testAssistant.scale(0);
  // get deployment config of the service
  const securedBoosterConfig = await testAssistant.getDeploymentConfig();
  // change environment variable which points to the SSO server
  securedBoosterConfig.spec.template.spec.containers[0].env.find(val => val.name === SsoUrlVarName).value = url;
  // apply updated config
  await restClient.deploymentconfigs.update(deploymentConfigName, securedBoosterConfig);

  // turn service on and wait for it to be ready
  await testAssistant.scale(1);
});

/**
 * Test access to the application without authentication
 */
test('unauthenticated', async (t) => {
  t.plan(1);
  const response = await testAssistant.createRequest()
    .get('/api/greeting');
  t.is(response.status, 403, 'Unauthorized request should fail');
});

/**
 * Test access to the application with authentication
 */
test('authenticated', async (t) => {
  t.plan(1);
  // authenticate to the SSO service
  let response = await request(SsoAuthServerDomain)
    .post('/auth/realms/' + config.realm + '/protocol/openid-connect/token')
    .set('Content-Type', 'application/x-www-form-urlencoded')
    .send({
      grant_type: config.grant_type,
      username: config.username,
      password: config.password,
      client_id: config.client_id,
      client_secret: config.client_secret
    })
    .expect('Content-Type', /json/)
    .expect(200);

  // get access token from the server response
  const accessToken = response.body.access_token;

  // send request to greeting service
  response = await testAssistant.createRequest()
    .get('/api/greeting')
    .set('Authorization', 'Bearer ' + accessToken)
    .expect(200)
    .expect('Content-Type', /json/);
  t.is(response.body.content, 'Hello, World', 'Authorized request should work');
});

test.after.always('teardown', () => {
  return testAssistant.undeploy();
});
