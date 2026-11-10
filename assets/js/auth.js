/* LaborNapló sign-in and protected API check.
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

function isConfigured() {
  return Boolean(
    AUTH_CONFIG.clientId &&
    AUTH_CONFIG.tenantSubdomain &&
    AUTH_CONFIG.apiScope &&
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
              console.error('[LaborNapló auth]', message);
            }
          },
          piiLoggingEnabled: false,
          logLevel: LogLevel.Error
        }
      }
    });

    await msalInstance.initialize();

    const redirectResult = await msalInstance.handleRedirectPromise();
    if (redirectResult?.account) {
      msalInstance.setActiveAccount(redirectResult.account);
    }

    let account = msalInstance.getActiveAccount();
    if (!account) {
      const accounts = msalInstance.getAllAccounts();
      if (accounts.length === 1) {
        account = accounts[0];
        msalInstance.setActiveAccount(account);
      }
    }

    async function verifyApiAccess(currentAccount) {
      console.log('[LaborNapló] verifyApiAccess elindult');
      let tokenResponse;
      try {
        tokenResponse = await msalInstance.acquireTokenSilent({
          scopes: [AUTH_CONFIG.apiScope],
          account: currentAccount
        });
        console.log('[LaborNapló] Token megszerzése sikerült:', {
  hasAccessToken: Boolean(tokenResponse?.accessToken),
  expiresOn: tokenResponse?.expiresOn
});
      } catch (error) {
        if (error instanceof InteractionRequiredAuthError ||
            error?.errorCode === 'interaction_required' ||
            error?.errorCode === 'consent_required') {
          // This redirect is only needed the first time the SPA obtains the
          // API-specific permission, or after the Microsoft session expires.
          await msalInstance.acquireTokenRedirect({
            scopes: [AUTH_CONFIG.apiScope],
            account: currentAccount
          });
          return;
        }
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

console.log('LaborNapló token fejléc:', {
  alg: tokenHeader.alg,
  kid: tokenHeader.kid || null,
  typ: tokenHeader.typ || null
});
      const response = await fetch(AUTH_CONFIG.protectedApiEndpoint || '/api/me', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokenResponse.accessToken}`,
          Accept: 'application/json'
        },
        cache: 'no-store',
        credentials: 'same-origin'
      });

      if (response.status === 401) {
        let rejection = null;
        try { rejection = await response.json(); } catch { /* keep generic message */ }
        const code = typeof rejection?.diagnosticCode === 'string' ? rejection.diagnosticCode : null;
        const joseCode = typeof rejection?.joseCode === 'string' ? rejection.joseCode : null;
        const joseName = typeof rejection?.joseName === 'string' ? rejection.joseName : null;
        const algorithm = typeof rejection?.tokenAlgorithm === 'string' ? rejection.tokenAlgorithm : null;
        const hasKeyId = rejection?.tokenHasKeyId === true;
        if (code) console.info('[LaborNapló API diagnostic]', {
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

      showSignedIn(currentAccount);
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
        await msalInstance.loginRedirect({
          scopes: [AUTH_CONFIG.apiScope],
          prompt: 'login'
        });
      } catch (error) {
        console.error('[LaborNapló auth] Login failed:', error);
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
        console.error('[LaborNapló auth] Logout failed:', error);
        showAuthError('A kijelentkezés nem sikerült. Próbáld újra.');
        logoutButton.disabled = false;
      }
    });
  } catch (error) {
    console.error('[LaborNapló auth] Initialization or API verification failed:', error);
    showSignedOut();
    showAuthError(error?.message || 'A bejelentkezés vagy a biztonságos API-ellenőrzés nem sikerült. Frissítsd az oldalt, és ellenőrizd az Entra-beállításokat.');
    loginButton.disabled = false;
    loginButton.textContent = 'Belépés e-maillel';
  }
}

startAuthentication();
