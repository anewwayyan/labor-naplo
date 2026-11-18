'use strict';

// Azure Functions v4: importing each module registers its HTTP trigger.
require('./functions/health');
require('./functions/me');
require('./functions/db-check');
require('./functions/rls-test');
require('./functions/upload-report');
require('./functions/list-reports');
require('./functions/delete-report');
