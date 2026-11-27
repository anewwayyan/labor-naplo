'use strict';

// Azure Functions v4: importing each module registers its HTTP trigger.
require('./functions/health');
require('./functions/me');
require('./functions/profile');
require('./functions/health-records');
require('./functions/db-check');
require('./functions/rls-test');
require('./functions/upload-report');
require('./functions/list-reports');
require('./functions/delete-report');
require('./functions/get-report-pdf');
require('./functions/extract-report-values');
require('./functions/lab-values');
