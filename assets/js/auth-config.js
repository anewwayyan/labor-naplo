/*
 * LaborNapló – Microsoft Entra External ID configuration.
 * These identifiers are public client/resource IDs, not secrets.
 * Never place client secrets, passwords, or API keys in frontend files.
 */
window.LABORNAPLO_AUTH_CONFIG = {
  // LaborNaplo-Web SPA application (client) ID.
  clientId: '1edcad85-b889-428d-93e7-1734fcc6040d',
  // External tenant subdomain (the part before .ciamlogin.com).
  tenantSubdomain: 'labornaplo',
  redirectUri: 'https://gray-hill-07110e210.4.azurestaticapps.net/',
  postLogoutRedirectUri: 'https://gray-hill-07110e210.4.azurestaticapps.net/',
  // Delegated scope exposed by LaborNaplo-API.
  apiScope: 'api://6ec0ba97-551c-4efc-8e4f-88128c2048c0/access_as_user',
  protectedApiEndpoint: '/api/me'
};
