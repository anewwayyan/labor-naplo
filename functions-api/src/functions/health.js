'use strict';

const { app } = require('@azure/functions');

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async (request, context) => {
    context.log('LaborNapló standalone API health check requested.');

    return {
      status: 200,
      jsonBody: {
        status: 'ok',
        service: 'labor-naplo-api',
        apiVersion: '0.1.0',
        timestamp: new Date().toISOString()
      }
    };
  }
});
