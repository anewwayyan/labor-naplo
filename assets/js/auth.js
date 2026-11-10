/* LaborNapló sign-in: Microsoft Entra External ID + email one-time passcode.
 * Browser-delegated flow: Microsoft hosts the sign-in page and handles OTP verification.
 * No password or OTP is collected or stored by this application.
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
    !AUTH_CONFIG.clientId.includes('PASTE_') &&
    !AUTH_CONFIG.tenantSubdomain.includes('PASTE_')
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
    // Version-pinned MSAL Browser LTS ESM package. For production hardening,
    // bundle this dependency locally rather than loading it from a CDN.
    const { PublicClientApplication, LogLevel } = await import(
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

    if (account) {
      showSignedIn(account);
    } else {
      showSignedOut();
    }

    loginButton.addEventListener('click', async () => {
      clearAuthError();
      loginButton.disabled = true;
      loginButton.textContent = 'Átirányítás…';
      try {
        await msalInstance.loginRedirect({
          scopes: ['openid', 'profile', 'email'],
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
    console.error('[LaborNapló auth] Initialization failed:', error);
    showAuthError('A bejelentkezési szolgáltatás most nem érhető el, vagy a konfiguráció hibás. Frissítsd az oldalt, és ellenőrizd az Entra-beállításokat.');
    loginButton.disabled = true;
  }
}

startAuthentication();
