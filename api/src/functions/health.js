const { app } = require('@azure/functions');

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async (request, context) => {
    context.log('LaborNapló API health check requested.');

    return {
      status: 200,
      jsonBody: {
        status: 'ok',
        app: 'LaborNapló',
        apiVersion: '1.0.0',
        timestamp: new Date().toISOString()
      }
    };
  }
});
