/* Leletke sign-in and protected API check.
 * Microsoft Entra External ID handles the email OTP sign-in.
 * The SPA then requests an API-specific access token and calls /api/me.
 * The API independently validates the token signature and claims.
 */

const AUTH_CONFIG = window.LABORNAPLO_AUTH_CONFIG || {};
const authScreen = document.getElementById('authScreen');
const authenticatedApp = document.getElementById('authenticatedApp');
const loginButton = document.getElementById('loginButton');
const logoutButton = document.getElementById('logoutButton');
const authSetupNote = document.getElementById('authSetupNote');
const authError = document.getElementById('authError');
const authUserEmail = document.getElementById('authUserEmail');
const authAvatar = document.getElementById('authAvatar');

function showAuthError(message) {
  if (!authError) return;
  authError.textContent = message;
  authError.hidden = false;
}

function clearAuthError() {
  if (!authError) return;
  authError.textContent = '';
  authError.hidden = true;
}

// Log only non-sensitive MSAL diagnostics. Never log tokens, authorization
// codes, account identifiers, email addresses, or complete redirect URLs.
function logAuthDiagnostic(phase, error = null, details = {}) {
  const diagnostic = { phase, ...details };
  if (error) {
    diagnostic.errorName = error.name || null;
    diagnostic.errorCode = error.errorCode || null;
    diagnostic.subError = error.subError || null;
    diagnostic.correlationId = error.correlationId || null;
  }
  console.info('[Leletke auth diagnostic]', diagnostic);
}

function isConfigured() {
  return Boolean(
    AUTH_CONFIG.clientId &&
    AUTH_CONFIG.tenantSubdomain &&
    AUTH_CONFIG.apiScope &&
    AUTH_CONFIG.apiBaseUrl &&
    !AUTH_CONFIG.clientId.includes('PASTE_') &&
    !AUTH_CONFIG.apiScope.includes('API_APP_CLIENT_ID')
  );
}

function showSignedIn(account) {
  const email = account.username ||
    account.idTokenClaims?.email ||
    account.idTokenClaims?.preferred_username ||
    'Bejelentkezett felhasználó';

  authUserEmail.textContent = email;
  authAvatar.textContent = email.charAt(0).toLocaleUpperCase('hu-HU');
  authScreen.hidden = true;
  authenticatedApp.hidden = false;
}

function showSignedOut() {
  authenticatedApp.hidden = true;
  authScreen.hidden = false;
}

async function startAuthentication() {
  if (!isConfigured()) {
    loginButton.hidden = true;
    authSetupNote.hidden = false;
    return;
  }

  authSetupNote.hidden = true;
  loginButton.hidden = false;
  loginButton.disabled = true;
  loginButton.textContent = 'Bejelentkezés betöltése…';

  try {
    // Version-pinned MSAL Browser package. For a later production hardening
    // pass, bundle and self-host this dependency instead of loading a CDN.
    const { PublicClientApplication, LogLevel, InteractionRequiredAuthError } = await import(
      'https://esm.sh/@azure/msal-browser@4.30.0?bundle'
    );

    const tenantHost = `${AUTH_CONFIG.tenantSubdomain}.ciamlogin.com`;
    const redirectUri = AUTH_CONFIG.redirectUri || `${window.location.origin}/`;
    const postLogoutRedirectUri = AUTH_CONFIG.postLogoutRedirectUri || `${window.location.origin}/`;

    const msalInstance = new PublicClientApplication({
      auth: {
        clientId: AUTH_CONFIG.clientId,
        authority: `https://${tenantHost}/`,
        knownAuthorities: [tenantHost],
        redirectUri,
        postLogoutRedirectUri,
        navigateToLoginRequestUrl: true
      },
      cache: {
        cacheLocation: 'sessionStorage'
      },
      system: {
        loggerOptions: {
          loggerCallback: (level, message, containsPii) => {
            if (!containsPii && level === LogLevel.Error) {
              console.error('[Leletke auth]', message);
            }
          },
          piiLoggingEnabled: false,
          logLevel: LogLevel.Error
        }
      }
    });

    logAuthDiagnostic('msal-initialize-start');
    await msalInstance.initialize();
    logAuthDiagnostic('msal-initialize-complete');

    // Expose only the authenticated PDF upload operation to the frontend UI.
    // The API independently validates the Entra access token before accepting data.
    window.LABORNAPLO_AUTH = {
      async listReports() {
        const currentAccount = msalInstance.getActiveAccount();
        if (!currentAccount) {
          throw new Error('A leletek megtekintéséhez előbb be kell jelentkezned.');
        }

        let accessToken;
        try {
          const tokenResult = await msalInstance.acquireTokenSilent({
            scopes: [AUTH_CONFIG.apiScope],
            account: currentAccount
          });
          accessToken = tokenResult.accessToken;
        } catch (error) {
          if (error instanceof InteractionRequiredAuthError ||
              error?.errorCode === 'interaction_required' ||
              error?.errorCode === 'consent_required') {
            const tokenResult = await msalInstance.acquireTokenPopup({
              scopes: [AUTH_CONFIG.apiScope],
              account: currentAccount
            });
            accessToken = tokenResult.accessToken;
          } else {
            throw error;
          }
        }

        const response = await fetch(`${AUTH_CONFIG.apiBaseUrl}/api/reports`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json'
          },
          cache: 'no-store'
        });

        let result = {};
        try { result = await response.json(); } catch { /* use a safe generic message */ }
        if (!response.ok) {
          if (response.status === 401) {
            throw new Error('A munkamenet lejárt vagy az API nem fogadta el a bejelentkezést. Frissítsd az oldalt, majd próbáld újra.');
          }
          throw new Error(result.message || 'A leletek betöltése nem sikerült. Próbáld újra később.');
        }
        if (!Array.isArray(result.reports)) {
          throw new Error('A szerver válasza nem tartalmaz érvényes leletlistát.');
        }
        return result.reports;
      },

      async getReportPdf(reportId) {
        const currentAccount = msalInstance.getActiveAccount();
        if (!currentAccount) {
          throw new Error('A PDF megtekintéséhez előbb be kell jelentkezned.');
        }
        if (typeof reportId !== 'string' || !/^[0-9a-f-]{36}$/i.test(reportId)) {
          throw new Error('Érvénytelen leletazonosító.');
        }

        let accessToken;
        try {
          const tokenResult = await msalInstance.acquireTokenSilent({
            scopes: [AUTH_CONFIG.apiScope],
            account: currentAccount
          });
          accessToken = tokenResult.accessToken;
        } catch (error) {
          if (error instanceof InteractionRequiredAuthError ||
              error?.errorCode === 'interaction_required' ||
              error?.errorCode === 'consent_required') {
            const tokenResult = await msalInstance.acquireTokenPopup({
              scopes: [AUTH_CONFIG.apiScope],
              account: currentAccount
            });
            accessToken = tokenResult.accessToken;
          } else {
            throw error;
          }
        }

        const response = await fetch(
          `${AUTH_CONFIG.apiBaseUrl}/api/reports/${encodeURIComponent(reportId)}/pdf`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/pdf'
            },
            cache: 'no-store'
          }
        );

        if (!response.ok) {
          let result = {};
          try { result = await response.json(); } catch { /* use a safe generic message */ }
          if (response.status === 401) {
            throw new Error('A munkamenet lejárt. Frissítsd az oldalt, majd próbáld újra.');
          }
          throw new Error(result.message || 'A PDF megnyitása nem sikerült. Próbáld újra később.');
        }

        const blob = await response.blob();
        if (blob.type !== 'application/pdf' || blob.size === 0 || blob.size > 20 * 1024 * 1024) {
          throw new Error('A szerver nem érvényes PDF-dokumentumot küldött.');
        }
        return blob;
      },

      async deleteReport(reportId) {
        const currentAccount = msalInstance.getActiveAccount();
        if (!currentAccount) {
          throw new Error('A törléshez előbb be kell jelentkezned.');
        }
        if (typeof reportId !== 'string' || !/^[0-9a-f-]{36}$/i.test(reportId)) {
          throw new Error('Érvénytelen leletazonosító.');
        }

        let accessToken;
        try {
          const tokenResult = await msalInstance.acquireTokenSilent({
            scopes: [AUTH_CONFIG.apiScope],
            account: currentAccount
          });
          accessToken = tokenResult.accessToken;
        } catch (error) {
          if (error instanceof InteractionRequiredAuthError ||
              error?.errorCode === 'interaction_required' ||
              error?.errorCode === 'consent_required') {
            const tokenResult = await msalInstance.acquireTokenPopup({
              scopes: [AUTH_CONFIG.apiScope],
              account: currentAccount
            });
            accessToken = tokenResult.accessToken;
          } else {
            throw error;
          }
        }

        const response = await fetch(
          `${AUTH_CONFIG.apiBaseUrl}/api/reports/${encodeURIComponent(reportId)}`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json'
            },
            cache: 'no-store'
          }
        );

        let result = {};
        try { result = await response.json(); } catch { /* use a safe generic message */ }
        if (!response.ok) {
          if (response.status === 401) {
            throw new Error('A munkamenet lejárt vagy az API nem fogadta el a bejelentkezést. Frissítsd az oldalt, majd próbáld újra.');
          }
          throw new Error(result.message || 'A lelet törlése nem sikerült. Próbáld újra később.');
        }
        if (result.deleted !== true) {
          throw new Error('A szerver nem igazolta a lelet törlését.');
        }
        return result;
      },

      async uploadPdf(file) {
        const currentAccount = msalInstance.getActiveAccount();
        if (!currentAccount) {
          throw new Error('A feltöltéshez előbb be kell jelentkezned.');
        }
        if (!(file instanceof File)) {
          throw new Error('Nem sikerült beolvasni a kiválasztott fájlt.');
        }

        let uploadToken;
        try {
          const tokenResult = await msalInstance.acquireTokenSilent({
            scopes: [AUTH_CONFIG.apiScope],
            account: currentAccount
          });
          uploadToken = tokenResult.accessToken;
        } catch (error) {
          if (error instanceof InteractionRequiredAuthError ||
              error?.errorCode === 'interaction_required' ||
              error?.errorCode === 'consent_required') {
            const tokenResult = await msalInstance.acquireTokenPopup({
              scopes: [AUTH_CONFIG.apiScope],
              account: currentAccount
            });
            uploadToken = tokenResult.accessToken;
          } else {
            throw error;
          }
        }

        const response = await fetch(`${AUTH_CONFIG.apiBaseUrl}/api/reports`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${uploadToken}`,
            'Content-Type': 'application/pdf',
            'X-File-Name': encodeURIComponent(file.name)
          },
          body: file,
          cache: 'no-store'
        });

        let result = {};
        try { result = await response.json(); } catch { /* use a safe generic message */ }
        if (!response.ok) {
          if (response.status === 401) {
            throw new Error('A munkamenet lejárt vagy az API nem fogadta el a bejelentkezést. Frissítsd az oldalt, majd próbáld újra.');
          }
          throw new Error(result.message || 'A feltöltés nem sikerült. Próbáld újra később.');
        }
        if (result.uploaded !== true || !result.report?.reportId) {
          throw new Error('A szerver válasza nem igazolta a feltöltés sikerét.');
        }
        return result;
      }
    };

    logAuthDiagnostic('redirect-processing-start');
    let redirectResult;
    try {
      redirectResult = await msalInstance.handleRedirectPromise();
      logAuthDiagnostic('redirect-processing-complete', null, {
        redirectAccountReturned: Boolean(redirectResult?.account),
        redirectErrorReturned: Boolean(redirectResult?.error)
      });
    } catch (error) {
      logAuthDiagnostic('redirect-processing-failed', error);
      throw error;
    }

    if (redirectResult?.account) {
      msalInstance.setActiveAccount(redirectResult.account);
      logAuthDiagnostic('active-account-set-from-redirect');
    }

    const cachedAccounts = msalInstance.getAllAccounts();
    const currentActiveAccount = msalInstance.getActiveAccount();
    let account = null;

    if (currentActiveAccount) {
      account = cachedAccounts.find(cached =>
        cached.homeAccountId === currentActiveAccount.homeAccountId
      ) || null;
      if (account) {
        msalInstance.setActiveAccount(account);
        logAuthDiagnostic('active-account-restored-from-cache');
      } else {
        msalInstance.setActiveAccount(null);
        logAuthDiagnostic('stale-active-account-cleared');
      }
    }

    if (!account && redirectResult?.account) {
      account = redirectResult.account;
      msalInstance.setActiveAccount(account);
    }

    if (!account && cachedAccounts.length === 1) {
      account = cachedAccounts[0];
      msalInstance.setActiveAccount(account);
      logAuthDiagnostic('single-cached-account-selected');
    }

    if (!account && cachedAccounts.length > 1) {
      logAuthDiagnostic('multiple-cached-accounts-no-active-selection', null, {
        cachedAccountCount: cachedAccounts.length
      });
      throw new Error('Több mentett Microsoft-fiók található. Jelentkezz ki, majd válaszd ki újra a használni kívánt fiókot.');
    }

    logAuthDiagnostic('account-resolution-complete', null, {
      accountAvailable: Boolean(account),
      cachedAccountCount: cachedAccounts.length
    });

    async function verifyApiAccess(currentAccount) {
      logAuthDiagnostic('api-access-verification-start');
      let tokenResponse;
      try {
        tokenResponse = await msalInstance.acquireTokenSilent({
          scopes: [AUTH_CONFIG.apiScope],
          account: currentAccount
        });
        logAuthDiagnostic('silent-api-token-acquired', null, {
          accessTokenAvailable: Boolean(tokenResponse?.accessToken)
        });
      } catch (error) {
        if (error instanceof InteractionRequiredAuthError ||
            error?.errorCode === 'interaction_required' ||
            error?.errorCode === 'consent_required') {
          // This redirect is only needed the first time the SPA obtains the
          // API-specific permission, or after the Microsoft session expires.
          logAuthDiagnostic('interactive-api-token-required', error);
          await msalInstance.acquireTokenRedirect({
            scopes: [AUTH_CONFIG.apiScope],
            account: currentAccount
          });
          return;
        }
        logAuthDiagnostic('silent-api-token-acquisition-failed', error);
        throw error;
      }
const parts = tokenResponse.accessToken.split('.');
const encodedHeader = parts[0]
  .replace(/-/g, '+')
  .replace(/_/g, '/');
const paddedHeader = encodedHeader.padEnd(
  Math.ceil(encodedHeader.length / 4) * 4,
  '='
);
const tokenHeader = JSON.parse(atob(paddedHeader));

console.log('Leletke token fejléc:', {
  alg: tokenHeader.alg,
  kid: tokenHeader.kid || null,
  typ: tokenHeader.typ || null
});
      logAuthDiagnostic('protected-api-request-start');
      const response = await fetch(AUTH_CONFIG.protectedApiEndpoint || '/api/me', {
        method: 'GET',
        headers: {
        'X-LaborNaplo-Authorization': `Bearer ${tokenResponse.accessToken}`,
          Accept: 'application/json'
        },
        cache: 'no-store',
        credentials: 'same-origin'
      });

      logAuthDiagnostic('protected-api-response', null, {
        status: response.status,
        ok: response.ok
      });

      if (response.status === 401) {
        let rejection = null;
        try { rejection = await response.json(); } catch { /* keep generic message */ }
        const code = typeof rejection?.diagnosticCode === 'string' ? rejection.diagnosticCode : null;
        const joseCode = typeof rejection?.joseCode === 'string' ? rejection.joseCode : null;
        const joseName = typeof rejection?.joseName === 'string' ? rejection.joseName : null;
        const algorithm = typeof rejection?.tokenAlgorithm === 'string' ? rejection.tokenAlgorithm : null;
        const hasKeyId = rejection?.tokenHasKeyId === true;
        if (code) console.info('[Leletke API diagnostic]', {
          diagnosticCode: code,
          joseCode,
          joseName,
          tokenAlgorithm: algorithm,
          tokenHasKeyId: hasKeyId
        });
        const details = [joseCode, joseName, algorithm ? `alg=${algorithm}` : null, `kid=${hasKeyId ? 'present' : 'missing'}`]
          .filter(Boolean).join(', ');
        throw new Error(code
          ? `Az API elutasította a tokent. Diagnosztikai kód: ${code}${details ? ` (${details})` : ''}`
          : 'A Microsoft-belépés sikerült, de az API nem fogadta el a hozzáférési tokent. Ellenőrizd az API-jogosultságot és az Azure környezeti beállításokat.');
      }
      if (!response.ok) {
        throw new Error('A biztonságos API-ellenőrzés jelenleg nem érhető el. Ellenőrizd az Azure API környezeti beállításait és a GitHub Actions telepítést.');
      }

      const result = await response.json();
      if (result.authenticated !== true) {
        throw new Error('Az API nem igazolta a bejelentkezést.');
      }

      // Shared authenticated client for the standalone Functions API.
      // The user identity is derived only from the access token validated by the API.
      window.laborNaploApiRequest = async (url, options = {}) => {
        const freshToken = await msalInstance.acquireTokenSilent({
          scopes: [AUTH_CONFIG.apiScope],
          account: currentAccount
        });
        const headers = new Headers(options.headers || {});
        headers.set('X-LaborNaplo-Authorization', `Bearer ${freshToken.accessToken}`);
        if (!headers.has('Accept')) headers.set('Accept', 'application/json');
        const apiUrl = new URL(url, AUTH_CONFIG.apiBaseUrl).toString();
        return fetch(apiUrl, {
          ...options,
          headers,
          cache: 'no-store',
          credentials: 'omit'
        });
      };

      async function listHealthRecords(path) {
        const response = await window.laborNaploApiRequest(path, { method: 'GET' });
        let result;
        try {
          result = await response.json();
        } catch {
          throw new Error('Az API érvénytelen választ adott.');
        }
        if (!response.ok) {
          throw new Error(result?.message || 'Az adatok lekérdezése nem sikerült.');
        }
        if (!result || !Array.isArray(result.items)) {
          throw new Error('Az API válaszának formátuma nem megfelelő.');
        }
        return result.items;
      }

      async function callLabApi(path, options = {}) {
        const response = await window.laborNaploApiRequest(path, options);
        let result = {};
        try { result = await response.json(); } catch { /* use the safe generic error below */ }
        if (!response.ok) {
          throw new Error(result?.message || 'A laboradatok feldolgozása nem sikerült.');
        }
        return result;
      }

      Object.assign(window.LABORNAPLO_AUTH, {
        listMedications: () => listHealthRecords('/api/medications'),
        listAllergies: () => listHealthRecords('/api/allergies'),
        async extractReportValues(reportId) {
          if (typeof reportId !== 'string' || !/^[0-9a-f-]{36}$/i.test(reportId)) {
            throw new Error('Érvénytelen leletazonosító.');
          }
          return callLabApi('/api/reports/' + encodeURIComponent(reportId) + '/extract', {
            method: 'POST'
          });
        },
        async listExtractedReportValues(reportId) {
          if (typeof reportId !== 'string' || !/^[0-9a-f-]{36}$/i.test(reportId)) {
            throw new Error('Érvénytelen leletazonosító.');
          }
          const result = await callLabApi('/api/reports/' + encodeURIComponent(reportId) + '/values', {
            method: 'GET'
          });
          if (!Array.isArray(result.items)) throw new Error('A szerver nem érvényes értéklistát adott.');
          return result.items;
        },
        async approveReportValues(reportId, values) {
          if (typeof reportId !== 'string' || !/^[0-9a-f-]{36}$/i.test(reportId) || !Array.isArray(values)) {
            throw new Error('Érvénytelen mentési kérés.');
          }
          return callLabApi('/api/reports/' + encodeURIComponent(reportId) + '/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ values })
          });
        },
        async listLabValues() {
          const result = await callLabApi('/api/lab-values', { method: 'GET' });
          if (!Array.isArray(result.items)) throw new Error('A szerver nem érvényes laboreredmény-listát adott.');
          return result.items;
        }
      });

      showSignedIn(currentAccount);
      window.dispatchEvent(new CustomEvent('labor-naplo-authenticated'));
      logAuthDiagnostic('authentication-complete');
    }

    if (account) {
      await verifyApiAccess(account);
    } else {
      showSignedOut();
    }

    loginButton.addEventListener('click', async () => {
      clearAuthError();
      loginButton.disabled = true;
      loginButton.textContent = 'Átirányítás…';
      try {
        // Do not force a fresh credential prompt on every attempt. Entra
        // can reuse its existing session and only request OTP when necessary.
        logAuthDiagnostic('login-redirect-start');
        await msalInstance.loginRedirect({
          scopes: [AUTH_CONFIG.apiScope]
        });
      } catch (error) {
        console.error('[Leletke auth] Login failed:', error);
        showAuthError('A bejelentkezés most nem sikerült. Ellenőrizd az Entra-beállításokat, majd próbáld újra.');
        loginButton.disabled = false;
        loginButton.textContent = 'Belépés e-maillel';
      }
    });

    loginButton.disabled = false;
    loginButton.textContent = 'Belépés e-maillel';

    logoutButton.addEventListener('click', async () => {
      logoutButton.disabled = true;
      try {
        await msalInstance.logoutRedirect({
          account: msalInstance.getActiveAccount(),
          postLogoutRedirectUri
        });
      } catch (error) {
        console.error('[Leletke auth] Logout failed:', error);
        showAuthError('A kijelentkezés nem sikerült. Próbáld újra.');
        logoutButton.disabled = false;
      }
    });
  } catch (error) {
    logAuthDiagnostic('authentication-initialization-or-verification-failed', error);
    console.error('[Leletke auth] Initialization or API verification failed:', error);
    showSignedOut();
    showAuthError(error?.message || 'A bejelentkezés vagy a biztonságos API-ellenőrzés nem sikerült. Frissítsd az oldalt, és ellenőrizd az Entra-beállításokat.');
    loginButton.disabled = false;
    loginButton.textContent = 'Belépés e-maillel';
  }
}

startAuthentication();
