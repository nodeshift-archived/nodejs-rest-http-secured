'use strict';

/*
 *
 *  Copyright 2016-2017 Red Hat, Inc, and individual contributors.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 *
 */

const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const Keycloak = require('keycloak-connect');
// Load the Web UI's keycloak.json config file
// Doing it like this since we need to update the SSO_AUTH_URL on the fly
// normally this would just be in the public directory and be served like any other file
const kcJSON = require('./kc.json');

const kc = new Keycloak({});

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
// Expose the license.html at http[s]://[host]:[port]/licences/licenses.html
app.use('/licenses', express.static(path.join(__dirname, 'licenses')));

app.use(kc.middleware());

kcJSON['auth-server-url'] = process.env.SSO_AUTH_SERVER_URL;
app.use('/kc.json', (request, response) => {
  return response.send(kcJSON);
});

let id = 1;

app.use('/api/greeting', kc.protect('booster-admin'), (request, response) => {
  const name = request.query ? request.query.name : undefined;
  response.send({ id: id++, content: `Hello, ${name || 'World!'}` });
});

// Add basic health check endpoints
app.use('/ready', (request, response) => {
  return response.sendStatus(200);
});

app.use('/live', (request, response) => {
  return response.sendStatus(200);
});

module.exports = app;
