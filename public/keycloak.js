/*
 * Copyright 2016 Red Hat, Inc. and/or its affiliates
 * and other contributors as indicated by the @author tags.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

(function (window, undefined) {
  var Keycloak = function (config) {
    if (!(this instanceof Keycloak)) {
      return new Keycloak(config);
    }

    const kc = this;
    let adapter;
    const refreshQueue = [];
    let storage;

    const loginIframe = {
      enable: true,
      callbackMap: [],
      interval: 5
    };

    kc.init = function (initOptions) {
      kc.authenticated = false;

      storage = new PersistentStorage();

      if (window.Cordova) {
        adapter = loadAdapter('cordova');
      } else {
        adapter = loadAdapter();
      }

      if (initOptions) {
        if (typeof initOptions.checkLoginIframe !== 'undefined') {
          loginIframe.enable = initOptions.checkLoginIframe;
        }

        if (initOptions.checkLoginIframeInterval) {
          loginIframe.interval = initOptions.checkLoginIframeInterval;
        }

        if (initOptions.onLoad === 'login-required') {
          kc.loginRequired = true;
        }

        if (initOptions.responseMode) {
          if (initOptions.responseMode === 'query' || initOptions.responseMode === 'fragment') {
            kc.responseMode = initOptions.responseMode;
          } else {
            throw 'Invalid value for responseMode';
          }
        }

        if (initOptions.flow) {
          switch (initOptions.flow) {
            case 'standard':
              kc.responseType = 'code';
              break;
            case 'implicit':
              kc.responseType = 'id_token token';
              break;
            case 'hybrid':
              kc.responseType = 'code id_token token';
              break;
            default:
              throw 'Invalid value for flow';
          }
          kc.flow = initOptions.flow;
        }
      }

      if (!kc.responseMode) {
        kc.responseMode = 'fragment';
      }
      if (!kc.responseType) {
        kc.responseType = 'code';
        kc.flow = 'standard';
      }

      const promise = createPromise();

      const initPromise = createPromise();
      initPromise.promise.success(function () {
        kc.onReady && kc.onReady(kc.authenticated);
        promise.setSuccess(kc.authenticated);
      }).error(function () {
        promise.setError();
      });

      const configPromise = loadConfig(config);

      function onLoad () {
        const doLogin = function (prompt) {
          if (!prompt) {
            options.prompt = 'none';
          }
          kc.login(options).success(function () {
            initPromise.setSuccess();
          }).error(function () {
            initPromise.setError();
          });
        };

        var options = {};
        switch (initOptions.onLoad) {
          case 'check-sso':
            if (loginIframe.enable) {
              setupCheckLoginIframe().success(function () {
                checkLoginIframe().success(function () {
                  doLogin(false);
                }).error(function () {
                  initPromise.setSuccess();
                });
              });
            } else {
              doLogin(false);
            }
            break;
          case 'login-required':
            doLogin(true);
            break;
          default:
            throw 'Invalid value for onLoad';
        }
      }

      function processInit () {
        const callback = parseCallback(window.location.href);

        if (callback) {
          setupCheckLoginIframe();
          window.history.replaceState({}, null, callback.newUrl);
          processCallback(callback, initPromise);
        } else if (initOptions) {
          if (initOptions.token || initOptions.refreshToken) {
            setToken(initOptions.token, initOptions.refreshToken, initOptions.idToken, false);
            kc.timeSkew = initOptions.timeSkew || 0;

            if (loginIframe.enable) {
              setupCheckLoginIframe().success(function () {
                checkLoginIframe().success(function () {
                  initPromise.setSuccess();
                }).error(function () {
                  if (initOptions.onLoad) {
                    onLoad();
                  }
                });
              });
            } else {
              initPromise.setSuccess();
            }
          } else if (initOptions.onLoad) {
            onLoad();
          } else {
            initPromise.setSuccess();
          }
        } else {
          initPromise.setSuccess();
        }
      }

      configPromise.success(processInit);
      configPromise.error(function () {
        promise.setError();
      });

      return promise.promise;
    };

    kc.login = function (options) {
      return adapter.login(options);
    };

    kc.createLoginUrl = function (options) {
      const state = createUUID();
      const nonce = createUUID();

      let redirectUri = adapter.redirectUri(options);
      if (options && options.prompt) {
        redirectUri += `${redirectUri.indexOf('?') == -1 ? '?' : '&'}prompt=${options.prompt}`;
      }

      storage.setItem('oauthState', JSON.stringify({ state: state, nonce: nonce, redirectUri: encodeURIComponent(redirectUri) }));

      let action = 'auth';
      if (options && options.action == 'register') {
        action = 'registrations';
      }

      let url = `${getRealmUrl()
                 }/protocol/openid-connect/${action
                 }?client_id=${encodeURIComponent(kc.clientId)
                 }&redirect_uri=${encodeURIComponent(redirectUri)
                 }&state=${encodeURIComponent(state)
                 }&nonce=${encodeURIComponent(nonce)
                 }&response_mode=${encodeURIComponent(kc.responseMode)
                 }&response_type=${encodeURIComponent(kc.responseType)}`;

      if (options && options.prompt) {
        url += `&prompt=${encodeURIComponent(options.prompt)}`;
      }

      if (options && options.loginHint) {
        url += `&login_hint=${encodeURIComponent(options.loginHint)}`;
      }

      if (options && options.idpHint) {
        url += `&kc_idp_hint=${encodeURIComponent(options.idpHint)}`;
      }

      if (options && options.scope) {
        url += `&scope=${encodeURIComponent(options.scope)}`;
      }

      if (options && options.locale) {
        url += `&ui_locales=${encodeURIComponent(options.locale)}`;
      }

      return url;
    };

    kc.logout = function (options) {
      return adapter.logout(options);
    };

    kc.createLogoutUrl = function (options) {
      const url = `${getRealmUrl()
                 }/protocol/openid-connect/logout` +
                `?redirect_uri=${encodeURIComponent(adapter.redirectUri(options, false))}`;

      return url;
    };

    kc.register = function (options) {
      return adapter.register(options);
    };

    kc.createRegisterUrl = function (options) {
      if (!options) {
        options = {};
      }
      options.action = 'register';
      return kc.createLoginUrl(options);
    };

    kc.createAccountUrl = function (options) {
      const url = `${getRealmUrl()
                 }/account` +
                `?referrer=${encodeURIComponent(kc.clientId)
                 }&referrer_uri=${encodeURIComponent(adapter.redirectUri(options))}`;

      return url;
    };

    kc.accountManagement = function () {
      return adapter.accountManagement();
    };

    kc.hasRealmRole = function (role) {
      const access = kc.realmAccess;
      return !!access && access.roles.indexOf(role) >= 0;
    };

    kc.hasResourceRole = function (role, resource) {
      if (!kc.resourceAccess) {
        return false;
      }

      const access = kc.resourceAccess[resource || kc.clientId];
      return !!access && access.roles.indexOf(role) >= 0;
    };

    kc.loadUserProfile = function () {
      const url = `${getRealmUrl()}/account`;
      const req = new XMLHttpRequest();
      req.open('GET', url, true);
      req.setRequestHeader('Accept', 'application/json');
      req.setRequestHeader('Authorization', `bearer ${kc.token}`);

      const promise = createPromise();

      req.onreadystatechange = function () {
        if (req.readyState == 4) {
          if (req.status == 200) {
            kc.profile = JSON.parse(req.responseText);
            promise.setSuccess(kc.profile);
          } else {
            promise.setError();
          }
        }
      };

      req.send();

      return promise.promise;
    };

    kc.loadUserInfo = function () {
      const url = `${getRealmUrl()}/protocol/openid-connect/userinfo`;
      const req = new XMLHttpRequest();
      req.open('GET', url, true);
      req.setRequestHeader('Accept', 'application/json');
      req.setRequestHeader('Authorization', `bearer ${kc.token}`);

      const promise = createPromise();

      req.onreadystatechange = function () {
        if (req.readyState == 4) {
          if (req.status == 200) {
            kc.userInfo = JSON.parse(req.responseText);
            promise.setSuccess(kc.userInfo);
          } else {
            promise.setError();
          }
        }
      };

      req.send();

      return promise.promise;
    };

    kc.isTokenExpired = function (minValidity) {
      if (!kc.tokenParsed || (!kc.refreshToken && kc.flow != 'implicit')) {
        throw 'Not authenticated';
      }

      let expiresIn = kc.tokenParsed.exp - (new Date().getTime() / 1000) + kc.timeSkew;
      if (minValidity) {
        expiresIn -= minValidity;
      }

      return expiresIn < 0;
    };

    kc.updateToken = function (minValidity) {
      const promise = createPromise();

      if (!kc.tokenParsed || !kc.refreshToken) {
        promise.setError();
        return promise.promise;
      }

      minValidity = minValidity || 5;

      const exec = function () {
        if (!kc.isTokenExpired(minValidity)) {
          promise.setSuccess(false);
        } else {
          let params = `${'grant_type=refresh_token&' + 'refresh_token='}${kc.refreshToken}`;
          const url = `${getRealmUrl()}/protocol/openid-connect/token`;

          refreshQueue.push(promise);

          if (refreshQueue.length == 1) {
            const req = new XMLHttpRequest();
            req.open('POST', url, true);
            req.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');

            if (kc.clientId && kc.clientSecret) {
              req.setRequestHeader('Authorization', `Basic ${btoa(`${kc.clientId}:${kc.clientSecret}`)}`);
            } else {
              params += `&client_id=${encodeURIComponent(kc.clientId)}`;
            }

            let timeLocal = new Date().getTime();

            req.onreadystatechange = function () {
              if (req.readyState == 4) {
                if (req.status == 200) {
                  timeLocal = (timeLocal + new Date().getTime()) / 2;

                  const tokenResponse = JSON.parse(req.responseText);
                  setToken(tokenResponse.access_token, tokenResponse.refresh_token, tokenResponse.id_token, true);

                  kc.timeSkew = Math.floor(timeLocal / 1000) - kc.tokenParsed.iat;

                  kc.onAuthRefreshSuccess && kc.onAuthRefreshSuccess();
                  for (var p = refreshQueue.pop(); p != null; p = refreshQueue.pop()) {
                    p.setSuccess(true);
                  }
                } else {
                  kc.onAuthRefreshError && kc.onAuthRefreshError();
                  for (var p = refreshQueue.pop(); p != null; p = refreshQueue.pop()) {
                    p.setError(true);
                  }
                }
              }
            };

            req.send(params);
          }
        }
      };

      if (loginIframe.enable) {
        const iframePromise = checkLoginIframe();
        iframePromise.success(function () {
          exec();
        }).error(function () {
          promise.setError();
        });
      } else {
        exec();
      }

      return promise.promise;
    };

    kc.clearToken = function () {
      if (kc.token) {
        setToken(null, null, null, true);
        kc.onAuthLogout && kc.onAuthLogout();
        if (kc.loginRequired) {
          kc.login();
        }
      }
    };

    function getRealmUrl () {
      if (kc.authServerUrl.charAt(kc.authServerUrl.length - 1) == '/') {
        return `${kc.authServerUrl}realms/${encodeURIComponent(kc.realm)}`;
      } else {
        return `${kc.authServerUrl}/realms/${encodeURIComponent(kc.realm)}`;
      }
    }

    function getOrigin () {
      if (!window.location.origin) {
        return `${window.location.protocol}//${window.location.hostname}${window.location.port ? `:${window.location.port}` : ''}`;
      } else {
        return window.location.origin;
      }
    }

    function processCallback (oauth, promise) {
      const code = oauth.code;
      const error = oauth.error;
      const prompt = oauth.prompt;

      let timeLocal = new Date().getTime();

      if (error) {
        if (prompt != 'none') {
          kc.onAuthError && kc.onAuthError();
          promise && promise.setError();
        } else {
          promise && promise.setSuccess();
        }
        return;
      } else if ((kc.flow != 'standard') && (oauth.access_token || oauth.id_token)) {
        authSuccess(oauth.access_token, null, oauth.id_token, true);
      }

      if ((kc.flow != 'implicit') && code) {
        let params = `code=${code}&grant_type=authorization_code`;
        const url = `${getRealmUrl()}/protocol/openid-connect/token`;

        const req = new XMLHttpRequest();
        req.open('POST', url, true);
        req.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');

        if (kc.clientId && kc.clientSecret) {
          req.setRequestHeader('Authorization', `Basic ${btoa(`${kc.clientId}:${kc.clientSecret}`)}`);
        } else {
          params += `&client_id=${encodeURIComponent(kc.clientId)}`;
        }

        params += `&redirect_uri=${oauth.redirectUri}`;

        req.withCredentials = true;

        req.onreadystatechange = function () {
          if (req.readyState == 4) {
            if (req.status == 200) {
              const tokenResponse = JSON.parse(req.responseText);
              authSuccess(tokenResponse.access_token, tokenResponse.refresh_token, tokenResponse.id_token, kc.flow === 'standard');
            } else {
              kc.onAuthError && kc.onAuthError();
              promise && promise.setError();
            }
          }
        };

        req.send(params);
      }

      function authSuccess (accessToken, refreshToken, idToken, fulfillPromise) {
        timeLocal = (timeLocal + new Date().getTime()) / 2;

        setToken(accessToken, refreshToken, idToken, true);

        if ((kc.tokenParsed && kc.tokenParsed.nonce != oauth.storedNonce) ||
                    (kc.refreshTokenParsed && kc.refreshTokenParsed.nonce != oauth.storedNonce) ||
                    (kc.idTokenParsed && kc.idTokenParsed.nonce != oauth.storedNonce)) {
          console.log('invalid nonce!');
          kc.clearToken();
          promise && promise.setError();
        } else {
          kc.timeSkew = Math.floor(timeLocal / 1000) - kc.tokenParsed.iat;

          if (fulfillPromise) {
            kc.onAuthSuccess && kc.onAuthSuccess();
            promise && promise.setSuccess();
          }
        }
      }
    }

    function loadConfig (url) {
      const promise = createPromise();
      let configUrl;

      if (!config) {
        configUrl = 'keycloak.json';
      } else if (typeof config === 'string') {
        configUrl = config;
      }

      if (configUrl) {
        const req = new XMLHttpRequest();
        req.open('GET', configUrl, true);
        req.setRequestHeader('Accept', 'application/json');

        req.onreadystatechange = function () {
          if (req.readyState == 4) {
            if (req.status == 200) {
              const config = JSON.parse(req.responseText);

              kc.authServerUrl = config['auth-server-url'];
              kc.realm = config.realm;
              kc.clientId = config.resource;
              kc.clientSecret = (config.credentials || {}).secret;

              promise.setSuccess();
            } else {
              promise.setError();
            }
          }
        };

        req.send();
      } else {
        if (!config.url) {
          const scripts = document.getElementsByTagName('script');
          for (let i = 0; i < scripts.length; i++) {
            if (scripts[i].src.match(/.*keycloak\.js/)) {
              config.url = scripts[i].src.substr(0, scripts[i].src.indexOf('/js/keycloak.js'));
              break;
            }
          }
        }

        if (!config.realm) {
          throw 'realm missing';
        }

        if (!config.clientId) {
          throw 'clientId missing';
        }

        kc.authServerUrl = config.url;
        kc.realm = config.realm;
        kc.clientId = config.clientId;
        kc.clientSecret = (config.credentials || {}).secret;

        promise.setSuccess();
      }

      return promise.promise;
    }

    function setToken (token, refreshToken, idToken, useTokenTime) {
      if (kc.tokenTimeoutHandle) {
        clearTimeout(kc.tokenTimeoutHandle);
        kc.tokenTimeoutHandle = null;
      }

      if (token) {
        kc.token = token;
        kc.tokenParsed = decodeToken(token);
        let sessionId = `${kc.realm}/${kc.tokenParsed.sub}`;
        if (kc.tokenParsed.session_state) {
          sessionId = `${sessionId}/${kc.tokenParsed.session_state}`;
        }
        kc.sessionId = sessionId;
        kc.authenticated = true;
        kc.subject = kc.tokenParsed.sub;
        kc.realmAccess = kc.tokenParsed.realm_access;
        kc.resourceAccess = kc.tokenParsed.resource_access;

        if (kc.onTokenExpired) {
          const start = useTokenTime ? kc.tokenParsed.iat : (new Date().getTime() / 1000);
          const expiresIn = kc.tokenParsed.exp - start;
          kc.tokenTimeoutHandle = setTimeout(kc.onTokenExpired, expiresIn * 1000);
        }
      } else {
        delete kc.token;
        delete kc.tokenParsed;
        delete kc.subject;
        delete kc.realmAccess;
        delete kc.resourceAccess;

        kc.authenticated = false;
      }

      if (refreshToken) {
        kc.refreshToken = refreshToken;
        kc.refreshTokenParsed = decodeToken(refreshToken);
      } else {
        delete kc.refreshToken;
        delete kc.refreshTokenParsed;
      }

      if (idToken) {
        kc.idToken = idToken;
        kc.idTokenParsed = decodeToken(idToken);
      } else {
        delete kc.idToken;
        delete kc.idTokenParsed;
      }
    }

    function decodeToken (str) {
      str = str.split('.')[1];

      str = str.replace('/-/g', '+');
      str = str.replace('/_/g', '/');
      switch (str.length % 4) {
        case 0:
          break;
        case 2:
          str += '==';
          break;
        case 3:
          str += '=';
          break;
        default:
          throw 'Invalid token';
      }

      str = (`${str}===`).slice(0, str.length + (str.length % 4));
      str = str.replace(/-/g, '+').replace(/_/g, '/');

      str = decodeURIComponent(escape(atob(str)));

      str = JSON.parse(str);
      return str;
    }

    function createUUID () {
      const s = [];
      const hexDigits = '0123456789abcdef';
      for (let i = 0; i < 36; i++) {
        s[i] = hexDigits.substr(Math.floor(Math.random() * 0x10), 1);
      }
      s[14] = '4';
      s[19] = hexDigits.substr((s[19] & 0x3) | 0x8, 1);
      s[8] = s[13] = s[18] = s[23] = '-';
      const uuid = s.join('');
      return uuid;
    }

    kc.callback_id = 0;

    function createCallbackId () {
      const id = `<id: ${kc.callback_id++}${Math.random()}>`;
      return id;
    }

    function parseCallback (url) {
      const oauth = new CallbackParser(url, kc.responseMode).parseUri();

      const oauthState = storage.getItem('oauthState');
      const sessionState = oauthState && JSON.parse(oauthState);

      if (sessionState && (oauth.code || oauth.error || oauth.access_token || oauth.id_token) && oauth.state && oauth.state == sessionState.state) {
        storage.removeItem('oauthState');

        oauth.redirectUri = sessionState.redirectUri;
        oauth.storedNonce = sessionState.nonce;

        if (oauth.fragment) {
          oauth.newUrl += `#${oauth.fragment}`;
        }

        return oauth;
      }
    }

    function createPromise () {
      var p = {
        setSuccess: function (result) {
          p.success = true;
          p.result = result;
          if (p.successCallback) {
            p.successCallback(result);
          }
        },

        setError: function (result) {
          p.error = true;
          p.result = result;
          if (p.errorCallback) {
            p.errorCallback(result);
          }
        },

        promise: {
          success: function (callback) {
            if (p.success) {
              callback(p.result);
            } else if (!p.error) {
              p.successCallback = callback;
            }
            return p.promise;
          },
          error: function (callback) {
            if (p.error) {
              callback(p.result);
            } else if (!p.success) {
              p.errorCallback = callback;
            }
            return p.promise;
          }
        }
      };
      return p;
    }

    function setupCheckLoginIframe () {
      const promise = createPromise();

      if (!loginIframe.enable) {
        promise.setSuccess();
        return promise.promise;
      }

      if (loginIframe.iframe) {
        promise.setSuccess();
        return promise.promise;
      }

      const iframe = document.createElement('iframe');
      loginIframe.iframe = iframe;

      iframe.onload = function () {
        const realmUrl = getRealmUrl();
        if (realmUrl.charAt(0) === '/') {
          loginIframe.iframeOrigin = getOrigin();
        } else {
          loginIframe.iframeOrigin = realmUrl.substring(0, realmUrl.indexOf('/', 8));
        }
        promise.setSuccess();

        setTimeout(check, loginIframe.interval * 1000);
      };

      const src = `${getRealmUrl()}/protocol/openid-connect/login-status-iframe.html?client_id=${encodeURIComponent(kc.clientId)}&origin=${getOrigin()}`;
      iframe.setAttribute('src', src);
      iframe.style.display = 'none';
      document.body.appendChild(iframe);

      const messageCallback = function (event) {
        if (event.origin !== loginIframe.iframeOrigin) {
          return;
        }
        const data = JSON.parse(event.data);
        const promise = loginIframe.callbackMap[data.callbackId];
        delete loginIframe.callbackMap[data.callbackId];

        if ((!kc.sessionId || kc.sessionId == data.session) && data.loggedIn) {
          promise.setSuccess();
        } else {
          kc.clearToken();
          promise.setError();
        }
      };
      window.addEventListener('message', messageCallback, false);

      var check = function () {
        checkLoginIframe();
        if (kc.token) {
          setTimeout(check, loginIframe.interval * 1000);
        }
      };

      return promise.promise;
    }

    function checkLoginIframe () {
      const promise = createPromise();

      if (loginIframe.iframe && loginIframe.iframeOrigin) {
        const msg = {};
        msg.callbackId = createCallbackId();
        loginIframe.callbackMap[msg.callbackId] = promise;
        const origin = loginIframe.iframeOrigin;
        loginIframe.iframe.contentWindow.postMessage(JSON.stringify(msg), origin);
      } else {
        promise.setSuccess();
      }

      return promise.promise;
    }

    function loadAdapter (type) {
      if (!type || type == 'default') {
        return {
          login: function (options) {
            window.location.href = kc.createLoginUrl(options);
            return createPromise().promise;
          },

          logout: function (options) {
            window.location.href = kc.createLogoutUrl(options);
            return createPromise().promise;
          },

          register: function (options) {
            window.location.href = kc.createRegisterUrl(options);
            return createPromise().promise;
          },

          accountManagement: function () {
            window.location.href = kc.createAccountUrl();
            return createPromise().promise;
          },

          redirectUri: function (options, encodeHash) {
            if (arguments.length == 1) {
              encodeHash = true;
            }

            if (options && options.redirectUri) {
              return options.redirectUri;
            } else if (kc.redirectUri) {
              return kc.redirectUri;
            } else {
              let redirectUri = location.href;
              if (location.hash && encodeHash) {
                redirectUri = redirectUri.substring(0, location.href.indexOf('#'));
                redirectUri += `${redirectUri.indexOf('?') == -1 ? '?' : '&'}redirect_fragment=${encodeURIComponent(location.hash.substring(1))}`;
              }
              return redirectUri;
            }
          }
        };
      }

      if (type == 'cordova') {
        loginIframe.enable = false;

        return {
          login: function (options) {
            const promise = createPromise();

            let o = 'location=no';
            if (options && options.prompt == 'none') {
              o += ',hidden=yes';
            }

            const loginUrl = kc.createLoginUrl(options);
            const ref = window.open(loginUrl, '_blank', o);

            let completed = false;

            ref.addEventListener('loadstart', function (event) {
              if (event.url.indexOf('http://localhost') == 0) {
                const callback = parseCallback(event.url);
                processCallback(callback, promise);
                ref.close();
                completed = true;
              }
            });

            ref.addEventListener('loaderror', function (event) {
              if (!completed) {
                if (event.url.indexOf('http://localhost') == 0) {
                  const callback = parseCallback(event.url);
                  processCallback(callback, promise);
                  ref.close();
                  completed = true;
                } else {
                  promise.setError();
                  ref.close();
                }
              }
            });

            return promise.promise;
          },

          logout: function (options) {
            const promise = createPromise();

            const logoutUrl = kc.createLogoutUrl(options);
            const ref = window.open(logoutUrl, '_blank', 'location=no,hidden=yes');

            let error;

            ref.addEventListener('loadstart', function (event) {
              if (event.url.indexOf('http://localhost') == 0) {
                ref.close();
              }
            });

            ref.addEventListener('loaderror', function (event) {
              if (event.url.indexOf('http://localhost') == 0) {
                ref.close();
              } else {
                error = true;
                ref.close();
              }
            });

            ref.addEventListener('exit', function (event) {
              if (error) {
                promise.setError();
              } else {
                kc.clearToken();
                promise.setSuccess();
              }
            });

            return promise.promise;
          },

          register: function () {
            const registerUrl = kc.createRegisterUrl();
            const ref = window.open(registerUrl, '_blank', 'location=no');
            ref.addEventListener('loadstart', function (event) {
              if (event.url.indexOf('http://localhost') == 0) {
                ref.close();
              }
            });
          },

          accountManagement: function () {
            const accountUrl = kc.createAccountUrl();
            const ref = window.open(accountUrl, '_blank', 'location=no');
            ref.addEventListener('loadstart', function (event) {
              if (event.url.indexOf('http://localhost') == 0) {
                ref.close();
              }
            });
          },

          redirectUri: function (options) {
            return 'http://localhost';
          }
        };
      }

      throw `invalid adapter type: ${type}`;
    }

    var PersistentStorage = function () {
      if (!(this instanceof PersistentStorage)) {
        return new PersistentStorage();
      }
      const ps = this;
      const useCookieStorage = function () {
        if (typeof localStorage === 'undefined') {
          return true;
        }
        try {
          const key = '@@keycloak-session-storage/test';
          localStorage.setItem(key, 'test');
          localStorage.removeItem(key);
          return false;
        } catch (err) {
          // Probably in Safari "private mode" where localStorage
          // quota is 0, or quota exceeded. Switching to cookie
          // storage.
          return true;
        }
      };

      ps.setItem = function (key, value) {
        if (useCookieStorage()) {
          setCookie(key, value, cookieExpiration(5));
        } else {
          localStorage.setItem(key, value);
        }
      };

      ps.getItem = function (key) {
        if (useCookieStorage()) {
          return getCookie(key);
        }
        return localStorage.getItem(key);
      };

      ps.removeItem = function (key) {
        if (typeof localStorage !== 'undefined') {
          try {
            // Always try to delete from localStorage.
            localStorage.removeItem(key);
          } catch (err) { }
        }
        // Always remove the cookie.
        setCookie(key, '', cookieExpiration(-100));
      };

      var cookieExpiration = function (minutes) {
        const exp = new Date();
        exp.setTime(exp.getTime() + (minutes * 60 * 1000));
        return exp;
      };

      var getCookie = function (key) {
        const name = `${key}=`;
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
          let c = ca[i];
          while (c.charAt(0) == ' ') {
            c = c.substring(1);
          }
          if (c.indexOf(name) == 0) {
            return c.substring(name.length, c.length);
          }
        }
        return '';
      };

      var setCookie = function (key, value, expirationDate) {
        const cookie = `${key}=${value}; ` +
                    `expires=${expirationDate.toUTCString()}; `;
        document.cookie = cookie;
      };
    };

    var CallbackParser = function (uriToParse, responseMode) {
      if (!(this instanceof CallbackParser)) {
        return new CallbackParser(uriToParse, responseMode);
      }
      const parser = this;

      const initialParse = function () {
        let baseUri = null;
        let queryString = null;
        let fragmentString = null;

        const questionMarkIndex = uriToParse.indexOf('?');
        let fragmentIndex = uriToParse.indexOf('#', questionMarkIndex + 1);
        if (questionMarkIndex == -1 && fragmentIndex == -1) {
          baseUri = uriToParse;
        } else if (questionMarkIndex != -1) {
          baseUri = uriToParse.substring(0, questionMarkIndex);
          queryString = uriToParse.substring(questionMarkIndex + 1);
          if (fragmentIndex != -1) {
            fragmentIndex = queryString.indexOf('#');
            fragmentString = queryString.substring(fragmentIndex + 1);
            queryString = queryString.substring(0, fragmentIndex);
          }
        } else {
          baseUri = uriToParse.substring(0, fragmentIndex);
          fragmentString = uriToParse.substring(fragmentIndex + 1);
        }

        return { baseUri: baseUri, queryString: queryString, fragmentString: fragmentString };
      };

      const parseParams = function (paramString) {
        const result = {};
        const params = paramString.split('&');
        for (let i = 0; i < params.length; i++) {
          const p = params[i].split('=');
          const paramName = decodeURIComponent(p[0]);
          const paramValue = decodeURIComponent(p[1]);
          result[paramName] = paramValue;
        }
        return result;
      };

      const handleQueryParam = function (paramName, paramValue, oauth) {
        const supportedOAuthParams = ['code', 'error', 'state'];

        for (let i = 0; i < supportedOAuthParams.length; i++) {
          if (paramName === supportedOAuthParams[i]) {
            oauth[paramName] = paramValue;
            return true;
          }
        }
        return false;
      };

      parser.parseUri = function () {
        const parsedUri = initialParse();

        let queryParams = {};
        if (parsedUri.queryString) {
          queryParams = parseParams(parsedUri.queryString);
        }

        const oauth = { newUrl: parsedUri.baseUri };
        for (var param in queryParams) {
          switch (param) {
            case 'redirect_fragment':
              oauth.fragment = queryParams[param];
              break;
            case 'prompt':
              oauth.prompt = queryParams[param];
              break;
            default:
              if (responseMode != 'query' || !handleQueryParam(param, queryParams[param], oauth)) {
                oauth.newUrl += `${(oauth.newUrl.indexOf('?') == -1 ? '?' : '&') + param}=${queryParams[param]}`;
              }
              break;
          }
        }

        if (responseMode === 'fragment') {
          let fragmentParams = {};
          if (parsedUri.fragmentString) {
            fragmentParams = parseParams(parsedUri.fragmentString);
          }
          for (var param in fragmentParams) {
            oauth[param] = fragmentParams[param];
          }
        }

        return oauth;
      };
    };
  };

  if (typeof module === 'object' && module && typeof module.exports === 'object') {
    module.exports = Keycloak;
  } else {
    window.Keycloak = Keycloak;

    if (typeof define === 'function' && define.amd) {
      define('keycloak', [], function () { return Keycloak; });
    }
  }
})(window);
